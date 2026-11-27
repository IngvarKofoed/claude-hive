// Ship's git: one base for the whole hive (a fetched origin/main, or local main without a remote), a squash made without
// touching any working file, main moved forward only, and your checkout touched only when that's safe
// (docs/specs/2026-11-27-ship-lane.md).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

interface GitResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

async function git(cwd: string, args: string[], timeoutMs = 0): Promise<GitResult> {
  try {
    const { stdout, stderr } = await run("git", args, { cwd, maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs });
    return { ok: true, code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string; code?: number | string };
    return {
      ok: false, code: typeof e.code === "number" ? e.code : -1, stdout: e.stdout ?? "",
      stderr: (e.stderr || e.message).trim(),
    };
  }
}

const reason = (stderr: string) => stderr.replace(/^(fatal|error|hint): /gm, "").trim() || "git failed";

/** The base the hive works from, and why a fetch failed if it did. */
export interface MainBase {
  ref: "origin/main" | "main";
  /** The fetch of origin failed: the base is the last fetched origin/main (or main, if there never was one). */
  fetchFailed?: string;
}

export async function hasOrigin(root: string): Promise<boolean> {
  return (await git(root, ["remote", "get-url", "origin"])).ok;
}

/**
 * With an `origin`, a freshly fetched `origin/main`; without one, local `main`. A failed fetch falls back to the last
 * fetched `origin/main`, and says why (docs/specs/2026-11-27-ship-lane.md, Key decisions: one base).
 */
export async function mainBase(root: string): Promise<MainBase> {
  if (!(await hasOrigin(root))) return { ref: "main" };
  const fetch = await git(root, ["fetch", "-q", "origin", "main"], 60_000);
  const known = (await git(root, ["rev-parse", "-q", "--verify", "refs/remotes/origin/main"])).ok;
  if (fetch.ok && known) return { ref: "origin/main" };
  const why = fetch.ok ? "origin has no main" : reason(fetch.stderr);
  return known ? { ref: "origin/main", fetchFailed: why } : { ref: "main", fetchFailed: why };
}

/** What the card's branch squashed onto the base gives. */
export type SquashResult =
  | { kind: "tree"; tree: string; base: string }
  | { kind: "same"; base: string }
  | { kind: "conflict"; files: string[] };

/**
 * The card's branch merged onto the base as a tree, with `git merge-tree --write-tree`: nothing in any working folder
 * changes, and a conflict is found before anything does. `same` means the branch adds nothing to the base.
 */
export async function squashTree(root: string, baseRef: string, branch: string): Promise<SquashResult> {
  const base = await git(root, ["rev-parse", `${baseRef}^{commit}`]);
  if (!base.ok) throw new Error(reason(base.stderr));
  const baseCommit = base.stdout.trim();
  const merged = await git(root, ["merge-tree", "--write-tree", "--name-only", baseCommit, branch]);
  if (merged.code === 1) {
    // The tree, then the conflicted files, then a blank line and git's messages.
    const lines = merged.stdout.split("\n");
    const end = lines.indexOf("", 1);
    const files = lines.slice(1, end === -1 ? undefined : end).filter(Boolean);
    return { kind: "conflict", files: [...new Set(files)] };
  }
  if (!merged.ok) throw new Error(reason(merged.stderr));
  const tree = merged.stdout.split("\n")[0]!.trim();
  const baseTree = (await git(root, ["rev-parse", `${baseCommit}^{tree}`])).stdout.trim();
  return tree === baseTree ? { kind: "same", base: baseCommit } : { kind: "tree", tree, base: baseCommit };
}

/** The one commit: the tree on top of the base, with the message. `commit-tree` runs no hooks. */
export async function commitTree(root: string, tree: string, parent: string, message: string): Promise<string> {
  const r = await git(root, ["commit-tree", tree, "-p", parent, "-m", message]);
  if (!r.ok) throw new Error(reason(r.stderr));
  return r.stdout.trim();
}

/** The changed files between the base and the tree, for the commit message session. */
export async function diffStat(root: string, base: string, tree: string): Promise<string> {
  return (await git(root, ["diff", "--stat", base, tree])).stdout.trim();
}

/** The last commit messages on the base, for the repo's style. */
export async function recentMessages(root: string, baseRef: string, count = 15): Promise<string[]> {
  const r = await git(root, ["log", `-${count}`, "--format=%B%x00", baseRef]);
  return r.stdout.split("\0").map((m) => m.trim()).filter(Boolean);
}

export type PushResult = { kind: "pushed" } | { kind: "moved" } | { kind: "failed"; reason: string };

/**
 * `git push origin <commit>:refs/heads/main`, never forced. `moved` is a refusal because main moved on; anything else
 * (offline, auth, a protected branch, your pre-push hook, which runs) is `failed` with git's reason.
 */
export async function pushMain(root: string, commit: string): Promise<PushResult> {
  const r = await git(root, ["push", "origin", `${commit}:refs/heads/main`], 120_000);
  if (r.ok) return { kind: "pushed" };
  if (/non-fast-forward|fetch first|\[rejected\].*\(fetch first\)|stale info/i.test(r.stderr)) return { kind: "moved" };
  return { kind: "failed", reason: reason(r.stderr) };
}

/** Commits on local main that origin/main lacks; 0 without an origin. */
export async function unpushedCount(root: string): Promise<number> {
  if (!(await hasOrigin(root))) return 0;
  const r = await git(root, ["rev-list", "--count", "origin/main..main"]);
  return r.ok ? Number(r.stdout.trim()) || 0 : 0;
}

/** Where main is checked out (a checkout or worktree folder), and whether it has uncommitted tracked changes. */
export async function mainCheckout(root: string): Promise<{ path: string; dirty: boolean } | null> {
  const list = await git(root, ["worktree", "list", "--porcelain"]);
  let path: string | null = null;
  for (const block of list.stdout.split("\n\n")) {
    const lines = block.split("\n");
    if (lines.includes("branch refs/heads/main")) {
      path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length) ?? null;
      break;
    }
  }
  if (!path) return null;
  const status = await git(path, ["status", "--porcelain", "--untracked-files=no"]);
  return { path, dirty: status.stdout.trim() !== "" };
}

/** Whether a commit is already on the base ref (`merge-base --is-ancestor`). */
export async function isOn(root: string, commit: string, ref: string): Promise<boolean> {
  return (await git(root, ["merge-base", "--is-ancestor", commit, ref])).ok;
}

/**
 * Moves your local main forward to the commit, only as a fast-forward: by compare-and-swap when main isn't checked
 * out anywhere, or with `git merge --ff-only` in a clean checkout. Returns "updated", or why not.
 */
export async function moveLocalMain(root: string, commit: string): Promise<string> {
  const current = (await git(root, ["rev-parse", "refs/heads/main"])).stdout.trim();
  if (current === commit) return "updated";
  if (current && !(await isOn(root, current, commit))) {
    return "it has commits that aren't in the landed one, so it can't be moved forward";
  }
  const where = await mainCheckout(root);
  if (!where) {
    const r = await git(root, ["update-ref", "refs/heads/main", commit, current]);
    return r.ok ? "updated" : reason(r.stderr);
  }
  if (where.dirty) return "it has main checked out with uncommitted changes";
  const r = await git(where.path, ["merge", "--ff-only", "-q", commit]);
  return r.ok ? "updated" : reason(r.stderr);
}

/** Uncommitted work in a worktree: tracked changes and untracked files that aren't git-ignored. */
export async function worktreeStatus(worktree: string): Promise<string[]> {
  const r = await git(worktree, ["status", "--porcelain"]);
  return r.stdout.split("\n").filter(Boolean);
}

/**
 * Discard Them and land: staged changes unstaged first (so a staged new file is untracked and goes too), tracked
 * changes reverted, untracked files removed; git-ignored files such as .env stay.
 */
export async function discardChanges(worktree: string): Promise<void> {
  for (const args of [["reset", "-q"], ["checkout", "--", "."], ["clean", "-fdq"]]) {
    const r = await git(worktree, args);
    if (!r.ok) throw new Error(reason(r.stderr));
  }
}

/** Switch the worktree to a commit (detached) or back to its branch. */
export async function switchWorktree(worktree: string, target: { commit: string } | { branch: string }): Promise<void> {
  const args = "commit" in target ? ["checkout", "-q", "--detach", target.commit] : ["checkout", "-q", target.branch];
  const r = await git(worktree, args);
  if (!r.ok) throw new Error(reason(r.stderr));
}

/** After landing: the card's worktree and branch go. */
export async function removeCardWorktree(root: string, worktree: string, branch: string): Promise<void> {
  const remove = await git(root, ["worktree", "remove", "--force", worktree]);
  if (!remove.ok) throw new Error(reason(remove.stderr));
  const del = await git(root, ["branch", "-D", branch]);
  if (!del.ok) throw new Error(reason(del.stderr));
}
