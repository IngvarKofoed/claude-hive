// For you (docs/specs/2026-11-27-for-you.md): which cards are listed, what each says, when it started waiting, and the
// order, driven through a fake runner on a throwaway repo, or with cards placed straight in a lane.
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardState, ChatItem, ErrorAction, Lane, LaneActionInput, PendingItem } from "@hive/shared";
import { forYouActions, waitsForYou, whatItWants } from "./board/forYou";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { Hive } from "./hive";
import { fakeApps } from "./preview/apps";
import { fakePorts } from "./preview/ports";
import type { Role } from "./sessions/types";
import { FakeProbe, FakeRunner, keeperReport, makeRepo, makeSpecFormat, settle, waitFor, type TempRepo } from "./testing";

const question: PendingItem = {
  id: "q1", kind: "question",
  questions: [{ question: "Per printer or all?", header: "Scope", multiSelect: false, options: [] }],
};
const error = (message: string): ChatItem => ({ kind: "error", id: "e1", at: "t", message, actions: ["retry"] });
const note: ChatItem = { kind: "message", id: "m1", at: "t", from: "hive", text: "Back to Try it." };

describe("which cards wait for you", () => {
  const card = (lane: Lane, state: CardState = "needs-you") => ({ lane, state });

  it("lists cards under way that need you, in every lane from Refine to Ship", () => {
    for (const lane of ["refine", "mockup", "spec", "plan", "build", "check", "tryit", "ship"] as Lane[]) {
      expect(waitsForYou(card(lane))).toBe(true);
    }
  });

  it("leaves out ideas, landed cards and anything working", () => {
    expect(waitsForYou(card("ideas"))).toBe(false);
    expect(waitsForYou(card("done"))).toBe(false);
    expect(waitsForYou(card("mockup", "working"))).toBe(false);
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
    expect(wants("mockup")).toEqual({ kind: "your-turn", text: "Reply to the designer, or say Good." });
    expect(wants("spec", { review: "none" }).kind).toBe("your-turn");
    expect(wants("spec", { review: "fresh" }).kind).toBe("sign-off");
    expect(wants("spec", { review: "stale" }).kind).toBe("review-again");
    expect(wants("tryit")).toEqual({ kind: "try-it", text: "Ready to test." });
    expect(wants("ship", { lastChat: note })).toEqual({ kind: "land", text: "Ready to land on main." });
    expect(wants("check").kind).toBe("waiting");
  });
});

describe("what an entry offers", () => {
  const input = (lane: Lane, extra: Partial<LaneActionInput> = {}): LaneActionInput => ({
    lane, turnRunning: false, pending: false, lastChat: null, spec: null, issues: [], landing: false, shipPlan: null,
    hasFeedback: false, ...extra,
  });
  const failed = (actions: ErrorAction[]): ChatItem => ({ kind: "error", id: "e", at: "t", message: "It failed.", actions });
  const ids = (kind: Parameters<typeof forYouActions>[0], lane: Lane, extra: Partial<LaneActionInput> = {}) =>
    forYouActions(kind, input(lane, extra)).map((a) => a.id);

  it("offers nothing for a question or a permission, whatever the lane", () => {
    expect(ids("question", "refine", { pending: true })).toEqual([]);
    expect(ids("permission", "spec", { pending: true, spec: { review: "fresh", hasText: true } })).toEqual([]);
    expect(ids("question", "build", { pending: true, lastChat: failed(["retry", "back-to-spec"]) })).toEqual([]);
  });

  it("offers nothing for a card in Try it, a failed keeper turn included", () => {
    expect(ids("try-it", "tryit")).toEqual([]);
    expect(ids("stuck", "tryit", { lastChat: failed(["retry"]) })).toEqual([]);
  });

  it("gives Ship Land on main, always enabled, and Back to Try it; Back to Build only from the error line", () => {
    expect(forYouActions("land", input("ship"))).toEqual([
      { id: "land", label: "Land on main", primary: true, enabled: true, reason: null },
      { id: "back-to-tryit", label: "Back to Try it", primary: false, enabled: true, reason: null },
    ]);
    expect(ids("stuck", "ship", { lastChat: failed(["retry", "back-to-build"]) })).toEqual(["land", "back-to-tryit", "back-to-build"]);
    expect(ids("stuck", "ship", { lastChat: failed(["retry"]) })).toEqual(["land", "back-to-tryit"]);
  });

  it("never gives Ship Retry, Discard them and land or Stop", () => {
    const dirty = { base: "origin/main" as const, uncommitted: ["?? a"], unpushed: 0, tests: null, noTestsReason: "none",
      checkoutBlocks: false, busy: false };
    expect(ids("stuck", "ship", { lastChat: failed(["retry"]), shipPlan: dirty, turnRunning: true })).toEqual([
      "land", "back-to-tryit",
    ]);
  });

  it("gives other lanes only their Goods, Review, Sign off and the error line's actions, never Stop", () => {
    expect(ids("your-turn", "refine")).toEqual(["good", "skip-mockup"]);
    expect(ids("your-turn", "refine", { turnRunning: true })).toEqual(["good", "skip-mockup"]);
    expect(ids("your-turn", "mockup")).toEqual(["keep", "dont-keep"]);
    expect(ids("stuck", "mockup", { lastChat: failed(["retry"]) })).toEqual(["keep", "dont-keep", "retry"]);
    expect(ids("your-turn", "spec", { spec: { review: "none", hasText: true } })).toEqual(["review", "signoff"]);
    expect(ids("stuck", "spec", { lastChat: failed(["retry"]) })).toEqual(["review", "signoff", "retry"]);
    expect(ids("stuck", "plan", { lastChat: failed(["retry", "back-to-spec"]) })).toEqual(["retry", "back-to-spec"]);
    expect(ids("stuck", "check", { lastChat: failed(["back-to-build", "move-on"]) })).toEqual(["back-to-build", "move-on"]);
    expect(ids("waiting", "check")).toEqual([]);
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
    await hive.good(id, { skipMockup: true });
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

  const actionsOf = (id: string) => hive.forYou().items.find((i) => i.card.id === id)?.actions;

  /** A Refine card with a brief, its product owner's turn over. */
  async function waitingInRefine() {
    const s = await inRefine();
    await s.po.request.hiveTools!.writeBrief!(brief);
    s.po.handlers.onSessionCreated();
    await s.po.end();
    return s;
  }

  /** A Spec card whose spec writer has written the spec, with no review yet. */
  async function writtenSpec() {
    const s = await waitingInRefine();
    await hive.good(s.id, { skipMockup: true });
    const writer = runner.last;
    writeFileSync(join(s.worktree, hive.card(s.id).spec!.path), "# Printer font size\n\nThe spec.\n");
    writer.handlers.onSessionCreated();
    await writer.end();
    return s;
  }

  it("offers both Goods on a Refine card waiting for your reply, and drops the card once Good moves it", async () => {
    const { id } = await waitingInRefine();
    expect(actionsOf(id)).toEqual([
      { id: "good", label: "Good · on to Mockup", primary: true, enabled: true, reason: null },
      { id: "skip-mockup", label: "Good · skip to Spec", primary: false, enabled: true, reason: null },
    ]);
    await hive.good(id, { skipMockup: true });
    expect(actionsOf(id)).toBeUndefined();
    expect(hive.card(id).lane).toBe("spec");
  });

  it("offers Keep and Don't keep on a Mockup card, greying Keep until the designer names a mockup", async () => {
    const { id } = await waitingInRefine();
    await hive.good(id);
    const designer = runner.last;
    designer.handlers.onSessionCreated();
    await designer.end();
    expect(actionsOf(id)).toEqual([
      { id: "keep", label: "Good · keep in docs/mockups", primary: true, enabled: false,
        reason: "Keep needs a mockup: the designer hasn't named one yet." },
      { id: "dont-keep", label: "Good · don't keep", primary: false, enabled: true, reason: null },
    ]);
    const folder = hive.card(id).mockup!.folder;
    writeFileSync(join(hive.card(id).worktreePath!, folder, "index.html"), "<p>x</p>");
    await designer.request.hiveTools!.setMockup!({ page: `${folder}/index.html` });
    expect(actionsOf(id)?.[0]).toMatchObject({ id: "keep", enabled: true, reason: null });
  });

  it("offers Review on a written spec with no review, greys Sign off, and drops the card while the review runs", async () => {
    const { id } = await writtenSpec();
    expect(actionsOf(id)).toEqual([
      { id: "review", label: "Review", primary: false, enabled: true, reason: null },
      { id: "signoff", label: "Sign off", primary: true, enabled: false, reason: "Run the review first" },
    ]);
    hive.review(id);
    expect(actionsOf(id)).toBeUndefined();
  });

  it("offers Retry and Back to Spec on a blocked build, and Back to Spec takes the developer's reason to the spec writer", async () => {
    const { id } = await writtenSpec();
    hive.review(id);
    await runner.last.end({ kind: "ok", report: { status: "done", blockedReason: null, summary: "", findings: [] } });
    await hive.signoff(id);
    await runner.last.end({
      kind: "ok",
      report: {
        status: "done", blockedReason: null, tests: [],
        steps: [{ title: "Add the setting", detail: "A size per printer.", chunk: "core", check: "unit test" }],
        chunks: [{ name: "core", owns: ["src/fonts.ts"], model: "opus" }],
      },
    });
    await waitFor(() => runner.last.request.role.name === "developer");
    const developer = runner.last;
    developer.handlers.onSessionCreated();
    await developer.end({
      kind: "ok",
      report: { status: "blocked", blockedReason: "No printers table.", summary: "", departures: [], issues: [], decisions: [] },
    });
    await waitFor(() => runner.last.request.role.name === "spec-writer");
    const keeper = runner.last;
    await keeper.end({ kind: "ok", report: keeperReport(keeper.request.message) });
    await waitFor(() => hive.card(id).state === "needs-you");

    expect(hive.card(id).lane).toBe("build");
    expect(actionsOf(id)).toEqual([
      { id: "retry", label: "Retry", primary: false, enabled: true, reason: null },
      { id: "back-to-spec", label: "Back to Spec", primary: false, enabled: true, reason: null },
    ]);
    await hive.backToSpec(id);
    expect(hive.card(id).lane).toBe("spec");
    expect(runner.last.request.role.name).toBe("spec-writer");
    expect(runner.last.request.message).toContain("No printers table.");
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

    it("offers Land on main and Back to Try it on a Ship card without reading git for the plan", () => {
      db.insertCard(cardRow("c", "p", "ship", "needs-you"));
      const shipPlan = vi.spyOn(hive, "shipPlan");
      const [item] = hive.forYou().items;
      expect(item!.actions).toEqual([
        { id: "land", label: "Land on main", primary: true, enabled: true, reason: null },
        { id: "back-to-tryit", label: "Back to Try it", primary: false, enabled: true, reason: null },
      ]);
      expect(shipPlan).not.toHaveBeenCalled();
    });

    it("offers no actions on a Try it card, nor on a question's entry", () => {
      db.insertCard(cardRow("t", "p", "tryit", "needs-you"));
      db.addEvent("t", "error", { message: "The spec keeper failed.", actions: ["retry"], lane: "tryit" }, randomUUID());
      expect(hive.forYou().items[0]).toMatchObject({ kind: "stuck", actions: [] });
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
