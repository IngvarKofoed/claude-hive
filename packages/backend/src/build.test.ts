// The Build lane (docs/specs/2026-11-26-build-lane-developer.md), driven through a fake runner on a throwaway repo.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { Hive } from "./hive";
import type { Role } from "./sessions/types";
import { DEVELOPER_SCHEMA } from "./spec/reports";
import { FakeProbe, FakeRunner, type FakeTurn, makeRepo, makeSpecFormat, waitFor, type TempRepo } from "./testing";

const brief = {
  title: "Printer font size", problem: "Labels are too small.", whoItsFor: "People with low vision",
  whatDoneLooksLike: ["Each printer has a size"], outOfScope: [], openPoints: [],
};

const plan = {
  status: "done", blockedReason: null,
  steps: [{ title: "Add the setting", detail: "A size per printer.", chunk: "core", check: "unit test" }],
  chunks: [{ name: "core", owns: ["src/fonts.ts"], model: "opus" }, { name: "ui", owns: ["src/ui.ts"], model: "sonnet" }],
  tests: ["clamps to 8–48"],
};

const done = {
  status: "done", blockedReason: null,
  summary: "Added a font size per printer.",
  departures: [{ step: "Add the setting", what: "Stored it in prefs.json", why: "There is no settings table." }],
  issues: [{ where: "Design, Storage", problem: "The spec names a settings table that doesn't exist.", guess: "prefs.json" }],
  decisions: [{ what: "Default size 12", alternative: "Default size 10" }],
};

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

describe("Build lane", () => {
  let db: HiveDb;
  let runner: FakeRunner;
  let hive: Hive;
  let repo: TempRepo;
  let format: ReturnType<typeof makeSpecFormat>;
  let brokenRoles: Set<string>;

  const role = (name: string): Role => {
    if (brokenRoles.has(name)) throw new Error(`roles/${name}.md is broken`);
    return { name, model: "opus", kind: name === "spec-reviewer" ? "one-off" : "conversation", instructions: `Be the ${name}.` };
  };
  const newHive = () =>
    new Hive({ db, hub: new EventHub(), git, runner, probe: new FakeProbe(), role, log: () => {}, specFormatDir: format.dir, today: () => "2026-11-26" });

  beforeEach(() => {
    db = new HiveDb(":memory:");
    runner = new FakeRunner();
    brokenRoles = new Set();
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

  /** End a turn and wait for the hive to finish handling it, git included. */
  async function endTurn(turn: FakeTurn, outcome: Parameters<FakeTurn["end"]>[0], id: string) {
    await turn.end(outcome);
    await waitFor(() => hive.card(id).state === "needs-you" || hive.card(id).lane !== "build");
  }

  /** A card whose spec is signed off and whose planner is running. */
  async function inPlan() {
    await hive.addProject(repo.root);
    const project = hive.board().projects[0]!;
    const card = hive.createCard(project.id, "Make the printer font adjustable.");
    await hive.moveCard(card.id, "refine");
    const po = runner.last;
    await po.request.hiveTools!.writeBrief(brief);
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
    return { id: card.id, worktree: detail.worktreePath!, planner: runner.last };
  }

  /** A card in Build, its developer's first turn running. */
  async function inBuild() {
    const s = await inPlan();
    await s.planner.end({ kind: "ok", report: plan });
    await waitFor(() => turnsOf("developer").length === 1);
    const developer = lastOf("developer");
    developer.handlers.onSessionCreated();
    return { ...s, developer };
  }

  describe("starting the developer", () => {
    it("brings in main, then starts the developer with the spec, the merge and the plan", async () => {
      const { id, developer } = await inBuild();
      const card = hive.card(id);
      expect(card.lane).toBe("build");
      expect(card.state).toBe("working");
      expect(card.chat[0]).toMatchObject({ kind: "message", from: "hive", text: "Main was already in." });
      expect(developer.request.resume).toBe(false);
      expect(developer.request.outputFormat).toBe(DEVELOPER_SCHEMA);
      expect(developer.request.role.model).toBe("opus");
      expect(developer.request.message).toContain(card.spec!.path);
      expect(developer.request.message).toContain("Bringing in main: main was already in this branch.");
      expect(developer.request.message).toContain("1. Add the setting [chunk: core]");
      expect(developer.request.message).toContain("- ui (sonnet): src/ui.ts");
    });

    it("merges new commits on main into the card's branch first", async () => {
      const s = await inPlan();
      writeFileSync(join(repo.root, "news.txt"), "new on main\n");
      repo.git("add", "news.txt");
      repo.git("commit", "-q", "-m", "news on main");
      await s.planner.end({ kind: "ok", report: plan });
      await waitFor(() => turnsOf("developer").length === 1);
      expect(hive.card(s.id).chat[0]).toMatchObject({ text: "Brought in main: 1 new commit." });
      expect(existsSync(join(s.worktree, "news.txt"))).toBe(true);
    });

    it("hands a merge that stopped on conflicts to the developer as its first job", async () => {
      const s = await inPlan();
      writeFileSync(join(s.worktree, "app.txt"), "card\n");
      sh(s.worktree, "commit", "-qam", "card change");
      writeFileSync(join(repo.root, "app.txt"), "main\n");
      repo.git("commit", "-qam", "main change");
      await s.planner.end({ kind: "ok", report: plan });
      await waitFor(() => turnsOf("developer").length === 1);
      expect(hive.card(s.id).chat[0]).toMatchObject({ text: expect.stringContaining("stopped on conflicts in app.txt") });
      expect(lastOf("developer").request.message).toMatch(/conflicts in app\.txt\. Resolve them and commit the merge first/);
    });

    it("offers Retry when the role can't load, and Retry brings in main and starts the developer", async () => {
      const s = await inPlan();
      brokenRoles.add("developer");
      await s.planner.end({ kind: "ok", report: plan });
      await waitFor(() => hive.card(s.id).chat.some((c) => c.kind === "error"));
      expect(hive.card(s.id)).toMatchObject({ lane: "build", state: "needs-you", turnRunning: false });
      expect(hive.card(s.id).chat.at(-1)).toMatchObject({ kind: "error", actions: ["retry"] });

      brokenRoles.clear();
      hive.retry(s.id);
      await waitFor(() => turnsOf("developer").length === 1);
      expect(lastOf("developer").request.message).toContain("Bringing in main");
    });
  });

  describe("the developer's report", () => {
    it("stores a done report, commits what's left, lists the changed files, and moves the card to Check", async () => {
      const { id, worktree, developer } = await inBuild();
      writeFileSync(join(worktree, "fonts.ts"), "export const size = 12;\n");
      await endTurn(developer, { kind: "ok", report: done }, id);

      const card = hive.card(id);
      expect(card.lane).toBe("check");
      expect(card.build).toMatchObject({ summary: "Added a font size per printer.", departures: done.departures });
      expect(card.build!.files).toContainEqual({ path: "fonts.ts", added: 1, removed: 0 });
      expect(card.build!.files.some((f) => f.path.startsWith("docs/specs/"))).toBe(true);
      expect(card.issues).toEqual([
        { id: expect.any(String), foundIn: "build", where: "Design, Storage", problem: done.issues[0]!.problem, guess: "prefs.json" },
      ]);
      expect(card.decisions).toEqual([
        { id: expect.any(String), lane: "build", what: "Default size 12", alternative: "Default size 10", source: "developer" },
      ]);
      expect(sh(worktree, "log", "-1", "--format=%s")).toBe("Build: Printer font size");
      expect(sh(worktree, "status", "--porcelain")).toBe("");
      expect(sh(repo.root, "status", "--porcelain")).toBe("");
    });

    it("keeps a blocked report in Build with Retry and Back to Spec", async () => {
      const { id, developer } = await inBuild();
      await endTurn(developer, { kind: "ok", report: { ...done, status: "blocked", blockedReason: "No printers table." } }, id);
      const card = hive.card(id);
      expect(card.lane).toBe("build");
      expect(card.build).toBeNull();
      expect(card.chat.at(-1)).toMatchObject({
        kind: "error", message: "The developer couldn't build this: No printers table.", actions: ["retry", "back-to-spec"],
      });
    });

    it("lets a missing report be retried in the same session", async () => {
      const { id, developer } = await inBuild();
      await endTurn(developer, { kind: "ok" }, id);
      expect(hive.card(id).chat.at(-1)).toMatchObject({ message: "The developer didn't return a report.", actions: ["retry", "back-to-spec"] });
      hive.retry(id);
      expect(runner.last.request.sessionId).toBe(developer.request.sessionId);
      expect(runner.last.request.message).toBe(developer.request.message);
    });

    it("offers Retry after Stop", async () => {
      const { id, developer } = await inBuild();
      await hive.stop(id);
      await waitFor(() => hive.card(id).state === "needs-you");
      expect(developer.interrupted).toBe(true);
      expect(hive.card(id).chat.at(-1)).toMatchObject({ message: "The developer was stopped.", actions: ["retry"] });
    });

    it("doesn't count a done report while the merge of main is unfinished", async () => {
      const s = await inPlan();
      writeFileSync(join(s.worktree, "app.txt"), "card\n");
      sh(s.worktree, "commit", "-qam", "card change");
      writeFileSync(join(repo.root, "app.txt"), "main\n");
      repo.git("commit", "-qam", "main change");
      await s.planner.end({ kind: "ok", report: plan });
      await waitFor(() => turnsOf("developer").length === 1);
      await endTurn(lastOf("developer"), { kind: "ok", report: done }, s.id);

      const card = hive.card(s.id);
      expect(card.lane).toBe("build");
      expect(card.build).toBeNull();
      expect(card.issues).toEqual([]);
      expect(card.chat.at(-1)).toMatchObject({
        message: "The developer reported done, but the merge of main isn't finished.", actions: ["retry", "back-to-spec"],
      });
    });

    it("keeps the report when git refuses the checkpoint, and Retry commits it without running the developer again", async () => {
      const { id, worktree, developer } = await inBuild();
      writeFileSync(join(worktree, "fonts.ts"), "export const size = 12;\n");
      const lock = join(sh(worktree, "rev-parse", "--absolute-git-dir"), "index.lock");
      writeFileSync(lock, "");
      await endTurn(developer, { kind: "ok", report: done }, id);
      expect(hive.card(id)).toMatchObject({ lane: "build", build: { summary: done.summary } });
      expect(hive.card(id).issues).toHaveLength(1);
      expect(hive.card(id).chat.at(-1)).toMatchObject({ kind: "error", actions: ["retry"] });

      execFileSync("rm", [lock]);
      const turns = runner.turns.length;
      hive.retry(id);
      await waitFor(() => hive.card(id).lane === "check");
      expect(runner.turns.length).toBe(turns);
      expect(hive.card(id).build!.files).toContainEqual({ path: "fonts.ts", added: 1, removed: 0 });
      expect(hive.card(id).issues).toHaveLength(1);
    });
  });

  describe("Back to Spec from Build", () => {
    it("commits the partial work, reaches the spec writer, and resumes the same developer after a new sign-off", async () => {
      const { id, worktree, developer, planner } = await inBuild();
      writeFileSync(join(worktree, "half.ts"), "// half done\n");
      await endTurn(developer, { kind: "ok", report: { ...done, status: "blocked", blockedReason: "No printers table." } }, id);

      await hive.backToSpec(id);
      expect(hive.card(id).lane).toBe("spec");
      expect(sh(worktree, "log", "-1", "--format=%s")).toBe("Build (unfinished): Printer font size");
      const writer = runner.last;
      expect(writer.request.role.name).toBe("spec-writer");
      expect(writer.request.message).toMatch(/The developer couldn't build from the signed-off spec/);
      expect(writer.request.message).toContain("No printers table.");

      const path = join(worktree, hive.card(id).spec!.path);
      writeFileSync(path, "# Printer font size\n\nRevised.\n");
      await writer.end();
      hive.review(id);
      await runner.last.end({ kind: "ok", report: { status: "done", blockedReason: null, summary: "", findings: [] } });
      await hive.signoff(id);
      expect(runner.last.request.sessionId).toBe(planner.request.sessionId);
      await runner.last.end({ kind: "ok", report: plan });
      await waitFor(() => turnsOf("developer").length === 2);
      const again = lastOf("developer");
      expect(again.request.sessionId).toBe(developer.request.sessionId);
      expect(again.request.resume).toBe(true);
      expect(again.request.message).toMatch(/revised and signed off again/);
    });

    it("aborts an unfinished merge of main before committing the partial work", async () => {
      const s = await inPlan();
      writeFileSync(join(s.worktree, "app.txt"), "card\n");
      sh(s.worktree, "commit", "-qam", "card change");
      writeFileSync(join(repo.root, "app.txt"), "main\n");
      repo.git("commit", "-qam", "main change");
      await s.planner.end({ kind: "ok", report: plan });
      await waitFor(() => turnsOf("developer").length === 1);
      await endTurn(lastOf("developer"), { kind: "ok", report: { ...done, status: "blocked", blockedReason: "Can't resolve." } }, s.id);

      await hive.backToSpec(s.id);
      expect(await git.mergeInProgress(s.worktree)).toBe(false);
      expect(readFileSync(join(s.worktree, "app.txt"), "utf8")).toBe("card\n");
      expect(sh(s.worktree, "status", "--porcelain")).toBe("");
    });

    it("is refused for a build that isn't blocked", async () => {
      const { id } = await inBuild();
      await expect(hive.backToSpec(id)).rejects.toThrow(/Wait for the developer/);
    });
  });

  describe("after a restart", () => {
    it("resumes a cut-off developer turn", async () => {
      await inBuild();
      const before = runner.turns.length;
      const restarted = newHive();
      restarted.recoverAfterRestart();
      expect(runner.turns.length).toBe(before + 1);
      expect(runner.last.request.message).toMatch(/Carry on building to the plan/);
      expect(runner.last.request.resume).toBe(true);
      restarted.close();
    });

    it("offers Retry on a card in Build that never started, and Retry starts it", async () => {
      const s = await inPlan();
      brokenRoles.add("developer");
      await s.planner.end({ kind: "ok", report: plan });
      await waitFor(() => hive.card(s.id).chat.some((c) => c.kind === "error"));
      // As for a card planned before this slice: no developer, and no error line yet.
      db.db.prepare("DELETE FROM events WHERE type = 'error'").run();
      brokenRoles.clear();

      const restarted = newHive();
      restarted.recoverAfterRestart();
      expect(restarted.card(s.id).chat.at(-1)).toMatchObject({ kind: "error", message: "Build hasn't started yet.", actions: ["retry"] });
      restarted.recoverAfterRestart(); // a second start doesn't add a second line
      expect(restarted.card(s.id).chat.filter((c) => c.kind === "error")).toHaveLength(1);
      restarted.retry(s.id);
      await waitFor(() => turnsOf("developer").length === 1);
      restarted.close();
    });

    it("offers Retry on a stored report whose checkpoint the hive never committed", async () => {
      const { id, worktree, developer } = await inBuild();
      writeFileSync(join(worktree, "fonts.ts"), "x\n");
      const lock = join(sh(worktree, "rev-parse", "--absolute-git-dir"), "index.lock");
      writeFileSync(lock, "");
      await endTurn(developer, { kind: "ok", report: done }, id);
      db.db.prepare("DELETE FROM events WHERE type = 'error'").run();
      execFileSync("rm", [lock]);

      const restarted = newHive();
      restarted.recoverAfterRestart();
      expect(restarted.card(id).chat.at(-1)).toMatchObject({ message: expect.stringMatching(/checkpoint wasn't committed/) });
      restarted.retry(id);
      await waitFor(() => restarted.card(id).lane === "check");
      restarted.close();
    });
  });

  it("puts the developer's questions to you on the card", async () => {
    const { id, developer } = await inBuild();
    const answer = developer.handlers.canUseTool(
      "AskUserQuestion",
      { questions: [{ question: "Round up or down?", header: "Rounding", options: [{ label: "Up", description: "" }], multiSelect: false }] },
      new AbortController().signal,
    );
    await waitFor(() => hive.card(id).pending !== null);
    expect(hive.card(id)).toMatchObject({ state: "needs-you", pending: { kind: "question" } });
    hive.answer(hive.card(id).pending!.id, { answers: { "Round up or down?": "Up" } });
    await expect(answer).resolves.toMatchObject({ behavior: "allow" });
  });
});
