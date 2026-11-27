import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readlink, realpath, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, sep } from "node:path";

const run = promisify(execFile);

// Your checkout's git-ignored local files, listed for the setup session and copied into a card's worktree by the
// hive's own code (docs/specs/2026-11-27-worktree-setup-and-try-it.md, Key decisions: the hive lists and copies).

/** A git-ignored entry in your checkout. `path` is relative to the checkout; a folder's ends with "/". */
export interface LocalEntry {
  path: string;
  bytes: number;
}

export interface LocalFileList {
  /** What the setup session chooses from, with sizes. */
  candidates: LocalEntry[];
  /** What code left out as junk: dependencies, build output, caches, logs, OS and editor junk, .claude/. */
  junk: string[];
}

/** One requested path's result: how many files it copied, or why it was refused. */
export interface CopyOutcome {
  path: string;
  result: "copied" | "kept" | "refused";
  /** Files copied (0 for `kept` and `refused`). */
  files: number;
  reason?: string;
}

const JUNK_NAMES = new Set([
  // dependencies
  "node_modules", ".venv", "venv", "bower_components", ".bundle", "Pods",
  // build output
  "bin", "obj", "dist", "build", "out", "target", ".next", ".nuxt", ".svelte-kit", ".angular", ".expo", ".dart_tool",
  "dev-dist", "DerivedData",
  // caches
  ".cache", ".parcel-cache", ".turbo", ".gradle", ".pytest_cache", ".ruff_cache", ".mypy_cache", ".tox", ".nox",
  "__pycache__", ".eslintcache", "coverage", "htmlcov", ".terraform",
  // test output
  "test-results", "playwright-report",
  // logs
  "logs",
  // OS and editor junk
  ".DS_Store", "Thumbs.db", ".idea", ".vscode", "xcuserdata",
  // the hive's own and tool folders
  ".claude", ".playwright-mcp",
]);
const JUNK_SUFFIXES = [".log", ".tsbuildinfo", ".pyc", ".egg-info"];

function isJunk(entry: string): boolean {
  return entry
    .split("/")
    .filter(Boolean)
    .some((seg) => JUNK_NAMES.has(seg) || JUNK_SUFFIXES.some((s) => seg.endsWith(s)));
}

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

async function git(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return { ok: false, stdout: e.stdout ?? "", stderr: (e.stderr || e.message).trim() };
  }
}

/** Total bytes of a file, or of everything under a folder. Uses lstat and never follows symlinks. */
async function sizeOf(path: string): Promise<number> {
  let st;
  try {
    st = await lstat(path);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const name of await readdir(path)) total += await sizeOf(join(path, name));
  return total;
}

/**
 * Whether a folder holds a junk folder somewhere below it, such as `node_modules`. Junk files (`.DS_Store`, logs)
 * don't count: they're small, and opening a folder up for them spreads it into hundreds of entries.
 */
async function hasJunkInside(abs: string): Promise<boolean> {
  let names: string[];
  try {
    if (!(await lstat(abs)).isDirectory()) return false;
    names = await readdir(abs);
  } catch {
    return false;
  }
  for (const name of names) {
    let isDir = false;
    try {
      isDir = (await lstat(join(abs, name))).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    if (isJunk(name) || (await hasJunkInside(join(abs, name)))) return true;
  }
  return false;
}

/**
 * Git can list a folder and, separately, entries inside it. Keeps each entry once, and drops any entry inside a
 * folder that's already a candidate, since copying the folder copies it too.
 */
export function withoutOverlap(paths: string[]): string[] {
  const unique = [...new Set(paths)].sort();
  const folders = unique.filter((p) => p.endsWith("/"));
  return unique.filter((p) => !folders.some((f) => f !== p && p.startsWith(f)));
}

/**
 * Git collapses a fully ignored folder to one line, so `packages/` can hold only `packages/x/node_modules/`. A
 * folder with junk inside is opened up, so the junk is named and the rest stays a candidate.
 */
async function classify(root: string, entry: string, junk: string[], kept: string[]): Promise<void> {
  if (isJunk(entry)) return void junk.push(entry);
  if (!entry.endsWith("/") || !(await hasJunkInside(join(root, entry)))) return void kept.push(entry);
  for (const name of await readdir(join(root, entry))) {
    const child = entry + name;
    let isDir = false;
    try {
      isDir = (await lstat(join(root, child))).isDirectory();
    } catch {
      /* gone */
    }
    await classify(root, isDir ? child + "/" : child, junk, kept);
  }
}

/** Lists your checkout's git-ignored entries, junk left out, with their sizes. */
export async function listLocalFiles(root: string): Promise<LocalFileList> {
  const r = await git(root, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]);
  if (!r.ok) throw new Error(r.stderr || "git ls-files failed");
  const junk: string[] = [];
  const kept: string[] = [];
  for (const entry of r.stdout.split("\0").filter(Boolean)) await classify(root, entry, junk, kept);
  const candidates = await Promise.all(
    withoutOverlap(kept).map(async (path) => ({ path, bytes: await sizeOf(join(root, path)) })),
  );
  return { candidates, junk: [...new Set(junk)].sort() };
}

const refused = (path: string, reason: string): CopyOutcome => ({ path, result: "refused", files: 0, reason });

/** Copies src to dst without overwriting, recursively. Returns how many files were copied. */
async function copyEntry(src: string, dst: string): Promise<number> {
  const st = await lstat(src);
  if (st.isDirectory()) {
    let made = false;
    try {
      if (!(await lstat(dst)).isDirectory()) return 0; // something else is there: keep it
    } catch {
      await mkdir(dst, { recursive: true, mode: st.mode & 0o7777 });
      made = true;
    }
    let n = 0;
    for (const name of await readdir(src)) n += await copyEntry(join(src, name), join(dst, name));
    return made && n === 0 ? 0 : n;
  }
  try {
    await lstat(dst);
    return 0; // already there
  } catch {
    /* absent: copy */
  }
  await mkdir(dirname(dst), { recursive: true });
  try {
    if (st.isSymbolicLink()) await symlink(await readlink(src), dst);
    else await copyFile(src, dst, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return 0;
    throw err;
  }
  return 1;
}

/** Copies git-ignored paths from your checkout into the worktree, under the guards. Never changes the checkout. */
export async function copyLocalFiles(root: string, worktree: string, paths: string[]): Promise<CopyOutcome[]> {
  let realRoot: string;
  let realWorktree: string;
  try {
    realRoot = await realpath(root);
    realWorktree = await realpath(worktree);
  } catch {
    return paths.map((p) => refused(p, "the checkout or worktree is missing"));
  }
  if (!realWorktree.startsWith(realRoot + sep)) {
    return paths.map((p) => refused(p, "the worktree is not inside the checkout"));
  }
  const out: CopyOutcome[] = [];
  for (const path of paths) {
    try {
      out.push(await copyOne(root, realRoot, worktree, path));
    } catch (err) {
      out.push(refused(path, `copy failed: ${(err as Error).message}`));
    }
  }
  return out;
}

async function copyOne(root: string, realRoot: string, worktree: string, path: string): Promise<CopyOutcome> {
  if (!path || isAbsolute(path)) return refused(path, "not a relative path");
  const clean = path.replace(/\/+$/, "");
  const segs = clean.split("/");
  if (segs.includes("..")) return refused(path, "contains ..");
  if (segs[0] === ".git") return refused(path, "inside .git");
  if (segs[0] === ".claude" && segs[1] === "worktrees") return refused(path, "inside .claude/worktrees");
  const src = join(root, clean);
  try {
    await lstat(src);
  } catch {
    return refused(path, "not in your checkout");
  }
  // A symlinked parent folder must not lead out of the checkout.
  const realParent = await realpath(dirname(src));
  if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
    return refused(path, "leads outside your checkout");
  }
  // A folder holding the worktree itself (`.claude/`, which holds every card's worktree) would copy into itself.
  const realSrc = await realpath(src);
  const realWorktree = await realpath(worktree);
  if (realWorktree === realSrc || realWorktree.startsWith(realSrc + sep)) {
    return refused(path, "it holds the worktree itself");
  }
  const tracked = await git(worktree, ["ls-files", "--error-unmatch", "--", clean]);
  if (tracked.ok) return refused(path, "tracked by git");
  const ignored = await git(root, ["check-ignore", "-q", "--", clean]);
  if (!ignored.ok) return refused(path, "not git-ignored");
  const files = await copyEntry(src, join(worktree, clean));
  return files > 0 ? { path, result: "copied", files } : { path, result: "kept", files: 0 };
}
