import {
  appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeRepo, type TempRepo } from "../testing.js";
import { copyLocalFiles, createCardWorktree, ensureWorktreesExcluded, listLocalFiles, withoutOverlap } from "./index.js";

let repo: TempRepo;
let wt: string;
const at = (...p: string[]) => join(repo.root, ...p);
const put = (rel: string, content: string) => {
  mkdirSync(join(at(rel), ".."), { recursive: true });
  writeFileSync(at(rel), content);
};

function snapshot(dir: string, rel = ""): string[] {
  // Everything in the checkout outside the worktrees folder and .git, with sizes and mtimes.
  const out: string[] = [];
  for (const name of sortedNames(join(dir, rel))) {
    const r = rel ? `${rel}/${name}` : name;
    if (r === ".git" || r === ".claude") continue;
    const st = lstatSync(join(dir, r));
    out.push(`${r}:${st.size}:${st.mtimeMs}`);
    if (st.isDirectory()) out.push(...snapshot(dir, r));
  }
  return out;
}
const sortedNames = (p: string) => readdirSync(p).sort();

beforeEach(async () => {
  repo = makeRepo();
  put(".gitignore", ".env\ndata/\n*.db\n*.db-wal\nnode_modules/\n.DS_Store\n.claude/settings.local.json\n*.log\n");
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "ignore");
  await ensureWorktreesExcluded(repo.root);
  wt = (await createCardWorktree(repo.root, "c-111111")).worktreePath;
});
afterEach(() => repo.cleanup());

describe("listLocalFiles", () => {
  it("splits junk from candidates and sizes them", async () => {
    put(".env", "SECRET=1\n");
    put("data/a.bin", "12345");
    put("data/sub/b.bin", "123");
    put("app.db", "db");
    put("app.db-wal", "wal!");
    put(".DS_Store", "x");
    put(".claude/settings.local.json", "{}");
    put("debug.log", "log");
    put("packages/x/node_modules/pkg/index.js", "js");
    put("node_modules/y/i.js", "js");
    const list = await listLocalFiles(repo.root);
    expect(list.candidates).toEqual([
      { path: ".env", bytes: 9 },
      { path: "app.db", bytes: 2 },
      { path: "app.db-wal", bytes: 4 },
      { path: "data/", bytes: 8 },
    ]);
    expect(list.junk).toEqual(
      expect.arrayContaining([".DS_Store", ".claude/settings.local.json", "debug.log", "node_modules/"]),
    );
    expect(list.junk.some((j) => j.includes("packages/x/node_modules"))).toBe(true);
  });

  it("keeps a folder whole when only junk files, such as .DS_Store, are inside it", async () => {
    put("data/.DS_Store", "x");
    put("data/a.bin", "12345");
    const list = await listLocalFiles(repo.root);
    expect(list.candidates.map((c) => c.path)).toEqual(["data/"]);
  });

  it("lists each entry once, and nothing inside a listed folder", () => {
    expect(withoutOverlap(["assets/", "assets/a.json", "assets/public/", "assets/", "b.env", "b.env"]))
      .toEqual(["assets/", "b.env"]);
  });

    it("changes nothing", async () => {
    put(".env", "a");
    const before = snapshot(repo.root);
    await listLocalFiles(repo.root);
    expect(snapshot(repo.root)).toEqual(before);
  });
});

describe("copyLocalFiles", () => {
  it("copies a file and a folder, then reports kept", async () => {
    put(".env", "SECRET=1\n");
    put("data/a.bin", "aaa");
    put("data/sub/b.bin", "bbb");
    const before = snapshot(repo.root);
    const first = await copyLocalFiles(repo.root, wt, [".env", "data/"]);
    expect(first).toEqual([
      { path: ".env", result: "copied", files: 1 },
      { path: "data/", result: "copied", files: 2 },
    ]);
    expect(readFileSync(join(wt, ".env"), "utf8")).toBe("SECRET=1\n");
    expect(readFileSync(join(wt, "data/sub/b.bin"), "utf8")).toBe("bbb");
    const second = await copyLocalFiles(repo.root, wt, [".env", "data"]);
    expect(second.map((o) => o.result)).toEqual(["kept", "kept"]);
    expect(snapshot(repo.root)).toEqual(before);
  });

  it("adds only new files to an already-copied folder and never overwrites", async () => {
    put("data/a.bin", "old");
    await copyLocalFiles(repo.root, wt, ["data"]);
    put("data/a.bin", "changed in checkout");
    put("data/new.bin", "new");
    const r = await copyLocalFiles(repo.root, wt, ["data"]);
    expect(r).toEqual([{ path: "data", result: "copied", files: 1 }]);
    expect(readFileSync(join(wt, "data/a.bin"), "utf8")).toBe("old");
    expect(readFileSync(join(wt, "data/new.bin"), "utf8")).toBe("new");
  });

  it("keeps the file mode", async () => {
    put("run.db", "x");
    chmodSync(at("run.db"), 0o755);
    await copyLocalFiles(repo.root, wt, ["run.db"]);
    expect(statSync(join(wt, "run.db")).mode & 0o777).toBe(0o755);
  });

  it("copies a symlink as a link", async () => {
    mkdirSync(at("data"));
    put("data/real.bin", "r");
    symlinkSync("real.bin", at("data/link.bin"));
    const r = await copyLocalFiles(repo.root, wt, ["data"]);
    expect(r[0]).toMatchObject({ result: "copied", files: 2 });
    expect(lstatSync(join(wt, "data/link.bin")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(wt, "data/link.bin"))).toBe("real.bin");
  });

  it("refuses what it must", async () => {
    put("untracked.txt", "u");
    const out = await copyLocalFiles(repo.root, wt, [
      "app.txt", // tracked
      "untracked.txt", // not ignored
      "../x",
      "/etc/hosts",
      ".git/config",
      ".claude/worktrees/c-111111",
      "missing.db",
    ]);
    expect(out.every((o) => o.result === "refused" && o.files === 0 && o.reason)).toBe(true);
    expect(out[0]?.reason).toMatch(/tracked/);
    expect(out[1]?.reason).toMatch(/ignored/);
    expect(out[6]?.reason).toMatch(/not in your checkout/);
    expect(existsSync(join(wt, "untracked.txt"))).toBe(false);
  });

  it("refuses a folder that holds the worktree itself, even when it's git-ignored", async () => {
    appendFileSync(at(".gitignore"), ".claude/\n");
    const out = await copyLocalFiles(repo.root, wt, [".claude", ".claude/"]);
    expect(out.map((o) => o.result)).toEqual(["refused", "refused"]);
    expect(out[0]?.reason).toMatch(/holds the worktree/);
    expect(existsSync(join(wt, ".claude"))).toBe(false);
  });

  it("refuses everything when the worktree is outside the checkout", async () => {
    put(".env", "x");
    const other = makeRepo();
    try {
      const out = await copyLocalFiles(repo.root, other.root, [".env"]);
      expect(out[0]).toMatchObject({ result: "refused" });
      expect(existsSync(join(other.root, ".env"))).toBe(false);
    } finally {
      other.cleanup();
    }
  });
});
