// Ship's git on throwaway repos, with a bare repo as `origin` (docs/specs/2026-11-27-ship-lane.md).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeRepo, type TempRepo } from "../testing";
import { createCardWorktree, ensureWorktreesExcluded } from "./index";
import {
  commitTree, discardChanges, mainBase, mainCheckout, moveLocalMain, pushMain, removeCardWorktree, squashTree,
  switchWorktree, unpushedCount, worktreeStatus,
} from "./ship";

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

describe("Ship's git", () => {
  let repo: TempRepo;
  let bare: string;
  let other: string;
  let wt: string;
  const branch = "hive/c-1";

  beforeEach(async () => {
    repo = makeRepo();
    const base = mkdtempSync(join(tmpdir(), "hive-origin-"));
    bare = join(base, "origin.git");
    other = join(base, "other");
    sh(base, "init", "-q", "--bare", "-b", "main", bare);
    repo.git("remote", "add", "origin", bare);
    repo.git("push", "-q", "origin", "main");
    await ensureWorktreesExcluded(repo.root);
    wt = (await createCardWorktree(repo.root, "c-1")).worktreePath;
    writeFileSync(join(wt, "feature.txt"), "the card's work\n");
    sh(wt, "add", "-A");
    sh(wt, "commit", "-q", "-m", "Build: the card");
  });
  afterEach(() => {
    repo.cleanup();
    rmSync(join(bare, ".."), { recursive: true, force: true });
  });

  /** Someone else pushes to origin/main. */
  function pushFromElsewhere(file: string, content: string) {
    if (!existsSync(other)) sh(join(bare, ".."), "clone", "-q", bare, other);
    sh(other, "pull", "-q", "origin", "main");
    writeFileSync(join(other, file), content);
    sh(other, "add", "-A");
    sh(other, "commit", "-q", "-m", `elsewhere: ${file}`);
    sh(other, "push", "-q", "origin", "main");
  }

  it("works from a fetched origin/main, or local main without a remote, and says when the fetch failed", async () => {
    pushFromElsewhere("new.txt", "x\n");
    expect(await mainBase(repo.root)).toEqual({ ref: "origin/main" });
    expect(repo.git("rev-parse", "origin/main")).toBe(sh(other, "rev-parse", "HEAD"));

    repo.git("remote", "set-url", "origin", "/nonexistent/origin.git");
    const offline = await mainBase(repo.root);
    expect(offline.ref).toBe("origin/main");
    expect(offline.fetchFailed).toBeTruthy();

    repo.git("remote", "remove", "origin");
    expect(await mainBase(repo.root)).toEqual({ ref: "main" });
  });

  it("squashes the card onto the base as one commit, without touching any working folder", async () => {
    pushFromElsewhere("new.txt", "x\n");
    await mainBase(repo.root);
    const statusBefore = repo.git("status", "--porcelain");
    const sq = await squashTree(repo.root, "origin/main", branch);
    expect(sq.kind).toBe("tree");
    if (sq.kind !== "tree") return;
    const commit = await commitTree(repo.root, sq.tree, sq.base, "Add the card's work\n\nHive-Card: c-1");
    expect(repo.git("rev-parse", `${commit}^`)).toBe(repo.git("rev-parse", "origin/main"));
    expect(repo.git("show", `${commit}:feature.txt`)).toBe("the card's work");
    expect(repo.git("show", `${commit}:new.txt`)).toBe("x");
    expect(repo.git("log", "-1", "--format=%B", commit)).toContain("Hive-Card: c-1");
    expect(repo.git("status", "--porcelain")).toBe(statusBefore);
    expect(sh(wt, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
  });

  it("reports the conflicting files, and a branch that adds nothing", async () => {
    pushFromElsewhere("feature.txt", "someone else's\n");
    await mainBase(repo.root);
    expect(await squashTree(repo.root, "origin/main", branch)).toEqual({ kind: "conflict", files: ["feature.txt"] });

    sh(wt, "reset", "-q", "--hard", "origin/main");
    expect((await squashTree(repo.root, "origin/main", branch)).kind).toBe("same");
  });

  it("pushes main forward only, and says when main moved on", async () => {
    await mainBase(repo.root);
    const sq = await squashTree(repo.root, "origin/main", branch);
    if (sq.kind !== "tree") throw new Error("expected a tree");
    const commit = await commitTree(repo.root, sq.tree, sq.base, "The card");
    pushFromElsewhere("new.txt", "x\n");
    expect(await pushMain(repo.root, commit)).toEqual({ kind: "moved" });

    await mainBase(repo.root);
    const again = await squashTree(repo.root, "origin/main", branch);
    if (again.kind !== "tree") throw new Error("expected a tree");
    const second = await commitTree(repo.root, again.tree, again.base, "The card");
    expect(await pushMain(repo.root, second)).toEqual({ kind: "pushed" });
    expect(sh(bare, "rev-parse", "main")).toBe(second);
  });

  it("counts local commits that origin lacks", async () => {
    expect(await unpushedCount(repo.root)).toBe(0);
    writeFileSync(join(repo.root, "local.txt"), "mine\n");
    repo.git("add", "local.txt");
    repo.git("commit", "-q", "-m", "local only");
    await mainBase(repo.root);
    expect(await unpushedCount(repo.root)).toBe(1);
  });

  it("moves your checkout's main forward only when that's safe", async () => {
    await mainBase(repo.root);
    const sq = await squashTree(repo.root, "origin/main", branch);
    if (sq.kind !== "tree") throw new Error("expected a tree");
    const commit = await commitTree(repo.root, sq.tree, sq.base, "The card");

    expect(await mainCheckout(repo.root)).toEqual({ path: expect.stringContaining("repo"), dirty: false });
    writeFileSync(join(repo.root, "app.txt"), "your edit\n");
    expect(await moveLocalMain(repo.root, commit)).toMatch(/uncommitted changes/);
    expect(readFileSync(join(repo.root, "app.txt"), "utf8")).toBe("your edit\n");
    expect(repo.git("rev-parse", "main")).not.toBe(commit);

    repo.git("checkout", "-q", "--", "app.txt");
    expect(await moveLocalMain(repo.root, commit)).toBe("updated");
    expect(repo.git("rev-parse", "main")).toBe(commit);
    expect(readFileSync(join(repo.root, "feature.txt"), "utf8")).toBe("the card's work\n");
  });

  it("moves main by compare-and-swap when it isn't checked out, and never backwards", async () => {
    repo.git("checkout", "-q", "--detach");
    expect(await mainCheckout(repo.root)).toBeNull();
    const sq = await squashTree(repo.root, "main", branch);
    if (sq.kind !== "tree") throw new Error("expected a tree");
    const commit = await commitTree(repo.root, sq.tree, sq.base, "The card");
    expect(await moveLocalMain(repo.root, commit)).toBe("updated");
    expect(repo.git("rev-parse", "main")).toBe(commit);

    const unrelated = await commitTree(repo.root, repo.git("rev-parse", `${sq.base}^{tree}`), sq.base, "elsewhere");
    expect(await moveLocalMain(repo.root, unrelated)).toMatch(/can't be moved forward/);
    expect(repo.git("rev-parse", "main")).toBe(commit);
  });

  it("lists and discards uncommitted work, keeping git-ignored files", async () => {
    writeFileSync(join(repo.root, ".gitignore"), ".env\n");
    repo.git("add", ".gitignore");
    repo.git("commit", "-q", "-m", "ignore");
    sh(wt, "merge", "-q", "main");
    writeFileSync(join(wt, ".env"), "SECRET=1\n");
    writeFileSync(join(wt, "feature.txt"), "changed while trying\n");
    writeFileSync(join(wt, "scratch.txt"), "left over\n");
    expect((await worktreeStatus(wt)).sort()).toEqual([" M feature.txt", "?? scratch.txt"]);
    await discardChanges(wt);
    expect(await worktreeStatus(wt)).toEqual([]);
    expect(readFileSync(join(wt, "feature.txt"), "utf8")).toBe("the card's work\n");
    expect(existsSync(join(wt, ".env"))).toBe(true);
  });

  it("switches the worktree to a commit and back, and removes the worktree and branch", async () => {
    const sq = await squashTree(repo.root, "main", branch);
    if (sq.kind !== "tree") throw new Error("expected a tree");
    const commit = await commitTree(repo.root, sq.tree, sq.base, "The card");
    await switchWorktree(wt, { commit });
    expect(sh(wt, "rev-parse", "HEAD")).toBe(commit);
    await switchWorktree(wt, { branch });
    expect(sh(wt, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
    await removeCardWorktree(repo.root, wt, branch);
    expect(existsSync(wt)).toBe(false);
    expect(repo.git("branch", "--list", branch)).toBe("");
  });
});
