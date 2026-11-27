// The Ship lane (docs/specs/2026-11-27-ship-lane.md), driven through a fake runner on a throwaway repo with a bare repo as
// its origin.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { Hive } from "./hive";
import { fakeApps } from "./preview/apps";
import { fakePorts } from "./preview/ports";
import type { Role } from "./sessions/types";
import { COMMIT_SCHEMA } from "./spec/reports";
import { FakeProbe, FakeRunner, type FakeTurn, makeRepo, makeSpecFormat, waitFor, type TempRepo } from "./testing";

const brief = {
  title: "Printer font size", problem: "Labels are too small.", whoItsFor: "People with low vision",
  whatDoneLooksLike: ["Each printer has a size"], outOfScope: [], openPoints: [],
};
const plan = {
  status: "done", blockedReason: null,
  steps: [{ title: "Add the setting", detail: "A size per printer.", chunk: "core", check: "unit test" }],
  chunks: [{ name: "core", owns: ["fonts.txt"], model: "opus" }],
  tests: ["clamps"],
};
const built = { status: "done", blockedReason: null, summary: "Added fonts.", departures: [], issues: [], decisions: [] };
const clean = { status: "done", blockedReason: null, summary: "Looks right.", bugs: [], issues: [] };
const message = { status: "done", blockedReason: null, subject: "Printers get their own font size", body: "Each printer keeps a size of its own." };

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

describe("Ship lane", () => {
  let db: HiveDb;
  let runner: FakeRunner;
  let hive: Hive;
  let repo: TempRepo;
  let format: ReturnType<typeof makeSpecFormat>;
  let bare: string;
  let other: string;

  const role = (name: string): Role =>
    ({ name, model: "opus", kind: ["spec-reviewer", "committer"].includes(name) ? "one-off" : "work", instructions: `Be the ${name}.` });
  const newHive = () =>
    new Hive({
      db, hub: new EventHub(), git, runner, probe: new FakeProbe(), role, log: () => {}, specFormatDir: format.dir,
      today: () => "2026-11-27", ports: fakePorts(), apps: fakeApps(),
    });

  beforeEach(() => {
    db = new HiveDb(":memory:");
    runner = new FakeRunner();
    format = makeSpecFormat();
    repo = makeRepo();
    const base = mkdtempSync(join(tmpdir(), "hive-origin-"));
    bare = join(base, "origin.git");
    other = join(base, "other");
    sh(base, "init", "-q", "--bare", "-b", "main", bare);
    repo.git("remote", "add", "origin", bare);
    repo.git("push", "-q", "origin", "main");
    hive = newHive();
  });
  afterEach(() => {
    hive.close();
    repo.cleanup();
    format.cleanup();
    rmSync(join(bare, ".."), { recursive: true, force: true });
    db.close();
  });

  const turnsOf = (roleName: string) => runner.turns.filter((t) => t.request.role.name === roleName);
  const lastOf = (roleName: string) => turnsOf(roleName).at(-1)!;
  const shipChat = (id: string) =>
    db.chatFor(id, "ship").map((c) => (c.kind === "message" ? c.text : `ERROR ${c.message} [${c.actions.join(",")}]`));

  /** Someone else pushes to origin/main. */
  function pushFromElsewhere(file: string, content: string) {
    if (!existsSync(other)) sh(join(bare, ".."), "clone", "-q", bare, other);
    sh(other, "pull", "-q", "origin", "main");
    writeFileSync(join(other, file), content);
    sh(other, "add", "-A");
    sh(other, "commit", "-q", "-m", `elsewhere: ${file}`);
    sh(other, "push", "-q", "origin", "main");
  }

  /** A card built (fonts.txt), checked and accepted: in Ship. */
  async function inShip(opts: { test?: string } = {}) {
    await hive.addProject(repo.root);
    const project = hive.board().projects[0]!;
    const card = hive.createCard(project.id, "Make the printer font adjustable.");
    await hive.moveCard(card.id, "refine");
    await waitFor(() => hive.card(card.id).setup?.status === "done");
    const po = runner.last;
    await po.request.hiveTools!.writeBrief!(brief);
    po.handlers.onSessionCreated();
    await po.end();
    await hive.good(card.id);
    const writer = runner.last;
    const worktree = hive.card(card.id).worktreePath!;
    writeFileSync(join(worktree, hive.card(card.id).spec!.path),
      "# Printer font size\n\n## Outcome\n\n**What you get:**\n\n- **Sizes:** each printer has its own.\n");
    writer.handlers.onSessionCreated();
    await writer.end();
    hive.review(card.id);
    await runner.last.end({ kind: "ok", report: { status: "done", blockedReason: null, summary: "", findings: [] } });
    await hive.signoff(card.id);
    await runner.last.end({ kind: "ok", report: plan });
    await waitFor(() => turnsOf("developer").length === 1);
    const developer = lastOf("developer");
    developer.handlers.onSessionCreated();
    writeFileSync(join(worktree, "fonts.txt"), "12 pt\n");
    await developer.end({ kind: "ok", report: built });
    await waitFor(() => turnsOf("reviewer").length === 1);
    await lastOf("reviewer").end({ kind: "ok", report: clean });
    await waitFor(() => hive.card(card.id).lane === "tryit");
    db.updateCard(card.id, { setup: { ...hive.card(card.id).setup!, test: opts.test ?? "echo tests ok" } });
    await hive.accept(card.id);
    return { id: card.id, worktree, branch: hive.card(card.id).branch!, developer };
  }

  /** Press Land on main and answer the committer. */
  async function land(id: string, body: { discard?: boolean } = {}, report: object = message) {
    const committers = turnsOf("committer").length;
    await hive.land(id, body);
    await waitFor(() => turnsOf("committer").length === committers + 1);
    const committer = lastOf("committer");
    await committer.end({ kind: "ok", report });
    return committer;
  }

  it("squashes, tests and pushes one commit, brings your checkout's main along, and cleans up", async () => {
    const { id, worktree, branch } = await inShip();
    const committer = await land(id);
    await waitFor(() => hive.card(id).lane === "done");

    expect(committer.request.outputFormat).toBe(COMMIT_SCHEMA);
    expect(committer.request.persist).toBe(false);
    expect(committer.request.message).toContain("fonts.txt");
    const pushed = sh(bare, "log", "-1", "--format=%B", "main");
    expect(pushed).toContain("Printers get their own font size\n\nEach printer keeps a size of its own.");
    expect(pushed).toContain(`Hive-Card: ${id}`);
    expect(pushed).toMatch(/Spec: docs\/specs\/.*\.md/);
    expect(sh(bare, "rev-list", "--count", "main")).toBe("2"); // one commit on top, no merges
    expect(sh(bare, "show", "main:fonts.txt")).toBe("12 pt");

    const card = hive.card(id);
    expect(card.landed).toMatchObject({ base: "origin/main", remote: true, checkout: "updated", subject: "Printers get their own font size" });
    expect(card.port).toBeNull();
    expect(existsSync(worktree)).toBe(false);
    expect(repo.git("branch", "--list", branch)).toBe("");
    expect(readFileSync(join(repo.root, "fonts.txt"), "utf8")).toBe("12 pt\n");
    expect(shipChat(id)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Squashed onto origin\/main as [0-9a-f]{7}\.$/),
      "Running the tests on it: echo tests ok",
      "The tests passed.",
      expect.stringMatching(/^Pushed to origin\/main as/),
      expect.stringMatching(/^Landed on origin\/main as/),
    ]));
  });

  it("leaves your dirty checkout alone, and says its main is behind", async () => {
    const { id } = await inShip();
    writeFileSync(join(repo.root, "app.txt"), "your edit\n");
    await land(id);
    await waitFor(() => hive.card(id).lane === "done");
    expect(readFileSync(join(repo.root, "app.txt"), "utf8")).toBe("your edit\n");
    expect(hive.card(id).landed!.checkout).toMatch(/^behind origin\/main: it has main checked out with uncommitted changes/);
    expect(repo.git("rev-parse", "main")).not.toBe(sh(bare, "rev-parse", "main"));
  });

  it("refuses uncommitted work in the worktree unless you discard it, and keeps git-ignored files", async () => {
    const { id, worktree } = await inShip();
    writeFileSync(join(worktree, "scratch.txt"), "left from trying\n");
    expect((await hive.shipPlan(id)).uncommitted).toEqual(["?? scratch.txt"]);
    await expect(hive.land(id, {})).rejects.toMatchObject({ status: 409 });
    await land(id, { discard: true });
    await waitFor(() => hive.card(id).lane === "done");
    expect(sh(bare, "ls-tree", "--name-only", "main")).not.toContain("scratch.txt");
  });

  it("refuses while your local main has commits origin lacks", async () => {
    const { id } = await inShip();
    writeFileSync(join(repo.root, "local.txt"), "mine\n");
    repo.git("add", "local.txt");
    repo.git("commit", "-q", "-m", "local only");
    expect((await hive.shipPlan(id)).unpushed).toBe(1);
    await expect(hive.land(id, {})).rejects.toThrow(/Push them first/);
  });

  it("sends a conflict back to Build, and the card comes straight back to Ship after Check", async () => {
    const { id, worktree } = await inShip();
    pushFromElsewhere("fonts.txt", "10 pt\n");
    await hive.land(id, {});
    await waitFor(() => hive.card(id).lane === "build");
    const card = hive.card(id);
    expect(card.feedback).toMatch(/^Landing on main stopped on conflicts with origin\/main in fonts\.txt/);
    expect(turnsOf("committer")).toHaveLength(0);

    await waitFor(() => turnsOf("developer").length === 2);
    const fixer = lastOf("developer");
    expect(fixer.request.message).toMatch(/^Landing the card on main stopped:/);
    expect(fixer.request.message).toContain("Bringing in origin/main: the merge of origin/main stopped on conflicts in fonts.txt");
    // The developer resolves the merge.
    writeFileSync(join(worktree, "fonts.txt"), "12 pt\n");
    sh(worktree, "add", "fonts.txt");
    sh(worktree, "commit", "-q", "--no-edit");
    await fixer.end({ kind: "ok", report: built });
    await waitFor(() => turnsOf("reviewer").length === 2);
    await lastOf("reviewer").end({ kind: "ok", report: clean });
    await waitFor(() => hive.card(id).lane === "ship");
    expect(hive.card(id).feedback).toBeNull();

    await land(id);
    await waitFor(() => hive.card(id).lane === "done");
    expect(sh(bare, "show", "main:fonts.txt")).toBe("12 pt");
  });

  it("stops on a failing test with Retry and Back to Build, putting the worktree back on its branch", async () => {
    const { id, worktree, branch } = await inShip({ test: "echo boom; exit 3" });
    await land(id);
    await waitFor(() => hive.card(id).state === "needs-you" && shipChat(id).some((l) => l.startsWith("ERROR")));
    expect(shipChat(id).at(-1)).toMatch(/^ERROR The tests failed on the squash\. It exited with 3\.\n\nboom \[retry,back-to-build\]$/);
    expect(sh(worktree, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
    expect(hive.card(id).lane).toBe("ship");
    expect(sh(bare, "rev-list", "--count", "main")).toBe("1");

    await hive.backToBuild(id);
    expect(hive.card(id)).toMatchObject({ lane: "build", feedback: expect.stringMatching(/^The tests failed on the squash/) });
  });

  it("writes the message from the card when the committer fails", async () => {
    const { id } = await inShip();
    await land(id, {}, { status: "blocked", blockedReason: "x", subject: "", body: "" });
    await waitFor(() => hive.card(id).lane === "done");
    const pushed = sh(bare, "log", "-1", "--format=%B", "main");
    expect(pushed).toMatch(/^Printer font size\n\nSizes: each printer has its own\.\n\nSpec: /);
    expect(shipChat(id).some((l) => l.startsWith("The commit message was written from the card"))).toBe(true);
  });

  it("without a remote, moves your local main when it's safe, and refuses while your checkout is dirty", async () => {
    repo.git("remote", "remove", "origin");
    const { id } = await inShip();
    writeFileSync(join(repo.root, "app.txt"), "your edit\n");
    await expect(hive.land(id, {})).rejects.toThrow(/Commit or stash them/);
    expect((await hive.shipPlan(id)).checkoutBlocks).toBe(true);
    repo.git("checkout", "-q", "--", "app.txt");
    await land(id);
    await waitFor(() => hive.card(id).lane === "done");
    expect(hive.card(id).landed).toMatchObject({ base: "main", remote: false, checkout: "updated" });
    expect(repo.git("log", "-1", "--format=%s")).toBe("Printers get their own font size");
  });

  it("after a restart, finishes a landing that reached main, and undoes one that didn't", async () => {
    const { id, worktree } = await inShip();
    db.updateCard(id, { landing: { base: "origin/main", commit: repo.git("rev-parse", "main"), pushed: false } });
    const restarted = newHive();
    restarted.recoverAfterRestart();
    await waitFor(() => restarted.card(id).lane === "done");
    expect(existsSync(worktree)).toBe(false);
    restarted.close();
  });

  it("undoes a cut-off landing whose commit never reached main", async () => {
    const { id, worktree, branch } = await inShip();
    const stray = sh(worktree, "commit-tree", sh(worktree, "rev-parse", "HEAD^{tree}"), "-p", "HEAD", "-m", "stray");
    sh(worktree, "checkout", "-q", "--detach", stray);
    db.updateCard(id, { landing: { base: "origin/main", commit: stray, pushed: false } });
    const restarted = newHive();
    restarted.recoverAfterRestart();
    await waitFor(() => restarted.card(id).chat.at(-1)?.kind === "error");
    expect(restarted.card(id).chat.at(-1)).toMatchObject({ message: "Landing was cut off. Nothing reached main.", actions: ["retry"] });
    expect(sh(worktree, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
    expect(db.getCard(id)!.landing).toBeNull();
    restarted.close();
  });
});
