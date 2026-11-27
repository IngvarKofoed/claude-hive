// Deleting a card (docs/specs/2026-11-27-delete-a-card.md), driven through a fake runner on a throwaway repo.
import { existsSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HiveEvent } from "@hive/shared";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { Hive, type GitService } from "./hive";
import { fakeApps } from "./preview/apps";
import { fakePorts } from "./preview/ports";
import type { Role } from "./sessions/types";
import { FakeProbe, FakeRunner, makeRepo, makeSpecFormat, waitFor, type TempRepo } from "./testing";

describe("deleting a card", () => {
  let db: HiveDb;
  let runner: FakeRunner;
  let hive: Hive;
  let repo: TempRepo;
  let format: ReturnType<typeof makeSpecFormat>;
  let apps: ReturnType<typeof fakeApps>;
  let ports: ReturnType<typeof fakePorts>;
  let events: HiveEvent[];
  let logged: string[];

  const role = (name: string): Role => ({ name, model: "opus", kind: "work", instructions: `Be the ${name}.` });
  const newHive = (gitService: GitService = git) => {
    const hub = new EventHub();
    hub.subscribe((e) => events.push(e));
    return new Hive({
      db, hub, git: gitService, runner, probe: new FakeProbe(), role, log: (m) => logged.push(m),
      specFormatDir: format.dir, today: () => "2026-11-27", ports, apps,
    });
  };

  beforeEach(() => {
    db = new HiveDb(":memory:");
    runner = new FakeRunner();
    format = makeSpecFormat();
    repo = makeRepo();
    apps = fakeApps();
    ports = fakePorts();
    events = [];
    logged = [];
    hive = newHive();
  });
  afterEach(() => {
    hive.close();
    repo.cleanup();
    format.cleanup();
    db.close();
  });

  const count = (table: string, id: string) =>
    (db.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === "cards" ? "id" : "card_id"} = ?`).get(id) as { n: number }).n;

  /** A card in Refine, its product owner's turn running. */
  async function inRefine() {
    await hive.addProject(repo.root);
    const project = hive.board().projects[0]!;
    const card = hive.createCard(project.id, "Make the printer font adjustable.");
    await hive.moveCard(card.id, "refine");
    await waitFor(() => hive.card(card.id).setup?.status === "done");
    const detail = hive.card(card.id);
    return { id: card.id, po: runner.last, worktree: detail.worktreePath!, branch: detail.branch! };
  }

  it("stops a running turn, removes the worktree and branch, and deletes every row", async () => {
    const { id, po, worktree, branch } = await inRefine();
    po.handlers.onTextBlock("Reading the repo.");
    expect(count("events", id)).toBeGreaterThan(0);

    expect(await hive.deleteCard(id)).toEqual({ left: [] });
    expect(po.interrupted).toBe(true);
    expect(existsSync(worktree)).toBe(false);
    expect(repo.git("branch", "--list", branch)).toBe("");
    for (const table of ["cards", "sessions", "events", "pending_items", "issues", "decisions"]) expect(count(table, id)).toBe(0);
    expect(events.at(-1)).toEqual({ type: "card.deleted", cardId: id });
    expect(hive.board().cards).toEqual([]);
    expect(() => hive.card(id)).toThrow();
    expect(repo.git("status", "--porcelain")).toBe("");

    // The interrupted turn's late end stands down: nothing is written, nothing fails, and the mark lifts.
    await po.done;
    await waitFor(() => !hive.isDeleting(id));
    expect(logged).toEqual([]);
    expect(count("events", id)).toBe(0);
  });

  it("counts as gone at once to requests, until its last interrupted turn has ended", async () => {
    const { id } = await inRefine();
    const pending = hive.deleteCard(id);
    expect(hive.isDeleting(id)).toBe(true);
    await pending;
  });

  it("stops the app the hive runs for it and sweeps its ports", async () => {
    const { id, worktree } = await inRefine();
    await runner.last.end();
    db.updateCard(id, { lane: "tryit" });
    await hive.appStart(id);
    expect(apps.status(id)).toHaveLength(0); // the empty setup has no start command; still, the app is cleared
    await hive.deleteCard(id);
    expect(apps.stopped).toContain(id);
    expect(ports.stopped.some((s) => s.worktree === worktree)).toBe(true);
  });

  it("deletes an idea with no git involved", async () => {
    await hive.addProject(repo.root);
    const project = hive.board().projects[0]!;
    const card = hive.createCard(project.id, "Just an idea.");
    const branches = repo.git("branch", "--list");
    expect(await hive.deleteCard(card.id)).toEqual({ left: [] });
    expect(count("cards", card.id)).toBe(0);
    expect(repo.git("branch", "--list")).toBe(branches);
  });

  it("refuses while the card is landing on main, or moving", async () => {
    const { id } = await inRefine();
    const projectId = hive.card(id).projectId;
    (hive as unknown as { landingProjects: Map<string, string> }).landingProjects.set(projectId, id);
    await expect(hive.deleteCard(id)).rejects.toMatchObject({ status: 409, message: "Wait for the landing to finish." });
    (hive as unknown as { landingProjects: Map<string, string> }).landingProjects.delete(projectId);
    (hive as unknown as { moving: Set<string> }).moving.add(id);
    await expect(hive.deleteCard(id)).rejects.toMatchObject({ status: 409, message: "This card is moving. Try again in a moment." });
    expect(count("cards", id)).toBe(1);
  });

  it("deletes the card anyway when a git step fails, and says what was left behind", async () => {
    const { id, worktree, branch } = await inRefine();
    hive.close();
    hive = newHive({ ...git, removeWorktree: async () => { throw new Error("the worktree is locked"); } });
    const { left } = await hive.deleteCard(id);
    expect(left[0]).toBe(`The worktree ${worktree}: the worktree is locked.`);
    expect(left[1]).toMatch(new RegExp(`^The branch ${branch}: `));
    expect(count("cards", id)).toBe(0);
  });

  it("prunes a worktree whose folder is already gone, then deletes the branch", async () => {
    const { id, worktree, branch } = await inRefine();
    rmSync(worktree, { recursive: true, force: true });
    expect(await hive.deleteCard(id)).toEqual({ left: [] });
    expect(repo.git("branch", "--list", branch)).toBe("");
    expect(repo.git("worktree", "list")).not.toContain(worktree);
  });
});
