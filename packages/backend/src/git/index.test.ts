import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GitError,
  cardSlug,
  commitFile,
  createCardWorktree,
  ensureWorktreesExcluded,
  hasBranch,
  resolveRepoRoot,
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

describe("resolveRepoRoot", () => {
  it("resolves from a subfolder", async () => {
    const root = makeRepo();
    mkdirSync(join(root, "sub/deep"), { recursive: true });
    expect(await resolveRepoRoot(join(root, "sub/deep"))).toBe(root);
  });
  it("throws GitError for a non-repo and a missing path", async () => {
    const d = tmp();
    await expect(resolveRepoRoot(d)).rejects.toBeInstanceOf(GitError);
    await expect(resolveRepoRoot(join(d, "nope"))).rejects.toThrow(/is not a git repository/);
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
    const lroot = await resolveRepoRoot(linked);
    await ensureWorktreesExcluded(lroot);
    const p = git(lroot, "rev-parse", "--git-path", "info/exclude").trim();
    expect(readFileSync(resolve(lroot, p), "utf8")).toContain(".claude/worktrees/");
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
