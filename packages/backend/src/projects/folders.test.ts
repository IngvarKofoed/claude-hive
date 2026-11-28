import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as gitService from "../git";
import { classifyFolder, completeFolders } from "./folders";

const dirs: string[] = [];
function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "hive-folders-")));
  dirs.push(d);
  return d;
}
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", ...args], { cwd, encoding: "utf8" });
}
function makeRepo(): string {
  const root = tmp();
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "a.txt"), "a\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "init");
  return root;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("completeFolders", () => {
  function home(): string {
    const h = tmp();
    for (const d of ["dir10", "dir2", "Projects", "alpha", ".config", ".ssh"]) mkdirSync(join(h, d));
    writeFileSync(join(h, "notes.txt"), "x");
    writeFileSync(join(h, ".zshrc"), "x");
    return h;
  }

  it("lists only folders under ~/, sorted ignoring case with numbers in natural order", async () => {
    const h = home();
    const answer = await completeFolders("~/", h);
    expect(answer.folders.map((f) => f.name)).toEqual(["alpha", "dir2", "dir10", "Projects"]);
    expect(answer.more).toBe(0);
  });

  it("lists dot-folders only once a dot is typed", async () => {
    const h = home();
    expect((await completeFolders("~/.", h)).folders.map((f) => f.name)).toEqual([".config", ".ssh"]);
  });

  it("reads ~ alone as ~/, and every value keeps the typed prefix and ends in /", async () => {
    const h = home();
    const tilde = await completeFolders("~", h);
    expect(tilde).toEqual(await completeFolders("~/", h));
    expect(tilde.folders[0]).toEqual({ name: "alpha", value: "~/alpha/" });
    const abs = await completeFolders(`${h}/al`, h);
    expect(abs.folders).toEqual([{ name: "alpha", value: `${h}/alpha/` }]);
  });

  it("matches ignoring case and writes the real name", async () => {
    const h = home();
    expect((await completeFolders("~/pro", h)).folders).toEqual([{ name: "Projects", value: "~/Projects/" }]);
  });

  it("lists a symlink to a folder, and not a symlink to a file", async () => {
    const h = home();
    symlinkSync(join(h, "alpha"), join(h, "linkdir"));
    symlinkSync(join(h, "notes.txt"), join(h, "linkfile"));
    symlinkSync(join(h, "gone"), join(h, "linkbroken"));
    expect((await completeFolders("~/link", h)).folders.map((f) => f.name)).toEqual(["linkdir"]);
  });

  it("answers the first 50 and counts the rest in more", async () => {
    const h = tmp();
    for (let i = 0; i < 60; i++) mkdirSync(join(h, `f${i}`));
    const answer = await completeFolders("~/", h);
    expect(answer.folders).toHaveLength(50);
    expect(answer.folders[0]?.name).toBe("f0");
    expect(answer.folders[49]?.name).toBe("f49");
    expect(answer.more).toBe(10);
  });

  it("answers an empty list for a missing folder, a relative path, ~user and an empty string", async () => {
    const h = home();
    const none = { folders: [], more: 0 };
    expect(await completeFolders("~/nope/", h)).toEqual(none);
    expect(await completeFolders("relative/path", h)).toEqual(none);
    expect(await completeFolders("~root/", h)).toEqual(none);
    expect(await completeFolders("", h)).toEqual(none);
    expect(await completeFolders(`${h}/notes.txt/`, h)).toEqual(none);
  });
});

describe("classifyFolder", () => {
  const classify = (path: string, home = "/nowhere") => classifyFolder(path, home, gitService);

  it("calls a relative path relative", async () => {
    expect(await classify("some/folder")).toEqual({ kind: "relative" });
    expect(await classify("")).toEqual({ kind: "relative" });
    expect(await classify("~root/x")).toEqual({ kind: "relative" });
  });

  it("calls a file a file", async () => {
    const d = tmp();
    writeFileSync(join(d, "f.txt"), "x");
    expect(await classify(join(d, "f.txt"))).toEqual({ kind: "file", path: join(d, "f.txt") });
  });

  it("calls a repo's top a repo-top, resolving ~, . and a trailing /, and empty only with no commits and no files", async () => {
    const root = makeRepo();
    expect(await classify(`${root}/.`)).toEqual({ kind: "repo-top", path: root, empty: false });
    mkdirSync(join(root, "sub"));
    expect(await classify(`${root}/sub/../`)).toEqual({ kind: "repo-top", path: root, empty: false });

    const fresh = tmp();
    git(fresh, "init", "-q", "-b", "main");
    writeFileSync(join(fresh, ".DS_Store"), "x");
    expect(await classify("~/", fresh)).toEqual({ kind: "repo-top", path: fresh, empty: true });
    writeFileSync(join(fresh, "README.md"), "x");
    expect(await classify(fresh)).toEqual({ kind: "repo-top", path: fresh, empty: false });
  });

  it("calls a subfolder of a repo inside-repo, naming the top", async () => {
    const root = makeRepo();
    mkdirSync(join(root, "sub/deep"), { recursive: true });
    expect(await classify(join(root, "sub/deep"))).toEqual({ kind: "inside-repo", path: join(root, "sub/deep"), repo: root });
  });

  it("calls a .claude/worktrees/<x> worktree, and a folder inside it, a worktree naming the main checkout", async () => {
    const root = makeRepo();
    const wt = join(root, ".claude/worktrees/x");
    git(root, "worktree", "add", "-q", wt, "-b", "hive/x", "main");
    mkdirSync(join(wt, "inner"));
    expect(await classify(wt)).toEqual({ kind: "worktree", path: wt, repo: root, addable: true });
    expect(await classify(join(wt, "inner"))).toEqual({ kind: "worktree", path: join(wt, "inner"), repo: root, addable: true });
  });

  it("calls a worktree of a --separate-git-dir repo a worktree of the git dir, which can't be added", async () => {
    const d = tmp();
    git(d, "init", "-q", "-b", "main", "--separate-git-dir", join(d, "gitdir"), join(d, "checkout"));
    git(join(d, "checkout"), "commit", "-q", "--allow-empty", "-m", "init");
    git(join(d, "checkout"), "worktree", "add", "-q", join(d, "wt"), "-b", "other");
    expect(await classify(join(d, "wt"))).toEqual({ kind: "worktree", path: join(d, "wt"), repo: join(d, "gitdir"), addable: false });
  });

  it("calls <repo>/.git/refs and a bare repo git-data", async () => {
    const root = makeRepo();
    expect(await classify(join(root, ".git/refs"))).toEqual({ kind: "git-data", path: join(root, ".git/refs") });
    const bare = tmp();
    git(bare, "init", "-q", "--bare");
    expect(await classify(bare)).toEqual({ kind: "git-data", path: bare });
  });

  it("calls a folder with only .DS_Store empty, and one with a file has-files", async () => {
    const d = tmp();
    expect(await classify(d)).toEqual({ kind: "empty", path: d });
    writeFileSync(join(d, ".DS_Store"), "x");
    expect(await classify(d)).toEqual({ kind: "empty", path: d });
    writeFileSync(join(d, "a.txt"), "x");
    expect(await classify(d)).toEqual({ kind: "has-files", path: d });
  });

  it("calls a missing path missing, with its nearest parent's real path plus the rest, and classifies that parent", async () => {
    const d = tmp();
    const viaLink = join(tmp(), "link");
    symlinkSync(d, viaLink);
    expect(await classify(join(viaLink, "a/b"))).toEqual({
      kind: "missing", missing: join(d, "a/b"), parent: { kind: "empty", path: d },
    });
    const root = makeRepo();
    expect(await classify(join(root, "new"))).toEqual({
      kind: "missing", missing: join(root, "new"), parent: { kind: "repo-top", path: root, empty: false },
    });
  });
});
