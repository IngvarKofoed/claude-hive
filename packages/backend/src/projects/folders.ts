// Folders for adding a project (docs/specs/2026-11-28-folder-autocomplete-and-git-init-when-ad.md): the folder names
// that complete a typed path, and what a typed path is, so Hive.addProject can say yes, ask, or refuse.
import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { FolderCompletion, FolderCompletions } from "@hive/shared";
import type { RepoAt } from "../git";

/** How many folders a completion lists; `more` counts the rest. */
export const COMPLETION_LIMIT = 50;

const NONE: FolderCompletions = { folders: [], more: 0 };

/**
 * `~` alone is `<home>/` and `~/x` is `<home>/x`. Null for anything that still isn't an absolute path: `~user`, an
 * empty string, or a relative path.
 */
export function expandHome(typed: string, home: string): string | null {
  if (typed === "~") return `${home}/`;
  if (typed.startsWith("~/")) return home + typed.slice(1);
  if (!typed || typed.startsWith("~") || !isAbsolute(typed)) return null;
  return typed;
}

/** The folders in the folder being typed in whose names start with what's typed after the last `/`. */
export async function completeFolders(typed: string, home: string): Promise<FolderCompletions> {
  const text = typed === "~" ? "~/" : typed;
  const cut = text.lastIndexOf("/");
  if (cut < 0) return NONE;
  const prefix = text.slice(0, cut + 1);
  const start = text.slice(cut + 1).toLowerCase();
  const dir = expandHome(prefix, home);
  if (!dir) return NONE;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return NONE; // missing or unreadable: an empty list, never an error
  }
  const names: string[] = [];
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith(".") && !start.startsWith(".")) continue;
    if (!name.toLowerCase().startsWith(start)) continue;
    if (entry.isDirectory() || (entry.isSymbolicLink() && (await isFolder(join(dir, name))))) names.push(name);
  }
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  const folders: FolderCompletion[] = names.slice(0, COMPLETION_LIMIT).map((name) => ({ name, value: `${prefix}${name}/` }));
  return { folders, more: Math.max(0, names.length - COMPLETION_LIMIT) };
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** What a typed path is. Every path in it is real, except `missing`'s tail, which is as typed. */
export type FolderClass =
  | { kind: "relative" }
  | { kind: "file"; path: string }
  /**
   * A linked worktree's top folder or a folder inside one; `repo` is the main checkout, or, when `addable` is false,
   * the bare repo or common git dir git names in its place (a bare, `--separate-git-dir` or submodule repo).
   */
  | { kind: "worktree"; path: string; repo: string; addable: boolean }
  /** A folder inside a repo's work tree that isn't its top; `repo` is the main checkout. */
  | { kind: "inside-repo"; path: string; repo: string }
  /** Inside a `.git` folder or a bare repo. */
  | { kind: "git-data"; path: string }
  /** A repo's top folder; `empty` when it has no commits and holds nothing but `.git` and `.DS_Store`. */
  | { kind: "repo-top"; path: string; empty: boolean }
  /** Not in a repo, holding nothing but `.DS_Store`. */
  | { kind: "empty"; path: string }
  | { kind: "has-files"; path: string }
  /** Doesn't exist: its nearest existing parent's real path plus the rest as typed, and what that parent is. */
  | { kind: "missing"; missing: string; parent: FolderClass };

/** Classify a typed path for adding it as a project. `~` means `home`. */
export async function classifyFolder(
  path: string,
  home: string,
  git: { repoAt(dir: string): Promise<RepoAt | null> },
): Promise<FolderClass> {
  const expanded = expandHome(path.trim(), home);
  if (!expanded) return { kind: "relative" };
  const target = resolve(expanded);
  let existing = target;
  while (!(await exists(existing))) {
    const up = dirname(existing);
    if (up === existing) break; // "/" always exists; this only guards the loop
    existing = up;
  }
  if (existing !== target) {
    const parent = await classifyExisting(existing, git);
    return { kind: "missing", missing: join(await realpath(existing), relative(existing, target)), parent };
  }
  return classifyExisting(target, git);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function classifyExisting(path: string, git: { repoAt(dir: string): Promise<RepoAt | null> }): Promise<FolderClass> {
  const real = await realpath(path);
  if (!(await stat(real)).isDirectory()) return { kind: "file", path: real };
  const repo = await git.repoAt(real);
  if (!repo) return (await holdsOnly(real, [".DS_Store"])) ? { kind: "empty", path: real } : { kind: "has-files", path: real };
  if (repo.insideGitDir) return { kind: "git-data", path: real };
  if (repo.linked) return { kind: "worktree", path: real, repo: repo.mainCheckout, addable: repo.mainIsWorkTree };
  if (repo.top !== real) return { kind: "inside-repo", path: real, repo: repo.mainCheckout };
  return { kind: "repo-top", path: real, empty: !repo.hasCommits && (await holdsOnly(real, [".git", ".DS_Store"])) };
}

async function holdsOnly(dir: string, allowed: string[]): Promise<boolean> {
  return (await readdir(dir)).every((name) => allowed.includes(name));
}
