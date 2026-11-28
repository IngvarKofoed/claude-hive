import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const run = promisify(execFile);

/** A git failure whose message is safe to show the user (git's reason, trimmed). */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

const WORKTREES_LINE = ".claude/worktrees/";

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

async function git(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await run("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string; code?: string };
    if (e.code === "ENOENT") throw new GitError("git is not installed or not on PATH");
    return { ok: false, stdout: e.stdout ?? "", stderr: (e.stderr || e.message).trim() };
  }
}

function reason(stderr: string): string {
  return stderr.replace(/^(fatal|error): /gm, "").trim() || "git failed";
}

/**
 * What git makes of a folder (docs/specs/2026-11-28-folder-autocomplete-and-git-init-when-ad.md): null outside any
 * repo; `insideGitDir` inside a `.git` folder or a bare repo; otherwise the work tree's top, the repo's main checkout
 * (a linked worktree's or a subfolder's repo, never a worktree's folder), whether it's a linked worktree, and whether
 * HEAD has a commit. Every path is real.
 *
 * A linked worktree of a bare repo, of a `--separate-git-dir` repo or of a submodule has no `<checkout>/.git` to find
 * its checkout from, and git itself names the common git dir as its main worktree. Then `mainCheckout` is that
 * folder, and `mainIsWorkTree` is false: it's git's own data, not a folder to add.
 */
export type RepoAt =
  | { insideGitDir: true }
  | {
    insideGitDir: false; top: string; mainCheckout: string; mainIsWorkTree: boolean; linked: boolean; hasCommits: boolean;
  };

/** Ask git what `dir`, an existing folder, is part of. */
export async function repoAt(dir: string): Promise<RepoAt | null> {
  // The first call also works inside git's own data, where --show-toplevel fails, so it settles that case.
  const r = await git(dir, ["rev-parse", "--is-inside-git-dir", "--is-bare-repository", "--git-dir", "--git-common-dir"]);
  if (!r.ok) return null;
  const [insideGitDir, bare, gitDirLine, commonDirLine] = r.stdout.split("\n").map((l) => l.trim());
  if (insideGitDir === "true" || bare === "true") return { insideGitDir: true };
  if (!gitDirLine || !commonDirLine) return null;
  // git prints these relative to `dir` (".git", "../.git") or absolute.
  const gitDir = await realpath(resolve(dir, gitDirLine));
  const commonDir = await realpath(resolve(dir, commonDirLine));
  const t = await git(dir, ["rev-parse", "--show-toplevel"]);
  const topLine = t.stdout.trim();
  if (!t.ok || !topLine) return null;
  const top = await realpath(topLine);
  const hasCommits = (await git(dir, ["rev-parse", "-q", "--verify", "HEAD"])).ok;
  const linked = gitDir !== commonDir;
  let main = { mainCheckout: top, mainIsWorkTree: true };
  if (basename(commonDir) === ".git") main = { mainCheckout: dirname(commonDir), mainIsWorkTree: true };
  else if (linked) main = await mainWorktree(dir, commonDir);
  return { insideGitDir: false, top, ...main, linked, hasCommits };
}

/** The first entry of `git worktree list`: the main worktree, or the bare repo or common git dir when there is none. */
async function mainWorktree(dir: string, commonDir: string): Promise<{ mainCheckout: string; mainIsWorkTree: boolean }> {
  const r = await git(dir, ["worktree", "list", "--porcelain"]);
  const first = r.ok ? r.stdout.split("\n\n")[0]!.split("\n") : [];
  const line = first.find((l) => l.startsWith("worktree "));
  if (!line) return { mainCheckout: commonDir, mainIsWorkTree: false };
  const path = await realpath(line.slice("worktree ".length)).catch(() => line.slice("worktree ".length));
  return { mainCheckout: path, mainIsWorkTree: path !== commonDir && !first.includes("bare") };
}

/**
 * Make `dir` a repo on main with one empty commit, in the user's own git identity: `git init -b main` in a folder
 * that isn't a repo, or HEAD pointed at main in a repo top with no commits. A failed commit leaves the folder as it
 * was: the fresh `.git` is removed, or HEAD goes back to its old ref.
 */
export async function initEmptyRepo(dir: string): Promise<void> {
  const repo = await repoAt(dir);
  if (repo && (repo.insideGitDir || repo.hasCommits || repo.top !== (await realpath(dir)))) {
    throw new GitError(`${dir} is already part of a git repo with commits.`);
  }
  const commit = ["commit", "--allow-empty", "-q", "-m", "Initial commit"];
  if (!repo) {
    const init = await git(dir, ["init", "-q", "-b", "main"]);
    if (!init.ok) throw new GitError(reason(init.stderr));
    const c = await git(dir, commit);
    if (!c.ok) {
      await rm(join(dir, ".git"), { recursive: true, force: true });
      throw new GitError(reason(c.stderr));
    }
    return;
  }
  const head = await git(dir, ["symbolic-ref", "HEAD"]);
  const oldRef = head.ok ? head.stdout.trim() : null;
  const point = await git(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  if (!point.ok) throw new GitError(reason(point.stderr));
  const c = await git(dir, commit);
  if (!c.ok) {
    if (oldRef) await git(dir, ["symbolic-ref", "HEAD", oldRef]);
    throw new GitError(reason(c.stderr));
  }
}

/** True if the repo has a local branch with this name. */
export async function hasBranch(root: string, branch: string): Promise<boolean> {
  const r = await git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  return r.ok;
}

/** Make sure `.claude/worktrees/` is listed in the repo's exclude file. */
export async function ensureWorktreesExcluded(root: string): Promise<void> {
  const r = await git(root, ["rev-parse", "--git-path", "info/exclude"]);
  if (!r.ok) throw new GitError(reason(r.stderr));
  const p = r.stdout.trim();
  const file = isAbsolute(p) ? p : resolve(root, p);
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch {
    await mkdir(dirname(file), { recursive: true });
  }
  const has = existing
    .split(/\r?\n/)
    .some((l) => l.trim() === WORKTREES_LINE || l.trim() === "/" + WORKTREES_LINE);
  if (has) return;
  const prefix = existing === "" || existing.endsWith("\n") ? "" : "\n";
  await appendFile(file, `${prefix}${WORKTREES_LINE}\n`);
}

/**
 * `git worktree add <root>/.claude/worktrees/<slug> -b hive/<slug> <base>`, run in `root`. The base is the hive's one
 * base: a fetched `origin/main`, or `main` without a remote (docs/specs/2026-11-27-ship-lane.md).
 */
export async function createCardWorktree(
  root: string,
  slug: string,
  base = "main",
): Promise<{ worktreePath: string; branch: string }> {
  const worktreePath = join(root, ".claude", "worktrees", slug);
  const branch = `hive/${slug}`;
  const r = await git(root, ["worktree", "add", "--no-track", worktreePath, "-b", branch, base]);
  if (!r.ok) throw new GitError(reason(r.stderr));
  return { worktreePath, branch };
}

/**
 * A checkpoint commit of one file on the worktree's branch: `git add -- <path>`, then `git commit -m <message> --
 * <path>`. The add is needed because the file may be new. Returns false when the file has no changes to commit.
 */
export async function commitFile(worktree: string, path: string, message: string): Promise<boolean> {
  const add = await git(worktree, ["add", "--", path]);
  if (!add.ok) throw new GitError(reason(add.stderr));
  const staged = await git(worktree, ["diff", "--cached", "--quiet", "--", path]);
  if (staged.ok) return false; // nothing staged for this file
  const commit = await git(worktree, ["commit", "-q", "-m", message, "--", path]);
  if (!commit.ok) throw new GitError(reason(commit.stderr));
  return true;
}

/** A file's text at a commit: `git show <commit>:<path>`, `path` relative to the repo's root. */
export async function fileAt(root: string, commit: string, path: string): Promise<string> {
  const show = await git(root, ["show", `${commit}:${path}`]);
  if (!show.ok) throw new GitError(reason(show.stderr));
  return show.stdout;
}

/** The commit the worktree's branch is at: `git rev-parse HEAD`. */
export async function headCommit(worktree: string): Promise<string> {
  const head = await git(worktree, ["rev-parse", "HEAD"]);
  if (!head.ok) throw new GitError(reason(head.stderr));
  return head.stdout.trim();
}

/**
 * One file's changes since a commit, as it is on disk now: `git diff <commit> -- <path>`. An amendment's spec diff
 * (docs/specs/2026-11-28-try-it-send-back.md); empty when the file hasn't changed.
 */
export async function diffFile(worktree: string, commit: string, path: string): Promise<string> {
  const diff = await git(worktree, ["diff", commit, "--", path]);
  if (!diff.ok) throw new GitError(reason(diff.stderr));
  return diff.stdout;
}

/** What bringing in main did (docs/specs/2026-11-26-build-lane-developer.md, Starting the developer). */
export type MergeResult =
  | { kind: "clean"; commits: number }
  | { kind: "conflict"; files: string[] }
  | { kind: "failed"; reason: string };

/** True while a merge in the worktree is unfinished: MERGE_HEAD exists. */
export async function mergeInProgress(worktree: string): Promise<boolean> {
  return (await git(worktree, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])).ok;
}

async function conflictedFiles(worktree: string): Promise<string[]> {
  const r = await git(worktree, ["diff", "--name-only", "--diff-filter=U"]);
  return r.stdout.split("\n").filter(Boolean);
}

/**
 * Bring the base (a fetched `origin/main`, or local `main` without a remote) into the worktree's branch with
 * `git merge --no-edit --no-verify <base>`. A merge left unfinished earlier is reported as a conflict without starting
 * a new one. `--no-verify`, because a project's hook mustn't stop a lane's own bookkeeping; Ship runs the project's
 * checks on what lands.
 */
export async function mergeMain(worktree: string, base = "main"): Promise<MergeResult> {
  if (await mergeInProgress(worktree)) return { kind: "conflict", files: await conflictedFiles(worktree) };
  const count = await git(worktree, ["rev-list", "--count", `HEAD..${base}`]);
  if (!count.ok) return { kind: "failed", reason: reason(count.stderr) };
  const commits = Number(count.stdout.trim()) || 0;
  if (commits === 0) return { kind: "clean", commits: 0 };
  const merge = await git(worktree, ["merge", "--no-edit", "--no-verify", base]);
  if (merge.ok) return { kind: "clean", commits };
  if (await mergeInProgress(worktree)) return { kind: "conflict", files: await conflictedFiles(worktree) };
  return { kind: "failed", reason: reason(merge.stderr || merge.stdout) };
}

/** `git merge --abort`: back to the branch as it was before the unfinished merge. */
export async function abortMerge(worktree: string): Promise<void> {
  const r = await git(worktree, ["merge", "--abort"]);
  if (!r.ok) throw new GitError(reason(r.stderr));
}

/**
 * A lane-exit checkpoint: commit everything left in the worktree (`git add -A`, so .gitignore applies) with
 * `--no-verify`, since a checkpoint is never what lands on main. Returns false when there's nothing to commit.
 */
export async function commitAll(worktree: string, message: string): Promise<boolean> {
  const add = await git(worktree, ["add", "-A"]);
  if (!add.ok) throw new GitError(reason(add.stderr));
  if ((await git(worktree, ["diff", "--cached", "--quiet"])).ok) return false;
  const commit = await git(worktree, ["commit", "-q", "--no-verify", "-m", message]);
  if (!commit.ok) throw new GitError(reason(commit.stderr || commit.stdout));
  return true;
}

/**
 * The files changed on the worktree's branch against main (`git diff --numstat main...HEAD`). `-z` keeps paths
 * unquoted, and `--no-renames` lists a rename as a delete and an add rather than as `old => new`.
 */
export async function changedFiles(worktree: string): Promise<{ path: string; added: number | null; removed: number | null }[]> {
  const r = await git(worktree, ["diff", "--numstat", "-z", "--no-renames", "main...HEAD"]);
  if (!r.ok) throw new GitError(reason(r.stderr));
  return r.stdout
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [added, removed, ...path] = line.split("\t");
      const n = (v: string | undefined) => (v === undefined || v === "-" ? null : Number(v));
      return { path: path.join("\t"), added: n(added), removed: n(removed) };
    });
}

/** Deleting a card: `git worktree remove --force` (docs/specs/2026-11-27-delete-a-card.md). */
export async function removeWorktree(root: string, worktree: string): Promise<void> {
  const r = await git(root, ["worktree", "remove", "--force", worktree]);
  if (!r.ok) throw new GitError(reason(r.stderr));
}

/** Forgets worktrees whose folder is already gone, so their branch can be deleted. */
export async function pruneWorktrees(root: string): Promise<void> {
  const r = await git(root, ["worktree", "prune"]);
  if (!r.ok) throw new GitError(reason(r.stderr));
}

/** `git branch -D`: the card's branch goes, whatever it holds. */
export async function deleteBranch(root: string, branch: string): Promise<void> {
  const r = await git(root, ["branch", "-D", branch]);
  if (!r.ok) throw new GitError(reason(r.stderr));
}

/** A folder- and branch-safe slug from the title plus the first 6 chars of the id. */
export function cardSlug(title: string, id: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const idPart = id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6);
  return base ? `${base}-${idPart}` : `card-${idPart}`;
}

export * from "./localFiles";
export * from "./ship";
