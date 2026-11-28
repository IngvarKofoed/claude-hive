import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GitError,
  abortMerge,
  cardSlug,
  changedFiles,
  commitAll,
  commitFile,
  createCardWorktree,
  ensureWorktreesExcluded,
  fileAt,
  hasBranch,
  initEmptyRepo,
  mergeInProgress,
  mergeMain,
  repoAt,
} from "./index.js";

const dirs: string[] = [];
function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "hive-git-")));
  dirs.push(d);
  return d;
}
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", ...args], {
    cwd,
    encoding: "utf8",
  });
}
function makeRepo(): string {
  const root = tmp();
  git(root, "init", "-b", "main");
  writeFileSync(join(root, "a.txt"), "a\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "init");
  return root;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("repoAt", () => {
  it("is null outside a repo", async () => {
    expect(await repoAt(tmp())).toBeNull();
  });
  it("answers the top, from the top and from a subfolder, with real paths", async () => {
    const root = makeRepo();
    mkdirSync(join(root, "sub/deep"), { recursive: true });
    const top = { insideGitDir: false, top: root, mainCheckout: root, mainIsWorkTree: true, linked: false, hasCommits: true };
    expect(await repoAt(root)).toEqual(top);
    expect(await repoAt(join(root, "sub/deep"))).toEqual(top);
  });
  it("marks a linked worktree, naming the main checkout, from its top and from inside it", async () => {
    const root = makeRepo();
    const linked = join(tmp(), "linked");
    git(root, "worktree", "add", "-q", linked, "-b", "other", "main");
    mkdirSync(join(linked, "inner"));
    const answer = { insideGitDir: false, top: linked, mainCheckout: root, mainIsWorkTree: true, linked: true, hasCommits: true };
    expect(await repoAt(linked)).toEqual(answer);
    expect(await repoAt(join(linked, "inner"))).toEqual(answer);
  });
  it("names the bare repo, not the worktree, for a worktree of a bare repo, and says it isn't a work tree", async () => {
    const d = tmp();
    const bare = join(d, "bare.git");
    git(d, "init", "-q", "--bare", "-b", "main", bare);
    const emptyTree = git(bare, "hash-object", "-t", "tree", "-w", "/dev/null").trim();
    const commit = git(bare, "commit-tree", "-m", "init", emptyTree).trim();
    git(bare, "update-ref", "refs/heads/main", commit);
    const wt = join(d, "wt");
    git(bare, "worktree", "add", "-q", wt, "main");
    expect(await repoAt(wt)).toEqual({
      insideGitDir: false, top: wt, mainCheckout: bare, mainIsWorkTree: false, linked: true, hasCommits: true,
    });
  });
  it("names the separate git dir for a worktree of a --separate-git-dir repo, whose checkout git can't find", async () => {
    const d = tmp();
    const gitDir = join(d, "gitdir");
    const checkout = join(d, "checkout");
    git(d, "init", "-q", "-b", "main", "--separate-git-dir", gitDir, checkout);
    git(checkout, "commit", "-q", "--allow-empty", "-m", "init");
    const wt = join(d, "wt");
    git(checkout, "worktree", "add", "-q", wt, "-b", "other");
    expect(await repoAt(wt)).toEqual({
      insideGitDir: false, top: wt, mainCheckout: gitDir, mainIsWorkTree: false, linked: true, hasCommits: true,
    });
    // The main checkout itself is still its own top.
    expect(await repoAt(checkout)).toMatchObject({ top: checkout, mainCheckout: checkout, mainIsWorkTree: true, linked: false });
  });
  it("is insideGitDir in .git itself, below it, and in a bare repo", async () => {
    const root = makeRepo();
    expect(await repoAt(join(root, ".git"))).toEqual({ insideGitDir: true });
    expect(await repoAt(join(root, ".git/refs"))).toEqual({ insideGitDir: true });
    const bare = tmp();
    git(bare, "init", "-q", "--bare");
    expect(await repoAt(bare)).toEqual({ insideGitDir: true });
  });
  it("says hasCommits false in a repo with no commits", async () => {
    const d = tmp();
    git(d, "init", "-q", "-b", "main");
    expect(await repoAt(d)).toEqual({
      insideGitDir: false, top: d, mainCheckout: d, mainIsWorkTree: true, linked: false, hasCommits: false,
    });
  });
});

describe("initEmptyRepo", () => {
  beforeEach(() => {
    vi.stubEnv("GIT_AUTHOR_NAME", "T");
    vi.stubEnv("GIT_AUTHOR_EMAIL", "t@example.com");
    vi.stubEnv("GIT_COMMITTER_NAME", "T");
    vi.stubEnv("GIT_COMMITTER_EMAIL", "t@example.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  function failingHook(): void {
    const hooks = tmp();
    writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\necho nope >&2\nexit 1\n", { mode: 0o755 });
    vi.stubEnv("GIT_CONFIG_COUNT", "1");
    vi.stubEnv("GIT_CONFIG_KEY_0", "core.hooksPath");
    vi.stubEnv("GIT_CONFIG_VALUE_0", hooks);
  }

  it("makes one empty commit on main in a folder holding only .DS_Store, which stays untracked", async () => {
    const d = tmp();
    writeFileSync(join(d, ".DS_Store"), "x");
    await initEmptyRepo(d);
    expect(git(d, "branch", "--show-current").trim()).toBe("main");
    expect(git(d, "log", "--oneline").trim().split("\n")).toHaveLength(1);
    expect(git(d, "show", "--stat", "--format=", "HEAD").trim()).toBe("");
    expect(git(d, "status", "--porcelain", "--untracked-files=all").trim()).toBe("?? .DS_Store");
  });
  it("points HEAD at main in a git init -b master repo with no commits, leaving no master", async () => {
    const d = tmp();
    git(d, "init", "-q", "-b", "master");
    await initEmptyRepo(d);
    expect(git(d, "symbolic-ref", "HEAD").trim()).toBe("refs/heads/main");
    expect(git(d, "log", "--oneline").trim().split("\n")).toHaveLength(1);
    expect(git(d, "show", "--stat", "--format=", "HEAD").trim()).toBe("");
    expect(git(d, "branch", "--list").trim()).toBe("* main");
  });
  it("removes the fresh .git when the commit fails", async () => {
    const d = tmp();
    failingHook();
    await expect(initEmptyRepo(d)).rejects.toBeInstanceOf(GitError);
    expect(existsSync(join(d, ".git"))).toBe(false);
  });
  it("puts HEAD back and keeps .git in a no-commits repo when the commit fails", async () => {
    const d = tmp();
    git(d, "init", "-q", "-b", "master");
    failingHook();
    await expect(initEmptyRepo(d)).rejects.toThrow(/nope|hook/);
    expect(existsSync(join(d, ".git"))).toBe(true);
    expect(git(d, "symbolic-ref", "HEAD").trim()).toBe("refs/heads/master");
  });
  it("refuses a repo that has commits", async () => {
    await expect(initEmptyRepo(makeRepo())).rejects.toBeInstanceOf(GitError);
  });
});

describe("fileAt", () => {
  it("reads a file as it was at a commit, and throws GitError for one that isn't there", async () => {
    const root = makeRepo();
    const first = git(root, "rev-parse", "HEAD").trim();
    writeFileSync(join(root, "a.txt"), "changed\n");
    git(root, "commit", "-qam", "change");
    expect(await fileAt(root, first, "a.txt")).toBe("a\n");
    await expect(fileAt(root, first, "missing.txt")).rejects.toBeInstanceOf(GitError);
  });
});

describe("hasBranch", () => {
  it("finds existing and not missing branches", async () => {
    const root = makeRepo();
    expect(await hasBranch(root, "main")).toBe(true);
    expect(await hasBranch(root, "hive/x")).toBe(false);
  });
});

describe("ensureWorktreesExcluded", () => {
  it("adds the line once", async () => {
    const root = makeRepo();
    await ensureWorktreesExcluded(root);
    await ensureWorktreesExcluded(root);
    const text = readFileSync(join(root, ".git/info/exclude"), "utf8");
    expect(text.split("\n").filter((l) => l === ".claude/worktrees/")).toHaveLength(1);
  });
  it("creates the file when missing and keeps the checkout clean after a worktree", async () => {
    const root = makeRepo();
    rmSync(join(root, ".git/info"), { recursive: true, force: true });
    await ensureWorktreesExcluded(root);
    await createCardWorktree(root, "x-111111");
    expect(git(root, "status", "--porcelain")).toBe("");
  });
  it("works when the project path is a linked worktree", async () => {
    const root = makeRepo();
    const linked = join(tmp(), "linked");
    git(root, "worktree", "add", linked, "-b", "other", "main");
    expect(readFileSync(join(linked, ".git"), "utf8")).toMatch(/^gitdir:/);
    await ensureWorktreesExcluded(linked);
    const p = git(linked, "rev-parse", "--git-path", "info/exclude").trim();
    expect(readFileSync(resolve(linked, p), "utf8")).toContain(".claude/worktrees/");
  });
});

describe("createCardWorktree", () => {
  it("creates folder and branch; a second call throws GitError", async () => {
    const root = makeRepo();
    const r = await createCardWorktree(root, "fix-1a2b3c");
    expect(r.branch).toBe("hive/fix-1a2b3c");
    expect(r.worktreePath).toBe(join(root, ".claude/worktrees/fix-1a2b3c"));
    expect(existsSync(join(r.worktreePath, "a.txt"))).toBe(true);
    expect(await hasBranch(root, r.branch)).toBe(true);
    await expect(createCardWorktree(root, "fix-1a2b3c")).rejects.toBeInstanceOf(GitError);
  });
});

describe("cardSlug", () => {
  it("slugifies", () => {
    expect(cardSlug("Make the Printer Font BIGGER!", "1A2b3c4d")).toBe("make-the-printer-font-bigger-1a2b3c");
  });
  it("drops non-ASCII", () => {
    expect(cardSlug("Café été", "abcdef12")).toBe("caf-t-abcdef");
  });
  it("handles empty titles", () => {
    expect(cardSlug("", "1a2b3c4d")).toBe("card-1a2b3c");
    expect(cardSlug("日本語", "ab-cd-ef-gh")).toBe("card-abcdef");
  });
  it("caps long titles at 40 chars", () => {
    const s = cardSlug("a".repeat(100), "123456");
    expect(s).toBe("a".repeat(40) + "-123456");
    const t = cardSlug("word ".repeat(30), "123456");
    expect(t.length).toBeLessThanOrEqual(47);
    expect(t).not.toMatch(/--/);
  });
});

describe("commitFile", () => {
  it("commits a new file on the worktree's branch, then only real changes", async () => {
    const root = makeRepo();
    git(root, "config", "user.name", "T");
    git(root, "config", "user.email", "t@example.com");
    const { worktreePath, branch } = await createCardWorktree(root, "spec-card");
    mkdirSync(join(worktreePath, "docs", "specs"), { recursive: true });
    writeFileSync(join(worktreePath, "docs", "specs", "s.md"), "# Spec\n");
    expect(await commitFile(worktreePath, "docs/specs/s.md", "Spec: s")).toBe(true);
    expect(git(root, "log", "--format=%s", branch, "-1").trim()).toBe("Spec: s");
    expect(git(worktreePath, "status", "--porcelain")).toBe("");
    expect(await commitFile(worktreePath, "docs/specs/s.md", "Spec: s")).toBe(false);
    writeFileSync(join(worktreePath, "docs", "specs", "s.md"), "# Spec, revised\n");
    expect(await commitFile(worktreePath, "docs/specs/s.md", "Spec: s again")).toBe(true);
  });

  it("throws GitError for a path git can't add", async () => {
    const root = makeRepo();
    const { worktreePath } = await createCardWorktree(root, "nope-card");
    await expect(commitFile(worktreePath, "missing.md", "x")).rejects.toThrow(GitError);
  });
});

describe("Build: bringing in main, checkpoints and changed files", () => {
  /** A repo whose card worktree has a local identity, so the hive's own merges and commits work in it. */
  async function cardRepo() {
    const root = makeRepo();
    git(root, "config", "user.name", "T");
    git(root, "config", "user.email", "t@example.com");
    await ensureWorktreesExcluded(root);
    const { worktreePath } = await createCardWorktree(root, "card-1");
    return { root, wt: worktreePath };
  }

  it("reports main already in, then merges new commits on main", async () => {
    const { root, wt } = await cardRepo();
    expect(await mergeMain(wt)).toEqual({ kind: "clean", commits: 0 });
    writeFileSync(join(root, "b.txt"), "b\n");
    git(root, "add", "b.txt");
    git(root, "commit", "-m", "b on main");
    expect(await mergeMain(wt)).toEqual({ kind: "clean", commits: 1 });
    expect(existsSync(join(wt, "b.txt"))).toBe(true);
  });

  it("stops on conflicts, names the files, and says so again until the merge is finished or aborted", async () => {
    const { root, wt } = await cardRepo();
    writeFileSync(join(wt, "a.txt"), "card\n");
    git(wt, "commit", "-am", "card change");
    writeFileSync(join(root, "a.txt"), "main\n");
    git(root, "commit", "-am", "main change");

    expect(await mergeMain(wt)).toEqual({ kind: "conflict", files: ["a.txt"] });
    expect(await mergeInProgress(wt)).toBe(true);
    expect(await mergeMain(wt)).toEqual({ kind: "conflict", files: ["a.txt"] });

    await abortMerge(wt);
    expect(await mergeInProgress(wt)).toBe(false);
    expect(readFileSync(join(wt, "a.txt"), "utf8")).toBe("card\n");
  });

  it("commits everything left as a checkpoint, and says when there was nothing", async () => {
    const { wt } = await cardRepo();
    expect(await commitAll(wt, "Build: nothing")).toBe(false);
    writeFileSync(join(wt, "new.txt"), "new\n");
    writeFileSync(join(wt, "a.txt"), "changed\n");
    expect(await commitAll(wt, "Build: card")).toBe(true);
    expect(git(wt, "status", "--porcelain")).toBe("");
    expect(git(wt, "log", "-1", "--format=%s").trim()).toBe("Build: card");
  });

  it("commits a checkpoint even when a pre-commit hook would refuse it", async () => {
    const { root, wt } = await cardRepo();
    const hooks = join(root, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    writeFileSync(join(wt, "new.txt"), "new\n");
    expect(await commitAll(wt, "Build: card")).toBe(true);
  });

  it("lists the files changed on the branch against main, with null counts for a binary file", async () => {
    const { wt } = await cardRepo();
    writeFileSync(join(wt, "a.txt"), "a\nmore\n");
    writeFileSync(join(wt, "img.bin"), Buffer.from([0, 1, 2, 0, 255]));
    await commitAll(wt, "Build: card");
    const files = await changedFiles(wt);
    expect(files).toContainEqual({ path: "a.txt", added: 1, removed: 0 });
    expect(files).toContainEqual({ path: "img.bin", added: null, removed: null });
  });
});
