// The spec keeper (docs/specs/2026-11-28-spec-keeper.md), driven through a fake runner on a throwaway repo.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HiveEvent, PendingItem } from "@hive/shared";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { Hive } from "./hive";
import type { Role } from "./sessions/types";
import { KEEPER_SCHEMA } from "./spec/reports";
import {
  FakeProbe, FakeRunner, type FakeTurn, type KeeperJudgmentInput, keeperIssueIds, keeperReport, makeRepo, makeSpecFormat,
  waitFor, type TempRepo,
} from "./testing";

const brief = {
  title: "Printer font size", problem: "Labels are too small.", whoItsFor: "People with low vision",
  whatDoneLooksLike: ["Each printer has a size"], outOfScope: [], openPoints: [],
};

const plan = {
  status: "done", blockedReason: null,
  steps: [{ title: "Add the setting", detail: "A size per printer.", chunk: "core", check: "unit test" }],
  chunks: [{ name: "core", owns: ["src/fonts.ts"], model: "opus" }],
  tests: ["clamps to 8–48"],
};

const storage = { where: "Design, Storage", problem: "The spec names a settings table that doesn't exist.", guess: "prefs.json" };
const built = (issues = [storage]) => ({
  status: "done", blockedReason: null, summary: "Added a font size per printer.", departures: [], issues, decisions: [],
});
const passing = { status: "done", blockedReason: null, summary: "Looks right.", bugs: [], issues: [] };
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

describe("the spec keeper", () => {
  let db: HiveDb;
  let runner: FakeRunner;
  let hive: Hive;
  let repo: TempRepo;
  let format: ReturnType<typeof makeSpecFormat>;
  let hub: EventHub;
  let events: HiveEvent[];

  let brokenRoles: Set<string>;

  const role = (name: string): Role => {
    if (brokenRoles.has(name)) throw new Error(`roles/${name}.md is broken`);
    return { name, model: "opus", kind: name === "spec-reviewer" ? "one-off" : "work", instructions: `Be the ${name}.` };
  };
  const newHive = () =>
    new Hive({ db, hub, git, runner, probe: new FakeProbe(), role, log: () => {}, specFormatDir: format.dir, today: () => "2026-11-28" });

  beforeEach(() => {
    db = new HiveDb(":memory:");
    brokenRoles = new Set();
    runner = new FakeRunner();
    hub = new EventHub();
    events = [];
    hub.subscribe((e) => events.push(e));
    format = makeSpecFormat();
    repo = makeRepo();
    hive = newHive();
  });
  afterEach(() => {
    hive.close();
    repo.cleanup();
    format.cleanup();
    db.close();
  });

  const turnsOf = (roleName: string) => runner.turns.filter((t) => t.request.role.name === roleName);
  const lastOf = (roleName: string) => turnsOf(roleName).at(-1)!;
  const settledIn = async (id: string, lane: string) => waitFor(() => hive.card(id).lane !== lane || hive.card(id).state === "needs-you");

  /** A card whose spec is signed off and whose developer is running. */
  async function inBuild() {
    await hive.addProject(repo.root);
    const card = hive.createCard(hive.board().projects[0]!.id, "Font", "Make the printer font adjustable.");
    await hive.moveCard(card.id, "refine");
    await waitFor(() => hive.card(card.id).setup?.status === "done");
    const po = runner.last;
    await po.request.hiveTools!.writeBrief!(brief);
    po.handlers.onSessionCreated();
    await po.end();
    await hive.good(card.id, { skipMockup: true });
    const writer = runner.last;
    const detail = hive.card(card.id);
    const specFile = join(detail.worktreePath!, detail.spec!.path);
    writeFileSync(specFile, "# Printer font size\n\nThe spec.\n");
    writer.handlers.onSessionCreated();
    await writer.end();
    hive.review(card.id);
    await runner.last.end({ kind: "ok", report: { status: "done", blockedReason: null, summary: "", findings: [] } });
    await hive.signoff(card.id);
    const planner = runner.last;
    planner.handlers.onSessionCreated();
    await planner.end({ kind: "ok", report: plan });
    await waitFor(() => turnsOf("developer").length === 1);
    const developer = lastOf("developer");
    developer.handlers.onSessionCreated();
    return { id: card.id, worktree: detail.worktreePath!, specFile, writer, developer };
  }

  /** The developer reports; waits for the reviewer, which passes; waits for the keeper's batch turn. */
  async function toKeeper(id: string, developer: FakeTurn, report: object = built()) {
    const reviewers = turnsOf("reviewer").length;
    await developer.end({ kind: "ok", report });
    await waitFor(() => turnsOf("reviewer").length === reviewers + 1);
    const keepers = turnsOf("spec-writer").length;
    await lastOf("reviewer").end({ kind: "ok", report: passing });
    await waitFor(() => turnsOf("spec-writer").length === keepers + 1);
    return lastOf("spec-writer");
  }

  /** A card in Check whose keeper is judging its one Build issue. */
  async function judging() {
    const s = await inBuild();
    const keeper = await toKeeper(s.id, s.developer);
    return { ...s, keeper };
  }

  async function judge(id: string, keeper: FakeTurn, j: (i: number, issueId: string) => KeeperJudgmentInput = () => ({})) {
    const lane = hive.card(id).lane;
    await keeper.end({ kind: "ok", report: keeperReport(keeper.request.message, j) });
    await waitFor(() => hive.card(id).lane !== lane || hive.card(id).state === "needs-you");
  }

  const question = (id: string) => hive.card(id).pending as Extract<PendingItem, { kind: "question" }> | null;
  const answer = (id: string, labels: string[]) => {
    const q = question(id)!;
    hive.answer(q.id, { answers: Object.fromEntries(q.questions.map((qq, i) => [qq.question, labels[i]!])) });
  };

  describe("the batch", () => {
    it("judges the open issues as a turn of the spec writer's own session, and speaks in Check's chat", async () => {
      const { id, writer, keeper } = await judging();
      const card = hive.card(id);
      expect(card).toMatchObject({ lane: "check", state: "working" });
      expect(keeper.request.sessionId).toBe(writer.request.sessionId);
      expect(keeper.request.resume).toBe(true);
      expect(keeper.request.outputFormat).toBe(KEEPER_SCHEMA);
      const message = keeper.request.message;
      expect(message.startsWith("Be the spec-keeper.")).toBe(true);
      expect(message).toContain("Check passed. Judge these spec issues:");
      expect(keeperIssueIds(message)).toEqual([card.issues[0]!.id]);
      expect(message).toContain("Section: Design, Storage");
      expect(message).toContain("Today is 2026-11-28");
      expect(card.chat.at(-1)).toMatchObject({ text: "The spec keeper is judging 1 spec issue." });

      keeper.handlers.onTextBlock("Reading the storage code.");
      expect(hive.card(id).chat.at(-1)).toMatchObject({ from: "spec-keeper", text: "Reading the storage code." });
      expect(db.chatFor(id, "spec").some((c) => c.kind === "message" && c.text === "Reading the storage code.")).toBe(false);
    });

    it("refuses the keeper's questions mid-turn", async () => {
      const { keeper } = await judging();
      const decision = await keeper.handlers.canUseTool("AskUserQuestion", { questions: [] }, new AbortController().signal);
      expect(decision).toMatchObject({ behavior: "deny", message: expect.stringMatching(/changes-signoff/) });
    });

    it("commits a minor spec fix with its Amendments line, and moves the card to Try it", async () => {
      const { id, worktree, specFile, keeper } = await judging();
      writeFileSync(specFile, "# Printer font size\n\nStored in prefs.json.\n\n## Amendments\n\n- 2026-11-28: Storage is prefs.json.\n");
      await judge(id, keeper, () => ({ verdict: "spec-wrong", reason: "There is no settings table." }));
      const card = hive.card(id);
      expect(card.lane).toBe("tryit");
      expect(card.issues[0]).toMatchObject({
        status: "spec-fixed", judgment: { verdict: "spec-wrong", level: "minor", reason: "There is no settings table." },
      });
      expect(sh(worktree, "log", "-1", "--format=%s")).toBe("Spec keeper: Printer font size");
      expect(sh(worktree, "status", "--porcelain")).toBe("");
      expect(card.pending).toBeNull();
      expect(events.some((e) => e.type === "issues.updated" && e.cardId === id)).toBe(true);
      expect(db.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'judged'").get()).toEqual({ n: 1 });
    });

    it("sends a minor code fix to the same developer, and the next reviewer verifies it", async () => {
      const { id, developer, keeper } = await judging();
      const developers = turnsOf("developer").length;
      await judge(id, keeper, () => ({ verdict: "code-wrong", reason: "The spec's settings table is right." }));
      await waitFor(() => turnsOf("developer").length === developers + 1);
      const fixer = lastOf("developer");
      const card = hive.card(id);
      expect(card).toMatchObject({ lane: "build", check: null });
      expect(card.issues[0]).toMatchObject({ status: "sent" });
      expect(fixer.request.sessionId).toBe(developer.request.sessionId);
      expect(fixer.request.message).toMatch(/^The spec keeper judged these spec issues: the code should change/);
      expect(fixer.request.message).toContain("- Design, Storage: The spec names a settings table that doesn't exist.");
      expect(fixer.request.message).toContain("The spec keeper: The spec's settings table is right.");

      const reviewers = turnsOf("reviewer").length;
      await fixer.end({ kind: "ok", report: built([]) });
      await waitFor(() => turnsOf("reviewer").length === reviewers + 1);
      const reviewer = lastOf("reviewer");
      expect(reviewer.request.message).toContain("Check round 1");
      expect(reviewer.request.message).toContain("sent to the developer as code fixes");
      const alreadyOnCard = reviewer.request.message.split("Don't report them again:")[1]!.split("\n\n")[0]!;
      expect(alreadyOnCard).not.toContain("Design, Storage");

      await reviewer.end({ kind: "ok", report: passing });
      await settledIn(id, "check");
      expect(hive.card(id)).toMatchObject({ lane: "tryit" });
      expect(hive.card(id).issues[0]).toMatchObject({ status: "fixed" });
    });

    it("asks you once two keeper fix rounds have run since sign-off", async () => {
      const { id, keeper } = await judging();
      db.updateCard(id, { keeperRounds: 2 });
      await judge(id, keeper, () => ({ verdict: "code-wrong" }));
      const card = hive.card(id);
      expect(card.lane).toBe("tryit");
      expect(card.issues[0]).toMatchObject({ status: "waiting" });
      expect(question(id)!.issueIds).toEqual([card.issues[0]!.id]);
      expect(question(id)!.questions[0]!.options.map((o) => o.label)).toEqual(["Change the code", "Keep it as built"]);
    });

    it("judges a card moved on from Check as built: a code fix becomes a question", async () => {
      const s = await inBuild();
      await s.developer.end({ kind: "ok", report: built() });
      await waitFor(() => turnsOf("reviewer").length === 1);
      await lastOf("reviewer").end({ kind: "ok", report: { status: "blocked", blockedReason: "Can't read the spec.", summary: "", bugs: [], issues: [] } });
      await settledIn(s.id, "check");
      await hive.moveOn(s.id);
      const keeper = lastOf("spec-writer");
      expect(keeper.request.message).toContain("moved the card on to Try it as built");
      await judge(s.id, keeper, () => ({ verdict: "code-wrong" }));
      expect(hive.card(s.id).lane).toBe("tryit");
      expect(hive.card(s.id).issues[0]).toMatchObject({ status: "waiting" });
      expect(question(s.id)).not.toBeNull();
    });
  });

  describe("your answers in Try it", () => {
    async function asked(verdict: "spec-wrong" | "code-wrong" | "no-change" = "spec-wrong") {
      const s = await judging();
      await judge(s.id, s.keeper, () => ({ verdict, level: "changes-signoff", recommendation: "Keep prefs.json." }));
      return s;
    }

    it("asks a changes-signoff issue in Try it, and holds Accept and Send to Build until you answer", async () => {
      const { id } = await asked();
      const q = question(id)!;
      expect(hive.card(id).lane).toBe("tryit");
      expect(q.questions[0]!.question).toBe("1. Design, Storage: The spec names a settings table that doesn't exist. Keep prefs.json.");
      expect(q.questions[0]!.options.map((o) => o.label)).toEqual(["Keep it as built", "Change the code"]);
      expect(q.questions[0]!.options[0]!.description).toMatch(/^The spec keeper recommends this/);
      expect(hive.forYou().items[0]).toMatchObject({ kind: "question" });
      await expect(hive.accept(id)).rejects.toThrow(/Answer the spec keeper's question first/);
      await expect(hive.feedback(id, { text: "Looks off." })).rejects.toThrow(/Answer the spec keeper's question first/);
    });

    it("Keep it as built: the keeper changes the spec at once, the card stays, and Accept works", async () => {
      const { id, worktree, specFile } = await asked();
      answer(id, ["Keep it as built"]);
      const turn = lastOf("spec-writer");
      expect(turn.request.outputFormat).toBeUndefined();
      expect(turn.request.message).toContain("keep it as built: change the spec to describe what was built");
      expect(hive.card(id)).toMatchObject({ lane: "tryit", state: "working" });
      expect(hive.card(id).issues[0]).toMatchObject({ status: "kept", answer: { choice: "keep", words: null } });
      writeFileSync(specFile, `${readFileSync(specFile, "utf8")}\n## Amendments\n\n- 2026-11-28: Storage is prefs.json.\n`);
      await turn.end();
      await waitFor(() => hive.card(id).state === "needs-you");
      expect(sh(worktree, "log", "-1", "--format=%s")).toBe("Spec keeper: Printer font size");
      await hive.accept(id);
      expect(hive.card(id).lane).toBe("ship");
    });

    it("Change the code: held until Send to Build, which takes it with or without feedback", async () => {
      const { id, developer } = await asked();
      const turns = runner.turns.length;
      answer(id, ["Change the code"]);
      expect(runner.turns.length).toBe(turns); // no turn: the answer is held
      expect(hive.card(id)).toMatchObject({ lane: "tryit", pending: null });
      expect(hive.card(id).issues[0]).toMatchObject({ status: "held" });
      await expect(hive.accept(id)).rejects.toThrow(/Send them to Build first/);

      await hive.feedback(id, { text: "" });
      await waitFor(() => turnsOf("developer").length === 2);
      const fixer = lastOf("developer");
      expect(fixer.request.sessionId).toBe(developer.request.sessionId);
      expect(fixer.request.message).toMatch(/asked for these code changes, on spec issues the spec keeper raised/);
      expect(fixer.request.message).toContain("Design, Storage");
      expect(hive.card(id)).toMatchObject({ lane: "build", feedback: null, check: null });
      expect(hive.card(id).issues[0]).toMatchObject({ status: "sent" });
    });

    it("your own words: written into the spec by the keeper, and held for the developer", async () => {
      const { id } = await asked();
      answer(id, ["Neither: use a dropdown"]);
      const turn = lastOf("spec-writer");
      expect(turn.request.message).toContain('in their own words: "Neither: use a dropdown". Make the spec say it');
      expect(hive.card(id).issues[0]).toMatchObject({ status: "held", answer: { choice: "change", words: "Neither: use a dropdown" } });
      await turn.end();
      await waitFor(() => hive.card(id).state === "needs-you");

      await hive.feedback(id, { text: "Also the label overlaps.", lane: "build" });
      await waitFor(() => turnsOf("developer").length === 2);
      const message = lastOf("developer").request.message;
      expect(message).toContain("Also the label overlaps.");
      expect(message).toContain("They also asked for these code changes");
      expect(message).toContain('The person said: Neither: use a dropdown');
    });

    it("Retry after a broken spec-writer role file sends your answers, not the keeper's last message", async () => {
      const { id } = await asked();
      brokenRoles.add("spec-writer");
      answer(id, ["Keep it as built"]);
      await waitFor(() => hive.card(id).chat.at(-1)?.kind === "error");
      expect(hive.card(id).chat.at(-1)).toMatchObject({ kind: "error", actions: expect.arrayContaining(["retry"]) });
      expect(hive.card(id)).toMatchObject({ state: "needs-you", turnRunning: false });

      brokenRoles.clear();
      const keepers = turnsOf("spec-writer").length;
      await hive.retry(id);
      expect(turnsOf("spec-writer")).toHaveLength(keepers + 1);
      expect(lastOf("spec-writer").request.message).toContain("keep it as built: change the spec to describe what was built");
    });

    it("Keep it as built on a no-change issue needs no spec change and no turn", async () => {
      const { id } = await asked("no-change");
      const turns = runner.turns.length;
      answer(id, ["Keep it as built"]);
      expect(runner.turns.length).toBe(turns);
      await hive.accept(id);
      expect(hive.card(id).lane).toBe("ship");
    });

    it("asks a repeat of an earlier issue whatever its verdict", async () => {
      const { id, keeper } = await judging();
      const first = hive.card(id).issues[0]!.id;
      await judge(id, keeper, () => ({ verdict: "code-wrong" }));
      await waitFor(() => turnsOf("developer").length === 2);
      const again = await toKeeper(id, lastOf("developer"), built([{ ...storage, problem: "Still no settings table." }]));
      expect(again.request.message).toContain(`- id ${first}: Design, Storage`);
      await judge(id, again, () => ({ verdict: "spec-wrong", repeats: first }));
      const card = hive.card(id);
      expect(card.lane).toBe("tryit");
      expect(card.issues[1]).toMatchObject({ status: "waiting", judgment: { repeats: first } });
      expect(question(id)!.questions[0]!.question).toContain("It came back after it was settled once.");
      expect(db.db.prepare("SELECT flips FROM issues WHERE id = ?").get(card.issues[1]!.id)).toEqual({ flips: 1 });
    });
  });

  describe("a severe issue", () => {
    it("stops the card in Check with Back to Spec and Move on; Move on asks it in Try it", async () => {
      const { id, keeper } = await judging();
      await judge(id, keeper, () => ({ verdict: "code-wrong", level: "severe", reason: "Prefs are per user.", recommendation: "Rethink." }));
      expect(hive.card(id)).toMatchObject({ lane: "check", state: "needs-you" });
      expect(hive.card(id).chat.at(-1)).toMatchObject({
        kind: "error", message: expect.stringMatching(/^The spec keeper found a severe issue in Design, Storage: Prefs are per user\. It recommends: Rethink\./),
        actions: ["back-to-spec", "move-on"],
      });
      await hive.moveOn(id);
      expect(hive.card(id).lane).toBe("tryit");
      expect(hive.card(id).issues[0]).toMatchObject({ status: "waiting" });
      expect(question(id)).not.toBeNull();
    });

    it("Back to Spec settles the issues and sends the finding to the spec writer", async () => {
      const { id, writer, keeper } = await judging();
      await judge(id, keeper, () => ({ level: "severe", reason: "Prefs are per user." }));
      await hive.backToSpec(id);
      const turn = lastOf("spec-writer");
      expect(hive.card(id).lane).toBe("spec");
      expect(turn.request.sessionId).toBe(writer.request.sessionId);
      expect(turn.request.message).toMatch(/^As the spec keeper, you stopped the card on a severe issue/);
      expect(turn.request.message).toContain("They're closed now");
      expect(hive.card(id).issues[0]).toMatchObject({ status: "settled" });
    });
  });

  describe("a keeper turn that fails", () => {
    it("offers Retry, which sends the same message again, and Move on, which leaves the issues not judged", async () => {
      const { id, writer, keeper } = await judging();
      await keeper.end({ kind: "ok", report: { status: "done", blockedReason: null, summary: "", judgments: [] } });
      await settledIn(id, "check");
      expect(hive.card(id).chat.at(-1)).toMatchObject({
        kind: "error", message: "The spec keeper didn't judge every issue.", actions: ["retry", "move-on"],
      });
      hive.retry(id);
      const again = lastOf("spec-writer");
      expect(again.request.sessionId).toBe(writer.request.sessionId);
      expect(again.request.message).toBe(keeper.request.message);
      expect(again.request.outputFormat).toBe(KEEPER_SCHEMA);
      await again.end({ kind: "error", message: "Not logged in" });
      await settledIn(id, "check");

      const turns = runner.turns.length;
      await hive.moveOn(id);
      expect(runner.turns.length).toBe(turns);
      expect(hive.card(id).lane).toBe("tryit");
      expect(hive.card(id).issues[0]).toMatchObject({ status: "open" });
      await hive.accept(id);
    });

    it("resumes a keeper turn cut off by a restart", async () => {
      const { keeper } = await judging();
      const restarted = newHive();
      restarted.recoverAfterRestart();
      expect(runner.last.request.sessionId).toBe(keeper.request.sessionId);
      expect(runner.last.request.message).toMatch(/Finish judging the issues/);
      expect(runner.last.request.outputFormat).toBe(KEEPER_SCHEMA);
      restarted.close();
    });
  });

  describe("a blocked build", () => {
    async function blocked(reason = "The spec's settings table doesn't exist.") {
      const s = await inBuild();
      await s.developer.end({ kind: "ok", report: { ...built(), status: "blocked", blockedReason: reason } });
      await waitFor(() => turnsOf("spec-writer").length === 2);
      return { ...s, keeper: lastOf("spec-writer") };
    }

    it("goes to the keeper at once with only the blocking problem", async () => {
      const { id, keeper } = await blocked();
      expect(hive.card(id)).toMatchObject({ lane: "build", state: "working" });
      expect(keeper.request.message).toContain("The developer is blocked and has stopped.");
      expect(keeper.request.message).toContain("Section: Blocking");
      expect(keeperIssueIds(keeper.request.message)).toHaveLength(1);
    });

    it("resumes the developer after a spec fix, or when the spec stands", async () => {
      const { id, worktree, specFile, developer, keeper } = await blocked();
      writeFileSync(specFile, "# Printer font size\n\nprefs.json.\n");
      await keeper.end({ kind: "ok", report: keeperReport(keeper.request.message, () => ({ verdict: "spec-wrong", reason: "Use prefs.json." })) });
      await waitFor(() => turnsOf("developer").length === 2);
      expect(lastOf("developer").request.sessionId).toBe(developer.request.sessionId);
      expect(lastOf("developer").request.message).toMatch(/^The spec keeper changed the spec: Use prefs\.json\./);
      expect(sh(worktree, "log", "-1", "--format=%s")).toBe("Spec keeper: Printer font size");
      expect(hive.card(id).issues.at(-1)).toMatchObject({ status: "spec-fixed" });
    });

    it("Retry after a broken developer role file sends the keeper's verdict, not the developer's old message", async () => {
      const { id, keeper } = await blocked();
      brokenRoles.add("developer");
      await keeper.end({ kind: "ok", report: keeperReport(keeper.request.message, () => ({ verdict: "code-wrong", reason: "The table is in migration 12." })) });
      await waitFor(() => hive.card(id).chat.at(-1)?.kind === "error");
      expect(hive.card(id).chat.at(-1)).toMatchObject({
        kind: "error", message: expect.stringContaining("The developer couldn't carry on"), actions: ["retry", "back-to-spec"],
      });
      expect(turnsOf("developer")).toHaveLength(1);

      brokenRoles.clear();
      await hive.retry(id);
      await waitFor(() => turnsOf("developer").length === 2);
      expect(lastOf("developer").request.message).toMatch(/^The spec stands: The table is in migration 12\./);
    });

    it("falls back to Retry and Back to Spec on no-change, and on a second block in the same visit", async () => {
      const { id, keeper } = await blocked();
      await keeper.end({ kind: "ok", report: keeperReport(keeper.request.message, () => ({ verdict: "code-wrong", reason: "The table is in migration 12." })) });
      await waitFor(() => turnsOf("developer").length === 2);
      expect(lastOf("developer").request.message).toMatch(/^The spec stands: The table is in migration 12\./);
      const keepers = turnsOf("spec-writer").length;
      await lastOf("developer").end({ kind: "ok", report: { ...built(), status: "blocked", blockedReason: "Still stuck." } });
      await settledIn(id, "build");
      expect(turnsOf("spec-writer")).toHaveLength(keepers);
      expect(hive.card(id).chat.at(-1)).toMatchObject({
        kind: "error", message: "The developer couldn't build this: Still stuck.", actions: ["retry", "back-to-spec"],
      });
    });

    it("asks you at once on changes-signoff, and Keep the spec sends the developer on", async () => {
      const { id, keeper } = await blocked();
      await judge(id, keeper, () => ({ verdict: "code-wrong", level: "changes-signoff", reason: "Keep the table." }));
      expect(hive.card(id)).toMatchObject({ lane: "build", state: "needs-you" });
      expect(question(id)!.questions[0]!.options.map((o) => o.label)).toEqual(["Keep the spec", "Change the spec"]);
      answer(id, ["Keep the spec"]);
      await waitFor(() => turnsOf("developer").length === 2);
      expect(lastOf("developer").request.message).toMatch(/^The spec stands: Keep the table\./);
    });

    it("stops on a severe block with Back to Spec", async () => {
      const { id, keeper } = await blocked();
      await judge(id, keeper, () => ({ level: "severe", reason: "Far bigger than the spec assumed." }));
      expect(hive.card(id).chat.at(-1)).toMatchObject({ kind: "error", actions: ["back-to-spec"] });
      await hive.backToSpec(id);
      expect(hive.card(id).lane).toBe("spec");
    });
  });
});
