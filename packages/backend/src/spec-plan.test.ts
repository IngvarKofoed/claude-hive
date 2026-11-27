// The Spec and Plan lanes (docs/specs/2026-11-26-spec-lane-review-gate.md), driven through a fake runner.
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HiveEvent } from "@hive/shared";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { Hive } from "./hive";
import { PLAN_SCHEMA, REVIEW_SCHEMA } from "./spec/reports";
import { FakeProbe, FakeRunner, makeRepo, makeSpecFormat, settle, waitFor, type TempRepo } from "./testing";

const role = (name: string) => ({ name, model: "opus", kind: name === "spec-reviewer" ? "one-off" : "conversation", instructions: `Be the ${name}.` });

const brief = {
  title: "Printer font size", problem: "Labels are too small.", whoItsFor: "People with low vision",
  whatDoneLooksLike: ["Each printer has a size"], outOfScope: ["Fonts"], openPoints: [],
};

const plan = {
  status: "done", blockedReason: null,
  steps: [{ title: "Add the setting", detail: "…", chunk: "core", check: "unit test" }],
  chunks: [{ name: "core", owns: ["src/fonts.ts"], model: "opus" }],
  tests: ["clamps to 8–48"],
};

describe("Spec and Plan lanes", () => {
  let db: HiveDb;
  let hub: EventHub;
  let runner: FakeRunner;
  let hive: Hive;
  let events: HiveEvent[];
  let repo: TempRepo;
  let format: ReturnType<typeof makeSpecFormat>;

  const newHive = () =>
    new Hive({ db, hub, git, runner, probe: new FakeProbe(), role, log: () => {}, specFormatDir: format.dir, today: () => "2026-11-26" });

  beforeEach(() => {
    db = new HiveDb(":memory:");
    hub = new EventHub();
    runner = new FakeRunner();
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

  /** A card in Refine whose product owner has written a brief and finished its turn. */
  async function refined() {
    await hive.addProject(repo.root);
    const project = hive.board().projects[0]!;
    const card = hive.createCard(project.id, "Make the printer font adjustable. Some find it too small.");
    await hive.moveCard(card.id, "refine");
    const po = runner.last;
    await po.request.hiveTools!.writeBrief(brief);
    po.handlers.onTextBlock("Here is a first brief.");
    po.handlers.onSessionCreated();
    await po.end();
    return card.id;
  }

  /** A card in Spec whose writer has written the spec file and finished its turn. */
  async function specWritten(text = "# Printer font size\n\nThe spec.\n") {
    const id = await refined();
    await hive.good(id);
    const writer = runner.last;
    const card = hive.card(id);
    writeFileSync(join(card.worktreePath!, card.spec!.path), text);
    writer.handlers.onSessionCreated();
    await writer.end();
    return { id, writer, path: join(card.worktreePath!, card.spec!.path) };
  }

  const reviewer = () => runner.last;
  const report = (findings: unknown[]) => ({ kind: "ok" as const, report: { status: "done", blockedReason: null, summary: "", findings } });
  const fix = { kind: "fix", category: "Completeness", where: "Design", stakes: "A gap.", options: ["Add it"] };
  const decision = { kind: "decision", category: "UX", where: "Outcome", stakes: "Unclear.", options: ["A", "B"] };

  describe("Good", () => {
    it("moves the card to Spec and starts the spec writer with the brief, the chat and the format", async () => {
      const id = await refined();
      await hive.good(id);
      const card = hive.card(id);
      expect(card.lane).toBe("spec");
      expect(card.spec).toMatchObject({ path: "docs/specs/2026-11-26-printer-font-size.md", text: null, review: "none" });
      expect(existsSync(join(card.worktreePath!, "docs", "specs"))).toBe(true);
      const writer = runner.last;
      expect(writer.request.role.name).toBe("spec-writer");
      expect(writer.request.extraInstructions).toContain("What a spec contains");
      expect(writer.request.message).toContain("Problem: Labels are too small.");
      expect(writer.request.message).toContain("product owner: Here is a first brief.");
      expect(writer.request.message).toContain("docs/specs/2026-11-26-printer-font-size.md");
      expect(card.chat).toEqual([]); // Refine's chat stays in Refine
    });

    it("is refused while the product owner works, or without the spec format", async () => {
      await hive.addProject(repo.root);
      const card = hive.createCard(hive.board().projects[0]!.id, "An idea.");
      await hive.moveCard(card.id, "refine");
      await expect(hive.good(card.id)).rejects.toMatchObject({ status: 409 });
      await runner.last.end();
      format.cleanup();
      await expect(hive.good(card.id)).rejects.toThrow(/spec format is missing/);
    });
  });

  describe("the review gate", () => {
    it("records the spec as reviewed when the review finds nothing, and Sign off commits it and starts the planner", async () => {
      const { id } = await specWritten();
      hive.review(id);
      const rev = reviewer();
      expect(rev.request).toMatchObject({ persist: false, outputFormat: REVIEW_SCHEMA });
      expect(rev.request.message).toContain("For the reviewer");
      expect(hive.card(id).spec!.review).toBe("running");
      expect(() => hive.sendMessage(id, "more")).toThrow(/Wait for the review/);
      await rev.end(report([]));
      expect(hive.card(id).spec!.review).toBe("fresh");

      await hive.signoff(id);
      const card = hive.card(id);
      expect(card.lane).toBe("plan");
      expect(repo.git("log", "--format=%s", card.branch!, "-1")).toBe("Spec: Printer font size");
      expect(repo.git("status", "--porcelain")).toBe("");
      expect(runner.last.request).toMatchObject({ outputFormat: PLAN_SCHEMA });
      expect(runner.last.request.role.name).toBe("planner");
    });

    it("sends findings to the writer, and a finished review turn makes the spec reviewed", async () => {
      const { id, path } = await specWritten();
      hive.review(id);
      await reviewer().end(report([fix, decision]));
      const writer = runner.last;
      expect(writer.request.role.name).toBe("spec-writer");
      expect(writer.request.message).toContain("[fix] Completeness, at Design");
      expect(writer.request.message).toContain("[decision] UX, at Outcome");
      expect(hive.card(id).spec!.review).toBe("applying");
      expect(hive.card(id).chat.some((c) => c.kind === "message" && c.from === "hive" && /1 fix and 1 decision/.test(c.text))).toBe(true);
      expect(() => hive.sendMessage(id, "also add X")).toThrow(/applying the review/);
      // The page must still see a turn running: no turn.ended after the writer's turn.started.
      const started = events.map((e) => e.type).lastIndexOf("turn.started");
      expect(events.slice(started).some((e) => e.type === "turn.ended")).toBe(false);
      expect(hive.card(id).turnRunning).toBe(true);

      writeFileSync(path, "# Printer font size\n\nThe spec, with the fix.\n");
      await writer.end();
      expect(hive.card(id).spec!.review).toBe("fresh");
      await expect(hive.signoff(id)).resolves.toMatchObject({ lane: "plan" });
    });

    it("lets you answer the writer's question during the review turn", async () => {
      const { id } = await specWritten();
      hive.review(id);
      await reviewer().end(report([decision]));
      const writer = runner.last;
      const decided = writer.handlers.canUseTool("AskUserQuestion", {
        questions: [{ question: "A or B?", header: "UX", multiSelect: false, options: [{ label: "A", description: "" }] }],
      }, new AbortController().signal);
      await settle();
      hive.sendMessage(id, "A, please");
      await expect(decided).resolves.toMatchObject({ updatedInput: { answers: { "A or B?": "A, please" } } });
    });

    it("leaves a stopped review turn unfinished, with Retry re-sending the findings", async () => {
      const { id } = await specWritten();
      hive.review(id);
      await reviewer().end(report([fix]));
      const turn = runner.last;
      await hive.stop(id);
      await settle();
      expect(turn.interrupted).toBe(true);
      expect(hive.card(id).spec!.review).toBe("unfinished");
      expect(hive.card(id).chat.at(-1)).toMatchObject({ kind: "error", actions: ["retry"] });
      await expect(hive.signoff(id)).rejects.toMatchObject({ status: 409 });

      hive.retry(id);
      expect(runner.last.request.message).toBe(turn.request.message);
      await runner.last.end();
      expect(hive.card(id).spec!.review).toBe("fresh");
    });

    it("sets an unfinished review aside when you send a message instead", async () => {
      const { id } = await specWritten();
      hive.review(id);
      await reviewer().end(report([fix]));
      await runner.last.end({ kind: "error", message: "boom" });
      expect(hive.card(id).spec!.review).toBe("unfinished");
      hive.sendMessage(id, "Never mind, change the title instead.");
      expect(hive.card(id).spec!.review).toBe("none");
      expect(runner.last.request.message).toBe("Never mind, change the title instead.");
    });

    it("drops findings when the spec changed during the review", async () => {
      const { id, path } = await specWritten();
      hive.review(id);
      writeFileSync(path, "# Edited by hand\n");
      await reviewer().end(report([fix]));
      const card = hive.card(id);
      expect(card.spec!.review).toBe("none");
      expect(card.chat.at(-1)).toMatchObject({ kind: "message", from: "hive" });
      expect((card.chat.at(-1) as { text: string }).text).toMatch(/changed during the review/);
    });

    it("offers Review again when the reviewer is blocked or returns no report", async () => {
      const { id } = await specWritten();
      hive.review(id);
      await reviewer().end({ kind: "ok", report: { status: "blocked", blockedReason: "The file is empty.", summary: "", findings: [] } });
      expect(hive.card(id).chat.at(-1)).toMatchObject({ kind: "error", actions: ["review"] });
      hive.review(id);
      await reviewer().end({ kind: "ok" });
      expect(hive.card(id).chat.at(-1)).toMatchObject({ kind: "error", message: "The review didn't return a report." });
    });

    it("refuses a message or a review while Sign off is committing the spec", async () => {
      const { id } = await specWritten();
      hive.review(id);
      await reviewer().end(report([]));
      const signing = hive.signoff(id);
      expect(() => hive.sendMessage(id, "one more thing")).toThrow(/moving/);
      expect(() => hive.review(id)).toThrow(/moving/);
      await expect(signing).resolves.toMatchObject({ lane: "plan" });
    });

    it("greys Sign off when the reviewed spec is edited, and refuses it", async () => {
      const { id, path } = await specWritten();
      hive.review(id);
      await reviewer().end(report([]));
      writeFileSync(path, "# A hand edit\n");
      await expect(hive.signoff(id)).rejects.toThrow(/changed since the review/);
      expect(hive.card(id).spec!.review).toBe("stale");
    });
  });

  describe("the planner", () => {
    async function inPlan() {
      const s = await specWritten();
      hive.review(s.id);
      await reviewer().end(report([]));
      await hive.signoff(s.id);
      return { ...s, planner: runner.last };
    }

    it("stores a done plan and moves the card to Build", async () => {
      const { id, planner } = await inPlan();
      planner.handlers.onTextBlock("Reading the spec.");
      expect(hive.card(id).chat.map((c) => c.kind === "message" && c.from)).toEqual(["planner"]);
      await planner.end({ kind: "ok", report: plan });
      const card = hive.card(id);
      expect(card.lane).toBe("build");
      expect(card.plan?.steps[0]?.title).toBe("Add the setting");
      expect(events.some((e) => e.type === "plan.updated")).toBe(true);
      // Build starts by itself: the developer's first turn (docs/specs/2026-11-26-build-lane-developer.md).
      await waitFor(() => runner.last.request.role.name === "developer");
    });

    it("keeps a blocked plan in Plan with Retry and Back to Spec, which needs a new review and sign-off", async () => {
      const { id, planner, path } = await inPlan();
      await planner.end({ kind: "ok", report: { ...plan, status: "blocked", blockedReason: "The spec contradicts the code." } });
      expect(hive.card(id).lane).toBe("plan");
      expect(hive.card(id).chat.at(-1)).toMatchObject({ kind: "error", actions: ["retry", "back-to-spec"] });

      await hive.backToSpec(id);
      expect(hive.card(id).lane).toBe("spec");
      expect(hive.card(id).spec!.review).not.toBe("fresh");
      const writer = runner.last;
      expect(writer.request.message).toContain("The spec contradicts the code.");
      writeFileSync(path, "# Printer font size\n\nRevised.\n");
      await writer.end();

      hive.review(id);
      await reviewer().end(report([]));
      await hive.signoff(id);
      expect(runner.last.request.message).toMatch(/revised and signed off again/);
      expect(runner.last.request.sessionId).toBe(planner.request.sessionId);
    });

    it("lets a missing plan be retried", async () => {
      const { id, planner } = await inPlan();
      await planner.end({ kind: "ok" });
      expect(hive.card(id).chat.at(-1)).toMatchObject({ kind: "error", message: "The planner didn't return a plan." });
      hive.retry(id);
      expect(runner.last.request.sessionId).toBe(planner.request.sessionId);
    });
  });

  describe("after a restart", () => {
    it("offers Review again for a review cut off by a restart", async () => {
      const { id } = await specWritten();
      hive.review(id);
      const restarted = newHive();
      restarted.recoverAfterRestart();
      expect(restarted.card(id).chat.at(-1)).toMatchObject({ kind: "error", actions: ["review"] });
      restarted.close();
    });

    it("resumes a cut-off planner turn", async () => {
      const s = await specWritten();
      hive.review(s.id);
      await reviewer().end(report([]));
      await hive.signoff(s.id);
      const before = runner.turns.length;
      const restarted = newHive();
      restarted.recoverAfterRestart();
      expect(runner.turns.length).toBe(before + 1);
      expect(runner.last.request.message).toMatch(/cut off when the hive stopped/);
      restarted.close();
    });

    it("starts even when the planner can't restart, and offers Retry", async () => {
      const s = await specWritten();
      hive.review(s.id);
      await reviewer().end(report([]));
      await hive.signoff(s.id);
      rmSync(join(format.dir, "format.md"));
      const restarted = newHive();
      expect(() => restarted.recoverAfterRestart()).not.toThrow();
      expect(restarted.card(s.id)).toMatchObject({ state: "needs-you", turnRunning: false });
      expect(restarted.card(s.id).chat.at(-1)).toMatchObject({ kind: "error", actions: ["retry"] });
      restarted.close();
    });

    it("leaves a cut-off review turn unfinished, with Retry", async () => {
      const { id } = await specWritten();
      hive.review(id);
      await reviewer().end(report([fix]));
      const restarted = newHive();
      restarted.recoverAfterRestart();
      const card = restarted.card(id);
      expect(card.spec!.review).toBe("unfinished");
      expect(card.chat.at(-1)).toMatchObject({ kind: "error", actions: ["retry"] });
      restarted.close();
    });
  });
});

describe("the database", () => {
  it("adds the new card columns to a database from the first slice, and keeps old chat in Refine", () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-db-"));
    const path = join(dir, "hive.db");
    const old = new Database(path);
    old.exec(`CREATE TABLE cards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
      idea_text TEXT NOT NULL, lane TEXT NOT NULL, state TEXT NOT NULL, branch TEXT, worktree_path TEXT, brief TEXT,
      move_error TEXT, created_at TEXT NOT NULL);
      CREATE TABLE events (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, at TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
      INSERT INTO cards VALUES ('c1', 'p1', 'T', 'idea', 'refine', 'needs-you', NULL, NULL, NULL, NULL, '2026-01-01');
      INSERT INTO events VALUES ('e1', 'c1', '2026-01-01', 'chat', '{"from":"you","text":"hi"}');
      INSERT INTO events VALUES ('e2', 'c1', '2026-01-02', 'error', '{"message":"boom","retryable":true}');`);
    old.close();
    const db = new HiveDb(path);
    expect(db.getCard("c1")).toMatchObject({ specPath: null, reviewedSpecHash: null, reviewApplying: false, plan: null });
    expect(db.chatFor("c1", "refine")).toMatchObject([
      { kind: "message", text: "hi" },
      { kind: "error", actions: ["retry"] },
    ]);
    expect(db.chatFor("c1", "spec")).toEqual([]);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

