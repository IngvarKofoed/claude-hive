// Stopping by port and working folder, on real throwaway listeners (docs/specs/2026-11-27-worktree-setup-and-try-it.md).
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cardPorts, fakePorts, lsofPorts, PORT_RANGE } from "./ports";
import { waitFor } from "../testing";

/** A node process listening on a port, started in a folder. */
function listener(port: number, cwd: string): ChildProcess {
  return spawn(process.execPath, ["-e", `require("net").createServer().listen(${port}, "127.0.0.1")`], {
    cwd, stdio: "ignore",
  });
}

/** Whether anything listens on the port, synchronously, for waitFor. */
const listening = (port: number) =>
  execFileSync("sh", ["-c", `lsof -nP -iTCP:${port} -sTCP:LISTEN -t || true`], { encoding: "utf8" }).trim() !== "";

describe("card ports", () => {
  const folders: string[] = [];
  const children: ChildProcess[] = [];
  const folder = () => {
    const f = mkdtempSync(join(tmpdir(), "hive-ports-"));
    folders.push(f);
    return f;
  };
  afterEach(() => {
    for (const c of children) c.kill("SIGKILL");
    for (const f of folders) rmSync(f, { recursive: true, force: true });
    children.length = 0;
    folders.length = 0;
  });

  it("hands out blocks of 10 from the range, skipping taken ones", async () => {
    expect(cardPorts(5210)).toEqual([5210, 5211, 5212, 5213, 5214, 5215, 5216, 5217, 5218, 5219]);
    const ports = fakePorts();
    expect(await ports.assign([])).toBe(PORT_RANGE.first);
    expect(await ports.assign([5200, 5210])).toBe(5220);
  });

  it("stops a listener started inside the worktree, and leaves one started elsewhere alone", async () => {
    const worktree = folder();
    const elsewhere = folder();
    const [inside, outside] = [5987, 5988];
    children.push(listener(inside, worktree), listener(outside, elsewhere));
    await waitFor(() => listening(inside) && listening(outside));

    const stopped = await lsofPorts.stopListeners([inside, outside], worktree, 2000);
    expect(stopped.map((s) => s.port)).toEqual([inside]);
    await waitFor(() => !listening(inside));
    expect(listening(outside)).toBe(true);
  }, 20000);
});
