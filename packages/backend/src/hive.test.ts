import { realpathSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HiveEvent } from "@hive/shared";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { answerAsMessage, Hive, HttpError, titleFromIdea } from "./hive";
import { FakeProbe, FakeRunner, makeRepo, settle, type TempRepo, waitFor } from "./testing";

const role = (name: string) => ({ name, model: "opus", kind: "conversation", instructions: "Be a product owner." });

describe("Hive", () => {
  let db: HiveDb;
  let hub: EventHub;
  let runner: FakeRunner;
  let probe: FakeProbe;
  let hive: Hive;
  let events: HiveEvent[];
  let repos: TempRepo[];

  const newHive = () => new Hive({ db, hub, git, runner, probe, role, log: () => {}, specFormatDir: "/nonexistent" });

  beforeEach(() => {
    db = new HiveDb(":memory:");
    hub = new EventHub();
    runner = new FakeRunner();
    probe = new FakeProbe(true);
    events = [];
    hub.subscribe((e) => events.push(e));
    hive = newHive();
    repos = [];
  });
  afterEach(() => {
    repos.forEach((r) => r.cleanup());
    db.close();
  });

  const repo = (options?: Parameters<typeof makeRepo>[0]) => {
    const r = makeRepo(options);
    repos.push(r);
    return r;
  };

  async function projectWithCard(idea = "Make the printer font adjustable. Some users find it too small.") {
    const r = repo();
    await hive.addProject(r.root);
    const project = hive.board().projects[0]!;
    const card = hive.createCard(project.id, idea);
    return { r, project, card };
  }

  async function inRefine() {
    const setup = await projectWithCard();
    await hive.moveCard(setup.card.id, "refine");
    await waitFor(() => hive.card(setup.card.id).setup?.status === "done"); // the worktree's setup, in the background
    return { ...setup, turn: runner.last };
  }

  describe("projects", () => {
    it("adds a repo by any path inside it, resolved to its root", async () => {
      const r = repo();
      await hive.addProject(r.root + "/.");
      const [p] = hive.board().projects;
      expect(p).toMatchObject({ path: realpathSync(r.root), name: "repo", trustWarning: false });
    });

    it("refuses a non-repo, a repo without main, and the same root twice", async () => {
      await expect(hive.addProject("/definitely/not/here")).rejects.toThrow(HttpError);
      await expect(hive.addProject(repo({ branch: "trunk" }).root)).rejects.toThrow(/no main branch/);
      const r = repo();
      await hive.addProject(r.root);
      await expect(hive.addProject(r.root)).rejects.toMatchObject({ status: 409 });
    });

    it("warns when the repo has a CLAUDE.md that Claude Code doesn't load", async () => {
      probe.loads = false;
      await hive.addProject(repo({ claudeMd: true }).root);
      await settle();
      expect(hive.board().projects[0]!.trustWarning).toBe(true);
      probe.loads = true;
      await hive.checkTrust(hive.board().projects[0]!.id);
      expect(hive.board().projects[0]!.trustWarning).toBe(false);
    });

    it("skips the probe when the repo has no CLAUDE.md", async () => {
      await hive.addProject(repo().root);
      await settle();
      expect(probe.calls).toHaveLength(0);
    });
  });

  describe("cards and the Ideas → Refine move", () => {
    it("titles a card from the idea's first sentence", () => {
      expect(titleFromIdea("Make it adjustable. More text.")).toBe("Make it adjustable.");
      expect(titleFromIdea("x".repeat(80))).toHaveLength(60);
    });

    it("creates the worktree, keeps the checkout clean and starts the product owner", async () => {
      const { r, card, turn } = await inRefine();
      const after = hive.card(card.id);
      expect(after.lane).toBe("refine");
      expect(after.branch).toMatch(/^hive\/make-the-printer-font-adjustable-/);
      expect(r.git("worktree", "list")).toContain(".claude/worktrees/");
      expect(r.git("status", "--porcelain")).toBe("");
      expect(turn.request).toMatchObject({ resume: false, cwd: after.worktreePath });
      expect(turn.request.message).toContain("Make the printer font adjustable");
      expect(after.state).toBe("working");
    });

    it("leaves the card in Ideas with git's reason when the worktree can't be made", async () => {
      const { r, card } = await projectWithCard();
      r.git("branch", `hive/${git.cardSlug(card.title, card.id)}`);
      await expect(hive.moveCard(card.id, "refine")).rejects.toMatchObject({ status: 409 });
      const after = hive.card(card.id);
      expect(after.lane).toBe("ideas");
      expect(after.moveError).toMatch(/already exists/);
      expect(runner.turns).toHaveLength(0);
    });

    it("refuses every other move", async () => {
      const { card } = await projectWithCard();
      await expect(hive.moveCard(card.id, "mockup")).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("turns", () => {
    it("stores each text block as a chat message and hands the turn back to you", async () => {
      const { card, turn } = await inRefine();
      turn.handlers.onTextDelta("Hel");
      turn.handlers.onTextBlock("Hello, I've read the repo.");
      turn.handlers.onActivity("reading src/a.ts…");
      turn.handlers.onTextBlock("Here is a first brief.");
      await turn.end();
      const after = hive.card(card.id);
      // The worktree's setup leaves a note of its own in the chat; the product owner's blocks are these.
      expect(after.chat.filter((c) => c.kind === "message" && c.from === "product-owner").map((c) => c.kind === "message" && c.text)).toEqual([
        "Hello, I've read the repo.",
        "Here is a first brief.",
      ]);
      expect(after.state).toBe("needs-you");
      expect(after.turnRunning).toBe(false);
      expect(events.map((e) => e.type)).toContain("chat.delta");
      expect(events.filter((e) => e.type === "chat.activity").at(-1)).toMatchObject({ text: null });
    });

    it("saves the brief from write_brief and renames the card", async () => {
      const { card, turn } = await inRefine();
      const reply = await turn.request.hiveTools!.writeBrief!({
        title: "Printer font size", problem: "Text is too small.", whoItsFor: "Users with poor sight",
        whatDoneLooksLike: ["Each printer has a size"], outOfScope: [], openPoints: ["Max size?"],
      });
      expect(reply).toMatch(/saved/);
      const after = hive.card(card.id);
      expect(after.title).toBe("Printer font size");
      expect(after.brief?.openPoints).toEqual(["Max size?"]);
      expect(events.some((e) => e.type === "brief.updated")).toBe(true);
    });

    it("sends a message during a turn into that turn, and otherwise starts a new one", async () => {
      const { card, turn } = await inRefine();
      hive.sendMessage(card.id, "Per printer, please");
      expect(turn.pushed).toEqual(["Per printer, please"]);
      turn.handlers.onSessionCreated();
      await turn.end();
      hive.sendMessage(card.id, "And max 24");
      expect(runner.turns).toHaveLength(2);
      expect(runner.last.request).toMatchObject({ resume: true, message: "And max 24" });
    });

    it("shows a failed turn with Retry, which resends its message", async () => {
      const { card, turn } = await inRefine();
      await turn.end({ kind: "error", message: "Not logged in" });
      const last = hive.card(card.id).chat.at(-1);
      expect(last).toMatchObject({ kind: "error", message: "Not logged in", actions: ["retry"] });
      hive.retry(card.id);
      expect(runner.last.request.message).toBe(turn.request.message);
      expect(runner.last.request.resume).toBe(false); // the failed first turn never created the session
    });

    it("sends a message that misses a turn already ending as a turn of its own", async () => {
      const { card, turn } = await inRefine();
      turn.inputEnded = true; // the result is in and the process is exiting
      hive.sendMessage(card.id, "One more thing");
      expect(turn.pushed).toEqual([]);
      expect(runner.turns).toHaveLength(1);
      await turn.end();
      expect(runner.turns).toHaveLength(2);
      expect(runner.last.request.message).toBe("One more thing");
      expect(hive.card(card.id).turnRunning).toBe(true);
    });

    it("refuses a second move while the first is still making the worktree", async () => {
      const { card } = await projectWithCard();
      const first = hive.moveCard(card.id, "refine");
      await expect(hive.moveCard(card.id, "refine")).rejects.toMatchObject({ status: 409 });
      await first;
      expect(hive.card(card.id)).toMatchObject({ lane: "refine", moveError: null });
      expect(runner.turns).toHaveLength(1);
    });

    it("stops a running turn without an error line", async () => {
      const { card, turn } = await inRefine();
      await hive.stop(card.id);
      await settle();
      expect(turn.interrupted).toBe(true);
      expect(hive.card(card.id).chat.some((c) => c.kind === "error")).toBe(false);
    });
  });

  describe("questions", () => {
    const questions = [
      { question: "Per printer or all?", header: "Scope", multiSelect: false,
        options: [{ label: "Per printer", description: "" }, { label: "All", description: "" }] },
    ];

    it("waits on your answer and hands it back as the tool's answers", async () => {
      const { card, turn } = await inRefine();
      const decision = turn.handlers.canUseTool("AskUserQuestion", { questions }, new AbortController().signal);
      await settle();
      const pending = hive.card(card.id).pending!;
      expect(pending.kind).toBe("question");
      expect(hive.card(card.id).state).toBe("needs-you");
      hive.answer(pending.id, { answers: { "Per printer or all?": "Per printer" } });
      await expect(decision).resolves.toMatchObject({
        behavior: "allow", updatedInput: { questions, answers: { "Per printer or all?": "Per printer" } },
      });
      expect(hive.card(card.id).pending).toBeNull();
      expect(hive.card(card.id).chat.at(-1)).toMatchObject({ kind: "message", from: "you", text: "Per printer" });
    });

    it("sends an answer whose question was withdrawn into the turn still running, not a second turn", async () => {
      const { card, turn } = await inRefine();
      const asked = new AbortController();
      const decision = turn.handlers.canUseTool("AskUserQuestion", { questions }, asked.signal);
      await settle();
      const pendingId = hive.card(card.id).pending!.id;
      asked.abort(); // Stop aborts the canUseTool call before the turn has ended
      await expect(decision).resolves.toMatchObject({ behavior: "deny" });
      hive.answer(pendingId, { answers: { "Per printer or all?": "All" } });
      expect(runner.turns).toHaveLength(1);
      expect(turn.pushed[0]).toContain("My answer: All");
    });

    it("refuses answers that aren't text per question", async () => {
      const { card, turn } = await inRefine();
      void turn.handlers.canUseTool("AskUserQuestion", { questions }, new AbortController().signal);
      await settle();
      const pendingId = hive.card(card.id).pending!.id;
      expect(() => hive.answer(pendingId, { answers: "All" } as any)).toThrow(HttpError);
    });

    it("treats a message typed while a question waits as its answer", async () => {
      const { card, turn } = await inRefine();
      const decision = turn.handlers.canUseTool("AskUserQuestion", { questions }, new AbortController().signal);
      await settle();
      hive.sendMessage(card.id, "Only the label printer");
      await expect(decision).resolves.toMatchObject({
        updatedInput: { answers: { "Per printer or all?": "Only the label printer" } },
      });
      expect(turn.pushed).toEqual([]);
    });

    it("allows the hive's own tools without asking", async () => {
      const { turn } = await inRefine();
      await expect(
        turn.handlers.canUseTool("mcp__hive__write_brief", {}, new AbortController().signal),
      ).resolves.toMatchObject({ behavior: "allow" });
    });
  });

  describe("after a restart", () => {
    it("marks a cut-off turn and waits for you instead of resuming", async () => {
      const { card } = await inRefine();
      const restarted = newHive(); // the old hive's in-memory turn is gone
      restarted.recoverAfterRestart();
      const after = restarted.card(card.id);
      expect(after.turnRunning).toBe(false);
      expect(after.state).toBe("needs-you");
      expect(after.chat.at(-1)).toMatchObject({ kind: "error", actions: [] });
      expect(runner.turns).toHaveLength(1);
    });

    it("sends an answer whose turn is gone as a new turn with the question", async () => {
      const { card, turn } = await inRefine();
      void turn.handlers.canUseTool("AskUserQuestion", {
        questions: [{ question: "Max size?", header: "Max", multiSelect: false,
          options: [{ label: "24", description: "" }, { label: "32", description: "" }] }],
      }, new AbortController().signal);
      await settle();
      const pendingId = hive.card(card.id).pending!.id;
      const restarted = newHive();
      restarted.recoverAfterRestart();
      restarted.answer(pendingId, { answers: { "Max size?": "24" } });
      expect(runner.last.request.message).toContain("Max size?");
      expect(runner.last.request.message).toContain("My answer: 24");
    });

    it("formats an answer with the options it was asked with", () => {
      const text = answerAsMessage(
        [{ question: "Q?", header: "", multiSelect: false, options: [{ label: "A", description: "" }] }],
        { "Q?": "A" },
      );
      expect(text).toContain("Q?\n- A\nMy answer: A");
    });
  });
});
