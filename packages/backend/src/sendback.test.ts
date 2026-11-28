// Send back from Try it, and amendments (docs/specs/2026-11-28-try-it-send-back.md), driven through a fake runner on a
// throwaway repo.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PendingItem, SendBackPoint } from "@hive/shared";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { Hive } from "./hive";
import { fakePorts } from "./preview/ports";
import type { Role } from "./sessions/types";
import { AMENDMENT_SCHEMA, REVIEW_SCHEMA, SEND_BACK_SCHEMA } from "./spec/reports";
import { FakeProbe, FakeRunner, type FakeTurn, makeRepo, makeSpecFormat, waitFor, type TempRepo } from "./testing";

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
const built = { status: "done", blockedReason: null, summary: "Added a font size per printer.", departures: [], issues: [], decisions: [] };
const passing = { status: "done", blockedReason: null, summary: "Looks right.", bugs: [], issues: [] };
const noFindings = { status: "done", blockedReason: null, summary: "", findings: [] };

const limit: SendBackPoint = { what: "The limit should be 32, not 24", kind: "spec", why: "The spec says 24." };
const crash: SendBackPoint = { what: "It crashes with no printers", kind: "bug", why: "The spec covers no printers." };
const reading = (points: SendBackPoint[]) => ({ status: "done", blockedReason: null, reason: "One point changes the spec.", points });
const amended = (review: boolean) => ({
  status: "done", blockedReason: null, summary: "The limit is now 32.", review,
  reason: review ? "It changes the Outcome." : "A one-line change.",
});
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

describe("Send back and amendments", () => {
  let db: HiveDb;
  let runner: FakeRunner;
  let hive: Hive;
  let repo: TempRepo;
  let format: ReturnType<typeof makeSpecFormat>;
  let ports: ReturnType<typeof fakePorts>;
  /** Makes the amendment's sign-off commit fail, as a held index.lock would. */
  let failAmendmentCommit: boolean;

  const role = (name: string): Role =>
    ({ name, model: "opus", kind: name === "spec-reviewer" ? "one-off" : "work", instructions: `Be the ${name}.` });
  const newHive = () =>
    new Hive({
      db, hub: new EventHub(), runner, probe: new FakeProbe(), role, log: () => {}, specFormatDir: format.dir,
      today: () => "2026-11-28", ports,
      git: {
        ...git,
        commitFile: async (worktree: string, path: string, message: string) => {
          if (failAmendmentCommit && message.includes("amendment")) throw new Error("Unable to create index.lock");
          return git.commitFile(worktree, path, message);
        },
      },
    });

  beforeEach(() => {
    db = new HiveDb(":memory:");
    runner = new FakeRunner();
    format = makeSpecFormat();
    repo = makeRepo();
    ports = fakePorts();
    failAmendmentCommit = false;
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
  const notes = (id: string) => hive.card(id).chat.flatMap((c) => (c.kind === "message" && c.from === "hive" ? [c.text] : []));
  const amendmentOf = (id: string) => db.amendmentsFor(id).at(-1)!;

  /** A card in Try it: signed off, built, and a clean Check round. */
  async function inTryIt() {
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
    writeFileSync(specFile, "# Printer font size\n\nThe limit is 24.\n");
    writer.handlers.onSessionCreated();
    await writer.end();
    hive.review(card.id);
    await runner.last.end({ kind: "ok", report: noFindings });
    await hive.signoff(card.id);
    const planner = runner.last;
    planner.handlers.onSessionCreated();
    await planner.end({ kind: "ok", report: plan });
    await waitFor(() => turnsOf("developer").length === 1);
    const developer = lastOf("developer");
    developer.handlers.onSessionCreated();
    await developer.end({ kind: "ok", report: built });
    await waitFor(() => turnsOf("reviewer").length === 1);
    await lastOf("reviewer").end({ kind: "ok", report: passing });
    await waitFor(() => hive.card(card.id).lane === "tryit");
    return { id: card.id, worktree: detail.worktreePath!, specFile, writer, developer };
  }

  /** Send back with the keeper's reading; resolves once the card has left Try it, or the pick failed. */
  async function sendBack(id: string, text: string, points: SendBackPoint[]) {
    await hive.feedback(id, { text });
    const reader = lastOf("spec-writer");
    const before = turnsOf("spec-writer").length + turnsOf("developer").length;
    await reader.end({ kind: "ok", report: reading(points) });
    await waitFor(() => turnsOf("spec-writer").length + turnsOf("developer").length > before);
    return reader;
  }

  /** A card in Spec on Amendment 1, its amendment turn running; the spec file already says 32. */
  async function amending(points: SendBackPoint[] = [limit]) {
    const s = await inTryIt();
    await sendBack(s.id, "The limit should be 32, not 24.", points);
    writeFileSync(s.specFile, "# Printer font size\n\nThe limit is 32.\n\n## Amendments\n\n- 2026-11-28: The limit is 32.\n");
    return { ...s, amender: lastOf("spec-writer") };
  }

  async function signedOffOnItsOwn(id: string, amender: FakeTurn, review = false) {
    const planners = turnsOf("planner").length;
    await amender.end({ kind: "ok", report: amended(review) });
    if (review) {
      await waitFor(() => turnsOf("spec-reviewer").length === 2);
      await lastOf("spec-reviewer").end({ kind: "ok", report: noFindings });
    }
    await waitFor(() => turnsOf("planner").length === planners + 1);
    return lastOf("planner");
  }

  describe("the pick", () => {
    it("reads your words as a keeper turn that edits nothing, while the card stays in Try it", async () => {
      const { id, writer } = await inTryIt();
      await hive.feedback(id, { text: "The limit should be 32, not 24." });
      const reader = lastOf("spec-writer");
      expect(hive.card(id)).toMatchObject({ lane: "tryit", state: "working", sendBack: { text: "The limit should be 32, not 24." } });
      expect(reader.request.sessionId).toBe(writer.request.sessionId);
      expect(reader.request.outputFormat).toBe(SEND_BACK_SCHEMA);
      expect(reader.request.message.startsWith("Be the feedback-reader.")).toBe(true);
      expect(reader.request.message).toContain("The limit should be 32, not 24.");
      expect(reader.request.message).toContain(hive.card(id).specPath!);
      expect(notes(id)).toContain("The spec keeper is reading your feedback.");
      const decision = await reader.handlers.canUseTool("AskUserQuestion", { questions: [] }, new AbortController().signal);
      expect(decision).toMatchObject({ behavior: "deny" });
    });

    it("sends a bug to Build at once, with the keeper's reading in Build's chat", async () => {
      const { id } = await inTryIt();
      await sendBack(id, "It crashes with no printers.", [crash]);
      const card = hive.card(id);
      expect(card).toMatchObject({ lane: "build", sendBack: null, amendment: null, feedback: "It crashes with no printers." });
      expect(notes(id)).toContain(
        "The spec keeper read your feedback: One point changes the spec. Bug: It crashes with no printers (The spec covers no printers).",
      );
      expect(db.amendmentsFor(id)).toHaveLength(0);
    });

    it("on a failed pick offers Retry, Back to Build and Back to Spec, and holds Accept until Edit clears it", async () => {
      const { id } = await inTryIt();
      await hive.feedback(id, { text: "The limit should be 32, not 24." });
      const reader = lastOf("spec-writer");
      await reader.end({ kind: "ok" });
      await waitFor(() => hive.card(id).state === "needs-you");
      expect(hive.card(id).chat.at(-1)).toMatchObject({
        kind: "error", message: "The spec keeper didn't say where your feedback goes.", actions: ["retry", "back-to-build", "back-to-spec"],
      });
      await expect(hive.accept(id)).rejects.toMatchObject({ status: 409, message: "Send your feedback, or edit it away first." });

      hive.retry(id);
      const again = lastOf("spec-writer");
      expect(again.request.message).toBe(reader.request.message);
      expect(again.request.outputFormat).toBe(SEND_BACK_SCHEMA);
      await again.end({ kind: "error", message: "Not logged in" });
      await waitFor(() => hive.card(id).state === "needs-you");

      hive.editSendBack(id);
      expect(hive.card(id)).toMatchObject({ lane: "tryit", sendBack: null });
      // The failed pick's buttons go: its error line is no longer the last.
      expect(hive.card(id).chat.at(-1)).toMatchObject({ kind: "message", text: "Your feedback is back in the box." });
      await hive.accept(id);
      expect(hive.card(id).lane).toBe("ship");
    });

    it("Back to Spec after a failed pick opens an amendment with your stored words", async () => {
      const { id } = await inTryIt();
      await hive.feedback(id, { text: "The limit should be 32, not 24." });
      await lastOf("spec-writer").end({ kind: "ok", report: { status: "blocked", blockedReason: "No spec found.", reason: "", points: [] } });
      await waitFor(() => hive.card(id).state === "needs-you");
      const turns = turnsOf("spec-writer").length;
      await hive.backToSpec(id);
      await waitFor(() => turnsOf("spec-writer").length === turns + 1);
      expect(hive.card(id)).toMatchObject({ lane: "spec", sendBack: null, amendment: { n: 1, words: "The limit should be 32, not 24.", points: [] } });
      expect(lastOf("spec-writer").request.outputFormat).toBe(AMENDMENT_SCHEMA);
    });

    it("resumes a pick cut off by a restart", async () => {
      const { id } = await inTryIt();
      await hive.feedback(id, { text: "The limit should be 32, not 24." });
      const reader = lastOf("spec-writer");
      const restarted = newHive();
      restarted.recoverAfterRestart();
      expect(runner.last.request.sessionId).toBe(reader.request.sessionId);
      expect(runner.last.request.message).toMatch(/Finish reading the person's feedback/);
      expect(runner.last.request.outputFormat).toBe(SEND_BACK_SCHEMA);
      expect(hive.card(id).lane).toBe("tryit");
      restarted.close();
    });
  });

  describe("an amendment", () => {
    it("opens in Spec as Amendment 1, keeps your words and held answers for the developer, and starts the amendment turn", async () => {
      const s = await inTryIt();
      const issueId = db.addIssue(s.id, { foundIn: "check", where: "Design, Sorting", problem: "Sorted by date.", guess: "date" });
      db.answerIssue(issueId, { choice: "change", words: null }, "held");
      const stops = ports.stopped.length;
      await sendBack(s.id, "The limit should be 32, not 24, and it crashes with no printers.", [limit, crash]);
      const card = hive.card(s.id);
      expect(card).toMatchObject({
        lane: "spec", sendBack: null, feedback: "The limit should be 32, not 24, and it crashes with no printers.",
        amendment: { n: 1, points: [limit, crash], summary: null, signedOff: null },
      });
      expect(card.issues.find((i) => i.id === issueId)).toMatchObject({ status: "sent" });
      expect(db.getCard(s.id)!.keeperFixes).toEqual({ from: "tryit", ids: [issueId] });
      expect(ports.stopped.length).toBeGreaterThan(stops);

      const amender = lastOf("spec-writer");
      expect(amender.request.sessionId).toBe(s.writer.request.sessionId);
      expect(amender.request.outputFormat).toBe(AMENDMENT_SCHEMA);
      expect(amender.request.message.startsWith("Be the spec-amender.")).toBe(true);
      expect(amender.request.message).toContain("This is Amendment 1 to the signed-off spec");
      expect(amender.request.message).toContain(`- spec: ${limit.what} (${limit.why})`);
      expect(amender.request.message).toContain(`- bug: ${crash.what} (${crash.why})`);
      expect(amender.request.message).toContain("Today is 2026-11-28");
      expect(notes(s.id)).toContain("Amendment 1, from your Try it feedback: The limit should be 32, not 24, and it crashes with no printers.");
      amender.handlers.onTextBlock("Changing the limit.");
      expect(hive.card(s.id).chat.at(-1)).toMatchObject({ from: "spec-writer", text: "Changing the limit." });
    });

    it("signs off on its own when the spec writer skips review; the planner plans what's left, the developer builds it", async () => {
      const s = await amending([limit, crash]);
      const planner = await signedOffOnItsOwn(s.id, s.amender);
      expect(hive.card(s.id).lane).toBe("plan");
      expect(sh(s.worktree, "log", "-1", "--format=%s")).toBe("Spec: Printer font size, amendment 1");
      expect(amendmentOf(s.id)).toMatchObject({ step: "plan", signedOff: "auto", reviewed: false, summary: "The limit is now 32." });
      const spec = hive.card(s.id).pastChats.spec!.flatMap((c) => (c.kind === "message" ? [c.text] : []));
      expect(spec).toContain("Amendment 1 signed off on its own, review skipped: A one-line change.");
      expect(planner.request.message).toMatch(/^This is Amendment 1 to the spec at .*: The limit is now 32\./);
      expect(planner.request.message).toContain("Plan only what's left");
      expect(planner.request.message).toContain("+The limit is 32.");
      expect(planner.request.message).toContain("-The limit is 24.");

      await planner.end({ kind: "ok", report: plan });
      await waitFor(() => turnsOf("developer").length === 2);
      const developer = lastOf("developer");
      expect(developer.request.sessionId).toBe(s.developer.request.sessionId);
      expect(developer.request.message).toMatch(/^This is Amendment 1: The limit is now 32\./);
      expect(developer.request.message).toContain("The person's Try it feedback, which also had these points:");
      expect(developer.request.message).toContain("The plan:");
      expect(notes(s.id)).not.toContain("Sent back from Try it: The limit should be 32, not 24.");
      expect(amendmentOf(s.id).step).toBe("after");

      await developer.end({ kind: "ok", report: built });
      await waitFor(() => turnsOf("reviewer").length === 2);
      const reviewer = lastOf("reviewer").request.message;
      expect(reviewer).toContain("What the person asked for in Try it, oldest first");
      expect(reviewer).toContain("- The limit should be 32, not 24.");
      expect(reviewer).toContain("This round carries Amendment 1: The limit is now 32.");
      await lastOf("reviewer").end({ kind: "ok", report: passing });
      await waitFor(() => hive.card(s.id).lane === "tryit");
      const card = hive.card(s.id);
      expect(card.amendment).toBeNull();
      expect(card.history.tryit[0]).toMatchObject({ kind: "amendment", amendment: { n: 1, signedOff: "auto", reviewed: false } });
    });

    it("runs the blind review by itself when the spec writer asks for one, told what the amendment changed", async () => {
      const s = await amending();
      const reviews = turnsOf("spec-reviewer").length;
      await s.amender.end({ kind: "ok", report: amended(true) });
      await waitFor(() => turnsOf("spec-reviewer").length === reviews + 1);
      const reviewer = lastOf("spec-reviewer");
      expect(reviewer.request.outputFormat).toBe(REVIEW_SCHEMA);
      expect(reviewer.request.message).toContain("This is Amendment 1 to a signed-off spec");
      expect(reviewer.request.message).toContain("+The limit is 32.");
      expect(hive.card(s.id).lane).toBe("spec");
      await reviewer.end({ kind: "ok", report: noFindings });
      await waitFor(() => hive.card(s.id).lane === "plan");
      expect(amendmentOf(s.id)).toMatchObject({ signedOff: "auto", reviewed: true });
    });

    it("still signs off on its own after you answer the spec writer's question", async () => {
      const s = await amending();
      const asking = s.amender.handlers.canUseTool(
        "AskUserQuestion", { questions: [{ question: "Cap at 32 for every printer?", header: "Cap", options: [{ label: "Yes" }, { label: "No" }], multiSelect: false }] },
        new AbortController().signal,
      );
      await waitFor(() => hive.card(s.id).pending !== null);
      const q = hive.card(s.id).pending as Extract<PendingItem, { kind: "question" }>;
      hive.answer(q.id, { answers: { [q.questions[0]!.question]: "Yes" } });
      await expect(asking).resolves.toMatchObject({ behavior: "allow" });
      expect(amendmentOf(s.id).takenOver).toBe(false);
      await signedOffOnItsOwn(s.id, s.amender);
      expect(amendmentOf(s.id).signedOff).toBe("auto");
    });

    it("writing in the chat takes it over: a skipped review opens Sign off, and you sign off yourself", async () => {
      const s = await amending();
      hive.sendMessage(s.id, "Also say 48 is the most any printer allows.");
      expect(s.amender.pushed).toEqual(["Also say 48 is the most any printer allows."]);
      expect(amendmentOf(s.id).takenOver).toBe(true);
      await s.amender.end({ kind: "ok", report: amended(false) });
      await waitFor(() => hive.card(s.id).state === "needs-you");
      expect(hive.card(s.id)).toMatchObject({ lane: "spec", spec: { review: "skipped" } });
      expect(turnsOf("planner")).toHaveLength(1);
      expect(notes(s.id)).toContain("You wrote in the chat, so Sign off is yours for this amendment.");
      await hive.signoff(s.id);
      expect(hive.card(s.id).lane).toBe("plan");
      expect(amendmentOf(s.id)).toMatchObject({ signedOff: "you", reviewed: false });
    });

    it("offers Retry on an amendment turn without a report, and Retry sends the same message with the amendment report", async () => {
      const s = await amending();
      await s.amender.end({ kind: "ok" });
      await waitFor(() => hive.card(s.id).state === "needs-you");
      expect(hive.card(s.id).chat.at(-1)).toMatchObject({
        kind: "error", message: "The spec writer didn't report on the amendment. Retry asks it again.", actions: ["retry"],
      });
      hive.retry(s.id);
      const again = lastOf("spec-writer");
      expect(again.request.message).toBe(s.amender.request.message);
      expect(again.request.outputFormat).toBe(AMENDMENT_SCHEMA);
      await signedOffOnItsOwn(s.id, again);
    });

    it("after a failed amendment turn, chatting makes it an ordinary Spec visit: a review you start finishes, and you sign off", async () => {
      const s = await amending();
      await s.amender.end({ kind: "ok", report: { status: "blocked", blockedReason: "Which printers?", summary: "", review: false, reason: "" } });
      await waitFor(() => hive.card(s.id).state === "needs-you");
      hive.sendMessage(s.id, "All of them. Make the limit 32.");
      expect(amendmentOf(s.id)).toMatchObject({ step: "spec", takenOver: true });
      const chat = lastOf("spec-writer");
      expect(chat.request.outputFormat).toBeUndefined();
      await chat.end();
      await waitFor(() => hive.card(s.id).state === "needs-you");
      expect(hive.card(s.id).chat.at(-1)?.kind).not.toBe("error");

      hive.review(s.id);
      const finding = { kind: "fix", category: "Ambiguity", where: "Design", stakes: "Unclear limit.", options: ["Say 32"] };
      await lastOf("spec-reviewer").end({ kind: "ok", report: { status: "done", blockedReason: null, summary: "", findings: [finding] } });
      const applying = lastOf("spec-writer");
      await applying.end();
      await waitFor(() => hive.card(s.id).spec?.review === "fresh");
      expect(turnsOf("planner")).toHaveLength(1);
      await hive.signoff(s.id);
      expect(hive.card(s.id).lane).toBe("plan");
      expect(amendmentOf(s.id)).toMatchObject({ signedOff: "you", reviewed: true });
    });

    it("leaves the card in Spec for you when signing off on its own fails", async () => {
      const s = await amending();
      failAmendmentCommit = true;
      await s.amender.end({ kind: "ok", report: amended(false) });
      await waitFor(() => hive.card(s.id).chat.at(-1)?.kind === "error");
      expect(hive.card(s.id)).toMatchObject({ lane: "spec", spec: { review: "skipped" } });
      expect(hive.card(s.id).chat.at(-1)).toMatchObject({
        kind: "error", message: "Amendment 1 couldn't sign off on its own: Unable to create index.lock. Press Sign off.", actions: [],
      });
      expect(amendmentOf(s.id).signedOff).toBeNull();
      failAmendmentCommit = false;
      await hive.signoff(s.id);
      expect(hive.card(s.id).lane).toBe("plan");
      expect(amendmentOf(s.id).signedOff).toBe("you");
      expect(readFileSync(s.specFile, "utf8")).toContain("The limit is 32.");
    });

    it("Back to Spec from a blocked plan stays in the amendment, and it signs off on its own again", async () => {
      const s = await amending([limit, crash]);
      const planner = await signedOffOnItsOwn(s.id, s.amender);
      await planner.end({ kind: "ok", report: { status: "blocked", blockedReason: "32 doesn't fit the field.", steps: [], chunks: [], tests: [] } });
      await waitFor(() => hive.card(s.id).state === "needs-you");
      const writers = turnsOf("spec-writer").length;
      await hive.backToSpec(s.id);
      await waitFor(() => turnsOf("spec-writer").length === writers + 1);
      const again = lastOf("spec-writer");
      expect(hive.card(s.id)).toMatchObject({ lane: "spec", amendment: { n: 1 }, feedback: "The limit should be 32, not 24." });
      expect(again.request.outputFormat).toBe(AMENDMENT_SCHEMA);
      expect(again.request.message).toContain("Amendment 1 to the spec at");
      expect(again.request.message).toContain("32 doesn't fit the field.");
      expect(amendmentOf(s.id)).toMatchObject({ step: "amending", signedOff: null });
      const replanner = await signedOffOnItsOwn(s.id, again);
      expect(replanner.request.message).toMatch(/^This is Amendment 1 to the spec/);
    });

    it("resumes an amendment turn cut off by a restart", async () => {
      const s = await amending();
      const restarted = newHive();
      restarted.recoverAfterRestart();
      expect(runner.last.request.sessionId).toBe(s.amender.request.sessionId);
      expect(runner.last.request.message).toMatch(/Finish the amendment/);
      expect(runner.last.request.outputFormat).toBe(AMENDMENT_SCHEMA);
      restarted.close();
    });
  });
});
