// The Check lane (docs/specs/2026-11-27-check-lane-reviewer.md), driven through a fake runner on a throwaway repo.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { Hive } from "./hive";
import type { Role } from "./sessions/types";
import { CHECK_SCHEMA } from "./spec/reports";
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

const built = {
  status: "done", blockedReason: null,
  summary: "Added a font size per printer.",
  departures: [{ step: "Add the setting", what: "Stored it in prefs.json", why: "There is no settings table." }],
  issues: [{ where: "Design, Storage", problem: "The spec names a settings table that doesn't exist.", guess: "prefs.json" }],
  decisions: [{ what: "Default size 12", alternative: "Default size 10" }],
};

const review = (bugs: { where: string; problem: string }[], issues: { where: string; problem: string; guess: string }[] = []) => ({
  status: "done", blockedReason: null, summary: bugs.length ? "Found bugs." : "Looks right.", bugs, issues,
});
const clampBug = { where: "src/fonts.ts:4", problem: "Sizes above 48 aren't clamped." };
const defaultBug = { where: "src/ui.ts:10", problem: "The default isn't 12." };

describe("Check lane", () => {
  let db: HiveDb;
  let runner: FakeRunner;
  let hive: Hive;
  let repo: TempRepo;
  let format: ReturnType<typeof makeSpecFormat>;
  let brokenRoles: Set<string>;
  let hub: EventHub;

  const role = (name: string): Role => {
    if (brokenRoles.has(name)) throw new Error(`roles/${name}.md is broken`);
    return { name, model: "opus", kind: name === "spec-reviewer" ? "one-off" : "work", instructions: `Be the ${name}.` };
  };
  const newHive = () =>
    new Hive({ db, hub, git, runner, probe: new FakeProbe(), role, log: () => {}, specFormatDir: format.dir, today: () => "2026-11-27" });

  beforeEach(() => {
    db = new HiveDb(":memory:");
    runner = new FakeRunner();
    brokenRoles = new Set();
    hub = new EventHub();
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

  /** A card whose spec is signed off and whose planner is running. */
  async function inPlan() {
    await hive.addProject(repo.root);
    const project = hive.board().projects[0]!;
    const card = hive.createCard(project.id, "Font", "Make the printer font adjustable.");
    await hive.moveCard(card.id, "refine");
    await waitFor(() => hive.card(card.id).setup?.status === "done"); // the worktree's setup, in the background
    const po = runner.last;
    await po.request.hiveTools!.writeBrief!(brief);
    po.handlers.onSessionCreated();
    await po.end();
    await hive.good(card.id);
    const writer = runner.last;
    const detail = hive.card(card.id);
    writeFileSync(join(detail.worktreePath!, detail.spec!.path), "# Printer font size\n\nThe spec.\n");
    writer.handlers.onSessionCreated();
    await writer.end();
    hive.review(card.id);
    await runner.last.end({ kind: "ok", report: { status: "done", blockedReason: null, summary: "", findings: [] } });
    await hive.signoff(card.id);
    const planner = runner.last;
    planner.handlers.onSessionCreated();
    return { id: card.id, worktree: detail.worktreePath!, planner, writer };
  }

  /** The developer's turn ends with this report; waits until the next reviewer is running. */
  async function developerReports(id: string, developer: FakeTurn, report: object = built) {
    const reviewers = turnsOf("reviewer").length;
    await developer.end({ kind: "ok", report });
    await waitFor(() => turnsOf("reviewer").length === reviewers + 1);
    const reviewer = lastOf("reviewer");
    reviewer.handlers.onSessionCreated();
    return reviewer;
  }

  /** A card in Check, its first round's reviewer running. */
  async function inCheck() {
    const s = await inPlan();
    await s.planner.end({ kind: "ok", report: plan });
    await waitFor(() => turnsOf("developer").length === 1);
    const developer = lastOf("developer");
    developer.handlers.onSessionCreated();
    const reviewer = await developerReports(s.id, developer);
    return { ...s, developer, reviewer };
  }

  /** End a reviewer's turn and wait until the hive has routed the card. */
  async function reviewerEnds(id: string, reviewer: FakeTurn, outcome: Parameters<FakeTurn["end"]>[0]) {
    await reviewer.end(outcome);
    await waitFor(() => hive.card(id).lane !== "check" || hive.card(id).state === "needs-you");
  }

  /** A failing round 1 sends the card back; waits for the developer's next turn. */
  async function failRound(id: string, reviewer: FakeTurn, bugs: { where: string; problem: string }[]) {
    const developers = turnsOf("developer").length;
    await reviewer.end({ kind: "ok", report: review(bugs) });
    await waitFor(() => turnsOf("developer").length === developers + 1);
    return lastOf("developer");
  }

  describe("a round", () => {
    it("starts a reviewer as soon as the build is done, with the report, issues and decisions", async () => {
      const { id, reviewer } = await inCheck();
      const card = hive.card(id);
      expect(card).toMatchObject({ lane: "check", state: "working", check: null });
      expect(card.chat[0]).toMatchObject({ from: "hive", text: "Round 1: the reviewer is reading the branch." });
      expect(reviewer.request.outputFormat).toBe(CHECK_SCHEMA);
      expect(reviewer.request.resume).toBe(false);
      const message = reviewer.request.message;
      expect(message).toContain("Check round 1");
      expect(message).toContain("git diff main...HEAD");
      expect(message).toContain(card.spec!.path);
      expect(message).toContain("Added a font size per printer.");
      expect(message).toContain("Add the setting: Stored it in prefs.json (There is no settings table.)");
      expect(message).toContain("Design, Storage: The spec names a settings table that doesn't exist.");
      expect(message).toContain("Default size 12");
      expect(message).not.toContain("found these bugs");
    });

    it("shows the reviewer's messages in Check's chat", async () => {
      const { id, reviewer } = await inCheck();
      reviewer.handlers.onTextBlock("Reading the diff.");
      expect(hive.card(id).chat.at(-1)).toMatchObject({ kind: "message", from: "reviewer", text: "Reading the diff." });
    });

    it("moves a round without bugs to Try it, storing its issues", async () => {
      const { id, reviewer } = await inCheck();
      const issue = { where: "Design, Defaults", problem: "The spec doesn't say what new printers get.", guess: "12" };
      await reviewerEnds(id, reviewer, { kind: "ok", report: review([], [issue]) });
      const card = hive.card(id);
      expect(card.lane).toBe("tryit");
      expect(card.check).toEqual({ round: 1, summary: "Looks right.", bugs: [] });
      expect(card.issues.map((i) => i.foundIn)).toEqual(["build", "check"]);
      expect(card.issues[1]).toMatchObject(issue);
      expect(db.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'check'").get()).toEqual({ n: 1 });
      expect(hive.card(id).build).toMatchObject({ summary: built.summary });
    });
  });

  describe("bugs go back to the same developer", () => {
    it("sends round 1's bugs to the developer, after bringing in main again, and runs round 2", async () => {
      const { id, developer, reviewer } = await inCheck();
      const fixer = await failRound(id, reviewer, [clampBug, defaultBug]);
      const card = hive.card(id);
      expect(card).toMatchObject({ lane: "build", build: null });
      expect(card.check).toMatchObject({ round: 1, bugs: [clampBug, defaultBug] });
      expect(fixer.request.sessionId).toBe(developer.request.sessionId);
      expect(fixer.request.resume).toBe(true);
      expect(fixer.request.message).toMatch(/^Check round 1 found bugs in the branch/);
      expect(fixer.request.message).toContain("Bringing in main: main was already in this branch.");
      expect(fixer.request.message).toContain("- src/fonts.ts:4: Sizes above 48 aren't clamped.");
      expect(fixer.request.message).toContain("end your summary with the bugs you left and why");
      expect(fixer.request.message).toContain("describe the whole build as it stands now");
      expect(fixer.request.message).not.toContain("The plan:");
      const notes = card.chat.filter((c) => c.kind === "message").map((c) => c.kind === "message" && c.text);
      expect(notes).toContain("Check round 1 found 2 bugs. The developer is fixing them.");

      const second = await developerReports(id, fixer, { ...built, summary: "Clamped and defaulted.", issues: [], decisions: [] });
      expect(second.request.sessionId).not.toBe(reviewer.request.sessionId);
      expect(second.request.message).toContain("Check round 2");
      expect(second.request.message).toContain("Clamped and defaulted.");
      expect(second.request.message).toContain("Round 1 found these bugs");
      expect(second.request.message).toContain("src/ui.ts:10: The default isn't 12.");
      expect(hive.card(id).chat.at(-1)).toMatchObject({ text: "Round 2: the reviewer is reading the branch." });

      await reviewerEnds(id, second, { kind: "ok", report: review([]) });
      expect(hive.card(id)).toMatchObject({ lane: "tryit", check: { round: 2, bugs: [] } });
    });

    it("stops in Check when round 2 still finds bugs, with Back to Build and Move on", async () => {
      const { id, reviewer } = await inCheck();
      const fixer = await failRound(id, reviewer, [clampBug]);
      const second = await developerReports(id, fixer);
      await reviewerEnds(id, second, { kind: "ok", report: review([defaultBug]) });
      const card = hive.card(id);
      expect(card).toMatchObject({ lane: "check", state: "needs-you", check: { round: 2, bugs: [defaultBug] } });
      expect(card.chat.at(-1)).toMatchObject({
        kind: "error",
        message: expect.stringMatching(/^Round 2 still found 1 bug, and Check runs only 2 rounds without you/),
        actions: ["back-to-build", "move-on"],
      });

      await hive.moveOn(id);
      expect(hive.card(id).lane).toBe("tryit");
      expect(db.chatFor(id, "check").at(-1)).toMatchObject({ kind: "message", from: "hive", text: "You moved the card on to Try it as built." });
    });

    it("tells the page the round that stopped the card, since the card stays in Check", async () => {
      const { id, reviewer } = await inCheck();
      const second = await developerReports(id, await failRound(id, reviewer, [clampBug]));
      const events: unknown[] = [];
      hub.subscribe((event) => events.push(event));
      await reviewerEnds(id, second, { kind: "ok", report: review([defaultBug], [{ where: "Outcome", problem: "silent", guess: "kept" }]) });
      expect(events).toContainEqual(expect.objectContaining({
        type: "check.updated", cardId: id, check: expect.objectContaining({ round: 2, bugs: [defaultBug] }),
        issues: expect.arrayContaining([expect.objectContaining({ foundIn: "check", where: "Outcome" })]),
      }));
    });

    it("gives the developer one more round on Back to Build, and stops again if it still finds bugs", async () => {
      const { id, developer, reviewer } = await inCheck();
      const second = await developerReports(id, await failRound(id, reviewer, [clampBug]));
      await reviewerEnds(id, second, { kind: "ok", report: review([defaultBug]) });

      const developers = turnsOf("developer").length;
      await hive.backToBuild(id);
      await waitFor(() => turnsOf("developer").length === developers + 1);
      const fixer = lastOf("developer");
      expect(hive.card(id)).toMatchObject({ lane: "build", build: null });
      expect(fixer.request.sessionId).toBe(developer.request.sessionId);
      expect(fixer.request.message).toMatch(/^Check round 2 found bugs/);
      expect(fixer.request.message).toContain("src/ui.ts:10: The default isn't 12.");

      const third = await developerReports(id, fixer);
      expect(third.request.message).toContain("Check round 3");
      await reviewerEnds(id, third, { kind: "ok", report: review([defaultBug]) });
      expect(hive.card(id)).toMatchObject({ lane: "check", check: { round: 3 } });
      expect(hive.card(id).chat.at(-1)).toMatchObject({ actions: ["back-to-build", "move-on"] });
    });

    it("refuses Back to Build and Move on unless the card's last line offers them", async () => {
      const { id, reviewer } = await inCheck();
      await expect(hive.moveOn(id)).rejects.toThrow(/Wait for the running turn/);
      await reviewerEnds(id, reviewer, { kind: "ok", interrupted: true });
      await expect(hive.backToBuild(id)).rejects.toThrow(/isn't on offer/);
      await expect(hive.moveOn(id)).rejects.toThrow(/isn't on offer/);
    });

    it("starts the developer with the bugs on Retry, when it couldn't start after a failed round", async () => {
      const { id, reviewer } = await inCheck();
      brokenRoles.add("developer");
      await reviewer.end({ kind: "ok", report: review([clampBug]) });
      await waitFor(() => hive.card(id).chat.some((c) => c.kind === "error"));
      expect(hive.card(id).chat.at(-1)).toMatchObject({ kind: "error", message: expect.stringMatching(/^Build couldn't start/) });

      brokenRoles.clear();
      const developers = turnsOf("developer").length;
      hive.retry(id);
      await waitFor(() => turnsOf("developer").length === developers + 1);
      expect(lastOf("developer").request.message).toMatch(/^Check round 1 found bugs/);
    });
  });

  describe("a reviewer without a usable report", () => {
    it("offers Retry and Move on for a blocked or missing report, and Retry starts a new reviewer for the same round", async () => {
      const { id, reviewer } = await inCheck();
      await reviewerEnds(id, reviewer, { kind: "ok", report: { status: "blocked", blockedReason: "The spec file is empty.", summary: "", bugs: [], issues: [] } });
      expect(hive.card(id).chat.at(-1)).toMatchObject({
        kind: "error", message: "The reviewer couldn't review this: The spec file is empty.", actions: ["retry", "move-on"],
      });

      hive.retry(id);
      const again = lastOf("reviewer");
      expect(again.request.sessionId).not.toBe(reviewer.request.sessionId);
      expect(again.request.message).toContain("Check round 1");
      await reviewerEnds(id, again, { kind: "ok" });
      expect(hive.card(id).chat.at(-1)).toMatchObject({
        kind: "error", message: "The reviewer didn't return a report.", actions: ["retry", "move-on"],
      });
      expect(hive.card(id).check).toBeNull();
    });

    it("offers only Retry when the reviewer is stopped or fails", async () => {
      const { id, reviewer } = await inCheck();
      await hive.stop(id);
      await waitFor(() => hive.card(id).state === "needs-you");
      expect(hive.card(id).chat.at(-1)).toMatchObject({ kind: "error", message: "The reviewer was stopped.", actions: ["retry"] });
      expect(reviewer.interrupted).toBe(true);

      hive.retry(id);
      await reviewerEnds(id, lastOf("reviewer"), { kind: "error", message: "Not logged in" });
      expect(hive.card(id).chat.at(-1)).toMatchObject({ kind: "error", message: "The reviewer failed: Not logged in", actions: ["retry"] });
    });

    it("says why Check couldn't start when the role file is broken, and Retry starts it", async () => {
      const s = await inPlan();
      await s.planner.end({ kind: "ok", report: plan });
      await waitFor(() => turnsOf("developer").length === 1);
      brokenRoles.add("reviewer");
      await lastOf("developer").end({ kind: "ok", report: built });
      await waitFor(() => hive.card(s.id).lane === "check" && hive.card(s.id).state === "needs-you");
      expect(hive.card(s.id).chat.at(-1)).toMatchObject({ kind: "error", message: expect.stringMatching(/^Check couldn't start: roles\/reviewer.md is broken/), actions: ["retry"] });

      brokenRoles.clear();
      hive.retry(s.id);
      expect(lastOf("reviewer").request.message).toContain("Check round 1");
    });
  });

  it("starts the rounds over when a new plan is done", async () => {
    const { id, reviewer } = await inCheck();
    const fixer = await failRound(id, reviewer, [clampBug]);
    await fixer.end({ kind: "ok", report: { ...built, status: "blocked", blockedReason: "Clamping needs a settings table." } });
    await waitFor(() => hive.card(id).state === "needs-you");

    await hive.backToSpec(id);
    const writer = lastOf("spec-writer");
    const path = join(hive.card(id).worktreePath!, hive.card(id).spec!.path);
    writeFileSync(path, "# Printer font size\n\nRevised.\n");
    await writer.end();
    hive.review(id);
    await runner.last.end({ kind: "ok", report: { status: "done", blockedReason: null, summary: "", findings: [] } });
    await hive.signoff(id);
    const developers = turnsOf("developer").length;
    await runner.last.end({ kind: "ok", report: plan });
    await waitFor(() => turnsOf("developer").length === developers + 1);

    expect(hive.card(id).check).toBeNull();
    expect(lastOf("developer").request.message).toMatch(/^The spec was revised and signed off again/);
    const next = await developerReports(id, lastOf("developer"));
    expect(next.request.message).toContain("Check round 1");
  });

  describe("after a restart", () => {
    it("resumes a cut-off reviewer turn", async () => {
      const { reviewer } = await inCheck();
      const before = runner.turns.length;
      const restarted = newHive();
      restarted.recoverAfterRestart();
      expect(runner.turns.length).toBe(before + 1);
      expect(runner.last.request.sessionId).toBe(reviewer.request.sessionId);
      expect(runner.last.request.resume).toBe(true);
      expect(runner.last.request.message).toMatch(/Finish the review and report/);
      restarted.close();
    });

    it("sends a cut-off reviewer's first message again when its session was never created", async () => {
      const s = await inPlan();
      await s.planner.end({ kind: "ok", report: plan });
      await waitFor(() => turnsOf("developer").length === 1);
      const developer = lastOf("developer");
      developer.handlers.onSessionCreated();
      await developer.end({ kind: "ok", report: built });
      await waitFor(() => turnsOf("reviewer").length === 1);
      const reviewer = lastOf("reviewer"); // cut off before Claude Code created its session
      const restarted = newHive();
      restarted.recoverAfterRestart();
      expect(runner.last.request.sessionId).toBe(reviewer.request.sessionId);
      expect(runner.last.request.resume).toBe(false);
      expect(runner.last.request.message).toBe(reviewer.request.message);
      restarted.close();
    });

    it("offers Retry on a card in Check that never started, and Retry starts round 1", async () => {
      const { id, reviewer } = await inCheck();
      // As for a card that reached Check before this slice: nothing running, and no line offering a way on.
      await reviewer.end({ kind: "ok", interrupted: true });
      await waitFor(() => hive.card(id).state === "needs-you");
      db.db.prepare("DELETE FROM events WHERE type = 'error'").run();

      const restarted = newHive();
      restarted.recoverAfterRestart();
      expect(restarted.card(id).chat.at(-1)).toMatchObject({ kind: "error", message: "Check hasn't started yet.", actions: ["retry"] });
      restarted.recoverAfterRestart(); // a second start doesn't add a second line
      expect(restarted.card(id).chat.filter((c) => c.kind === "error")).toHaveLength(1);
      restarted.retry(id);
      expect(lastOf("reviewer").request.message).toContain("Check round 1");
      restarted.close();
    });

    it("leaves a card that Check stopped as it is", async () => {
      const { id, reviewer } = await inCheck();
      const second = await developerReports(id, await failRound(id, reviewer, [clampBug]));
      await reviewerEnds(id, second, { kind: "ok", report: review([defaultBug]) });
      const restarted = newHive();
      restarted.recoverAfterRestart();
      expect(restarted.card(id).chat.at(-1)).toMatchObject({ actions: ["back-to-build", "move-on"] });
      restarted.close();
    });
  });

  describe("the developer's checklist (docs/specs/2026-11-28-build-lane-checklist.md)", () => {
    const item = (text: string, status: "pending" | "in_progress" | "completed", id: string | null = null) =>
      ({ id, text, status });

    it("stores the developer's own list, sends it live, and asks for one on every entry to Build", async () => {
      const s = await inPlan();
      await s.planner.end({ kind: "ok", report: plan });
      await waitFor(() => turnsOf("developer").length === 1);
      const developer = lastOf("developer");
      expect(developer.request.message).toContain("Keep a task list as you work");
      // Only the developer's sessions get Claude Code's task-list tools.
      expect(developer.request.taskTools).toBe(true);
      expect(s.planner.request.taskTools).toBeUndefined();
      const sent: unknown[] = [];
      hub.subscribe((e) => e.type === "checklist.updated" && sent.push(e.checklist));

      developer.handlers.onChecklist({ kind: "replace", items: [item("Add the setting", "in_progress"), item("Tests", "pending")] });
      expect(hive.card(s.id).checklist).toEqual([item("Add the setting", "in_progress"), item("Tests", "pending")]);
      developer.handlers.onChecklist({ kind: "replace", items: [item("Add the setting", "completed"), item("Tests", "pending")] });
      expect(sent).toEqual([
        [item("Add the setting", "in_progress"), item("Tests", "pending")],
        [item("Add the setting", "completed"), item("Tests", "pending")],
      ]);
      // An update that changes nothing sends nothing.
      developer.handlers.onChecklist({ kind: "update", id: "9", status: "completed" });
      expect(sent).toHaveLength(2);
      // Kept in the database, so a restarted hive shows it as it was.
      const restarted = newHive();
      expect(restarted.card(s.id).checklist).toEqual([item("Add the setting", "completed"), item("Tests", "pending")]);
      restarted.close();
    });

    it("keeps the list when the card comes back to Build, where the same developer carries it on", async () => {
      const { id, developer, reviewer } = await inCheck();
      developer.handlers.onChecklist({ kind: "add", id: "1", text: "Add the setting" });
      developer.handlers.onChecklist({ kind: "update", id: "1", status: "completed" });
      const fixing = await failRound(id, reviewer, [clampBug]);
      expect(fixing.request.resume).toBe(true);
      expect(fixing.request.message).toContain("Keep a task list as you work");
      expect(hive.card(id).checklist).toEqual([item("Add the setting", "completed", "1")]);
      fixing.handlers.onChecklist({ kind: "add", id: "2", text: "Clamp sizes above 48" });
      expect(hive.card(id).checklist).toEqual([item("Add the setting", "completed", "1"), item("Clamp sizes above 48", "pending", "2")]);
    });

    it("reads only the developer's list, and starts it empty for a new developer session", async () => {
      const s = await inPlan();
      s.planner.handlers.onChecklist({ kind: "replace", items: [item("Read the spec", "completed")] });
      expect(hive.card(s.id).checklist).toBeNull();
      // A list left from a session that's gone, as if the developer's row had been lost.
      db.updateCard(s.id, { checklist: [item("Old work", "completed")] });
      const sent: unknown[] = [];
      hub.subscribe((e) => e.type === "checklist.updated" && sent.push(e.checklist));
      await s.planner.end({ kind: "ok", report: plan });
      await waitFor(() => turnsOf("developer").length === 1);
      expect(hive.card(s.id).checklist).toBeNull();
      expect(sent).toEqual([[]]);
    });

    it("tells the page which lane sent the card back", async () => {
      const { id } = await inCheck();
      expect(hive.card(id).shipAfterCheck).toBe(false);
      db.updateCard(id, { shipAfterCheck: true });
      expect(hive.card(id).shipAfterCheck).toBe(true);
    });
  });
});
