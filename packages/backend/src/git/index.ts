import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

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

/** Resolve any path inside a repo to the repo's root, as an absolute, real path. */
export async function resolveRepoRoot(path: string): Promise<string> {
  const notRepo = new GitError(`${path} is not a git repository`);
  let dir: string;
  try {
    dir = await realpath(path);
    if (!(await stat(dir)).isDirectory()) dir = dirname(dir);
  } catch {
    throw notRepo;
  }
  const r = await git(dir, ["rev-parse", "--show-toplevel"]);
  const top = r.stdout.trim();
  if (!r.ok || !top) throw notRepo;
  return realpath(top);
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

/** `git worktree add <root>/.claude/worktrees/<slug> -b hive/<slug> main`, run in `root`. */
export async function createCardWorktree(
  root: string,
  slug: string,
): Promise<{ worktreePath: string; branch: string }> {
  const worktreePath = join(root, ".claude", "worktrees", slug);
  const branch = `hive/${slug}`;
  const r = await git(root, ["worktree", "add", worktreePath, "-b", branch, "main"]);
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
