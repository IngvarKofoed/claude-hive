// For you (docs/specs/2026-11-27-for-you.md): which cards are listed, what each says, when it started waiting, and the
// order, driven through a fake runner on a throwaway repo, or with cards placed straight in a lane.
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardState, ChatItem, Lane, PendingItem } from "@hive/shared";
import { waitsForYou, whatItWants } from "./board/forYou";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { Hive } from "./hive";
import { fakeApps } from "./preview/apps";
import { fakePorts } from "./preview/ports";
import type { Role } from "./sessions/types";
import { FakeProbe, FakeRunner, makeRepo, makeSpecFormat, settle, waitFor, type TempRepo } from "./testing";

const question: PendingItem = {
  id: "q1", kind: "question",
  questions: [{ question: "Per printer or all?", header: "Scope", multiSelect: false, options: [] }],
};
const error = (message: string): ChatItem => ({ kind: "error", id: "e1", at: "t", message, actions: ["retry"] });
const note: ChatItem = { kind: "message", id: "m1", at: "t", from: "hive", text: "Back to Try it." };

describe("which cards wait for you", () => {
  const card = (lane: Lane, state: CardState = "needs-you") => ({ lane, state });

  it("lists cards under way that need you, in lanes that are built", () => {
    for (const lane of ["refine", "spec", "plan", "build", "check", "tryit", "ship"] as Lane[]) {
      expect(waitsForYou(card(lane))).toBe(true);
    }
  });

  it("leaves out ideas, landed cards, unbuilt lanes and anything working", () => {
    expect(waitsForYou(card("ideas"))).toBe(false);
    expect(waitsForYou(card("done"))).toBe(false);
    expect(waitsForYou(card("mockup"))).toBe(false);
    expect(waitsForYou(card("tryit", "working"))).toBe(false);
  });
});

describe("what a waiting card wants", () => {
  const wants = (lane: Lane, extra: { pending?: PendingItem; lastChat?: ChatItem; review?: "fresh" | "stale" | "none" } = {}) =>
    whatItWants({ lane, pending: extra.pending ?? null, lastChat: extra.lastChat, review: extra.review ?? null });

  it("puts a question first, then an error line, then the lane", () => {
    expect(wants("build", { pending: question, lastChat: error("Build couldn't start.") }))
      .toEqual({ kind: "question", text: "Per printer or all?" });
    expect(wants("build", { lastChat: error("Build couldn't start.") }))
      .toEqual({ kind: "stuck", text: "Build couldn't start." });
    expect(wants("refine", { lastChat: error("The last reply was cut off.") }).kind).toBe("stuck");
  });

  it("counts the other questions and names a permission's tool", () => {
    const two: PendingItem = { ...question, questions: [...(question as any).questions, (question as any).questions[0]] };
    expect(wants("plan", { pending: two }).text).toBe("Per printer or all? (and 1 more)");
    expect(wants("refine", { pending: { id: "p", kind: "permission", toolName: "Bash", detail: "{}" } }))
      .toEqual({ kind: "permission", text: "Allow Bash?" });
  });

  it("says each lane's default, and Spec's by its review", () => {
    expect(wants("refine")).toEqual({ kind: "your-turn", text: "Reply to the product owner, or say Good." });
    expect(wants("spec", { review: "none" }).kind).toBe("your-turn");
    expect(wants("spec", { review: "fresh" }).kind).toBe("sign-off");
    expect(wants("spec", { review: "stale" }).kind).toBe("review-again");
    expect(wants("tryit")).toEqual({ kind: "try-it", text: "Ready to test." });
    expect(wants("ship", { lastChat: note })).toEqual({ kind: "land", text: "Ready to land on main." });
    expect(wants("check").kind).toBe("waiting");
  });
});

/** A card row, straight in a lane, for the database and Hive tests that don't walk the lanes. */
function cardRow(id: string, projectId: string, lane: Lane, state: CardState) {
  return {
    id, projectId, title: `Card ${id}`, ideaTitle: "x", ideaText: "x", lane, state, branch: null, worktreePath: null, brief: null,
    moveError: null, specPath: null, reviewedSpecHash: null, reviewApplying: false, plan: null, build: null,
    check: null, setup: null, port: null, feedback: null, appStopped: false, landing: null, landed: null,
    shipAfterCheck: false,
  };
}

describe("when a card started waiting", () => {
  let db: HiveDb;
  const at = (iso: string) => vi.setSystemTime(new Date(iso));
  const since = (id: string) => db.getCard(id)!.waitingSince;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    db = new HiveDb(":memory:");
    db.insertProject({ id: "p", name: "flux", path: "/flux", trustWarning: false });
  });
  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  it("restarts when the card starts needing you or changes lane while it does, and only then", () => {
    at("2026-11-27T10:00:00Z");
    db.insertCard(cardRow("a", "p", "build", "working"));
    expect(since("a")).toBe("2026-11-27T10:00:00.000Z");

    at("2026-11-27T10:05:00Z");
    db.updateCard("a", { state: "needs-you" });
    expect(since("a")).toBe("2026-11-27T10:05:00.000Z");

    at("2026-11-27T10:06:00Z");
    db.updateCard("a", { state: "needs-you", moveError: null });
    db.updateCard("a", { title: "Renamed" });
    expect(since("a")).toBe("2026-11-27T10:05:00.000Z");

    at("2026-11-27T10:07:00Z");
    db.updateCard("a", { lane: "tryit" });
    expect(since("a")).toBe("2026-11-27T10:07:00.000Z");

    at("2026-11-27T10:08:00Z");
    db.updateCard("a", { state: "working" });
    expect(since("a")).toBe("2026-11-27T10:07:00.000Z");
    at("2026-11-27T10:09:00Z");
    db.updateCard("a", { lane: "ship", state: "needs-you" });
    expect(since("a")).toBe("2026-11-27T10:09:00.000Z");
  });

  it("is filled in from the newest history row for cards already there when the column arrives", () => {
    vi.useRealTimers();
    const dir = mkdtempSync(join(tmpdir(), "hive-for-you-"));
    const path = join(dir, "hive.db");
    try {
      const old = new HiveDb(path);
      old.insertProject({ id: "p", name: "flux", path: "/flux", trustWarning: false });
      old.insertCard(cardRow("talked", "p", "refine", "needs-you"));
      old.insertCard(cardRow("quiet", "p", "tryit", "needs-you"));
      old.addEvent("talked", "chat", { from: "product-owner", text: "Hi", lane: "refine" }, randomUUID(), "2026-11-20T09:00:00.000Z");
      old.addEvent("talked", "chat", { from: "product-owner", text: "Ok", lane: "refine" }, randomUUID(), "2026-11-21T09:00:00.000Z");
      old.close();
      // As the database was before this change.
      const raw = new Database(path);
      raw.exec("ALTER TABLE cards DROP COLUMN waiting_since");
      raw.prepare("UPDATE cards SET created_at = ? WHERE id = 'quiet'").run("2026-11-19T08:00:00.000Z");
      raw.close();

      const reopened = new HiveDb(path);
      expect(reopened.getCard("talked")!.waitingSince).toBe("2026-11-21T09:00:00.000Z");
      expect(reopened.getCard("quiet")!.waitingSince).toBe("2026-11-19T08:00:00.000Z");
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Hive.forYou", () => {
  let db: HiveDb;
  let runner: FakeRunner;
  let hive: Hive;
  let repo: TempRepo;
  let format: ReturnType<typeof makeSpecFormat>;

  const role = (name: string): Role => ({ name, model: "opus", kind: "work", instructions: `Be the ${name}.` });
  const brief = {
    title: "Printer font size", problem: "Labels are too small.", whoItsFor: "People with low vision",
    whatDoneLooksLike: ["Each printer has a size"], outOfScope: [], openPoints: [],
  };
  const listed = () => hive.forYou().items.map((i) => ({ id: i.card.id, kind: i.kind, text: i.text }));

  beforeEach(() => {
    db = new HiveDb(":memory:");
    runner = new FakeRunner();
    format = makeSpecFormat();
    repo = makeRepo();
    hive = new Hive({
      db, hub: new EventHub(), git, runner, probe: new FakeProbe(), role, log: () => {}, specFormatDir: format.dir,
      today: () => "2026-11-27", ports: fakePorts(), apps: fakeApps(),
    });
  });
  afterEach(() => {
    hive.close();
    repo.cleanup();
    format.cleanup();
    db.close();
    vi.useRealTimers();
  });

  async function inRefine() {
    await hive.addProject(repo.root);
    const project = hive.board().projects[0]!;
    const card = hive.createCard(project.id, "Font", "Make the printer font adjustable.");
    await hive.moveCard(card.id, "refine");
    await waitFor(() => hive.card(card.id).setup?.status === "done");
    return { id: card.id, po: runner.last, worktree: hive.card(card.id).worktreePath! };
  }

  it("lists a Refine card once the product owner's turn ends, never while it works, and never an idea", async () => {
    const { id, po } = await inRefine();
    hive.createCard(hive.board().projects[0]!.id, "Font", "Another idea.");
    expect(listed()).toEqual([]);

    po.handlers.onSessionCreated();
    await po.end();
    expect(listed()).toEqual([{ id, kind: "your-turn", text: "Reply to the product owner, or say Good." }]);
    expect(hive.forYou().items[0]).toMatchObject({ projectName: "repo", pending: null, card: { lane: "refine" } });
  });

  it("lists a question with its pending item, and drops it once answered", async () => {
    const { id, po } = await inRefine();
    const questions = [{ question: "Per printer or all?", header: "Scope", multiSelect: false,
      options: [{ label: "Per printer", description: "" }, { label: "All", description: "" }] }];
    const decision = po.handlers.canUseTool("AskUserQuestion", { questions }, new AbortController().signal);
    await settle();

    const [item] = hive.forYou().items;
    expect(item).toMatchObject({ kind: "question", text: "Per printer or all?", pending: { kind: "question", questions } });
    hive.answer(item!.pending!.id, { answers: { "Per printer or all?": "Per printer" } });
    await decision;
    expect(listed()).toEqual([]);
  });

  it("shows an error line in the lane as stuck, in the hive's own words", async () => {
    const { id, po } = await inRefine();
    await po.end({ kind: "error", message: "The product owner's turn failed." });
    expect(listed()).toEqual([{ id, kind: "stuck", text: "The product owner's turn failed." }]);
  });

  it("follows Spec's review: your turn, sign off, then review again once the file changes", async () => {
    const { id, po, worktree } = await inRefine();
    await po.request.hiveTools!.writeBrief!(brief);
    po.handlers.onSessionCreated();
    await po.end();
    await hive.good(id);
    const writer = runner.last;
    const specFile = join(worktree, hive.card(id).spec!.path);
    writeFileSync(specFile, "# Printer font size\n");
    writer.handlers.onSessionCreated();
    await writer.end();
    expect(listed()[0]!.kind).toBe("your-turn");

    hive.review(id);
    expect(listed()).toEqual([]); // the blind reviewer is reading
    await runner.last.end({ kind: "ok", report: { status: "done", blockedReason: null, summary: "", findings: [] } });
    expect(listed()[0]).toMatchObject({ kind: "sign-off" });

    writeFileSync(specFile, "# Printer font size\n\nChanged by hand.\n");
    expect(listed()[0]).toMatchObject({ kind: "review-again" });
  });

  describe("cards placed in a lane", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      db.insertProject({ id: "p", name: "flux", path: "/flux", trustWarning: false });
    });

    it("puts the card waiting longest first, whatever order the cards were made in", () => {
      vi.setSystemTime(new Date("2026-11-27T09:00:00Z"));
      db.insertCard(cardRow("older", "p", "build", "working"));
      vi.setSystemTime(new Date("2026-11-27T09:30:00Z"));
      db.insertCard(cardRow("newer", "p", "tryit", "needs-you"));
      vi.setSystemTime(new Date("2026-11-27T10:00:00Z"));
      db.updateCard("older", { lane: "tryit", state: "needs-you" });
      db.insertCard(cardRow("landed", "p", "done", "needs-you"));

      expect(hive.forYou().items.map((i) => [i.card.id, i.since, i.projectName])).toEqual([
        ["newer", "2026-11-27T09:30:00.000Z", "flux"],
        ["older", "2026-11-27T10:00:00.000Z", "flux"],
      ]);
    });

    it("doesn't count a failed landing's error once the card has been back to Try it and accepted again", async () => {
      db.insertCard(cardRow("c", "p", "ship", "needs-you"));
      db.addEvent("c", "error", { message: "The push was refused.", actions: ["retry"], lane: "ship" }, randomUUID());
      expect(listed()).toEqual([{ id: "c", kind: "stuck", text: "The push was refused." }]);

      await hive.backToTryIt("c");
      expect(listed()).toEqual([{ id: "c", kind: "try-it", text: "Ready to test." }]);
      await hive.accept("c");
      expect(listed()).toEqual([{ id: "c", kind: "land", text: "Ready to land on main." }]);
      expect(db.lastChatItem("c", "ship")).toMatchObject({ kind: "message", from: "hive", text: "Back to Try it." });
    });
  });
});
