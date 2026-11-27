// The app runner on real throwaway servers (docs/specs/2026-11-27-try-it-runs-the-app.md, The runner).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { processApps, runToEnd, type AppEntry, type AppRunner } from "./apps";
import { waitFor } from "../testing";

const listening = (port: number) =>
  execFileSync("sh", ["-c", `lsof -nP -iTCP:${port} -sTCP:LISTEN -t || true`], { encoding: "utf8" }).trim() !== "";

/** A node server on a port, behind `sh -c` like the setup's commands, so stopping must take the whole group. */
const server = (port: number, extra = ""): AppEntry => ({
  what: `server on ${port}`,
  command: `echo starting ${port}; ${extra} exec "${process.execPath}" -e 'require("net").createServer().listen(${port}, "127.0.0.1", () => console.log("up"))'`,
  dir: "app",
  port,
  url: `http://127.0.0.1:${port}`,
});

describe("the app runner", () => {
  let worktree: string;
  let runner: AppRunner;
  afterEach(async () => {
    await runner.clear("card");
    rmSync(worktree, { recursive: true, force: true });
  });
  const make = (options: { readyMs?: number } = {}) => {
    worktree = mkdtempSync(join(tmpdir(), "hive-apps-"));
    mkdirSync(join(worktree, "app"));
    writeFileSync(join(worktree, "app", "marker"), "");
    runner = processApps({ graceMs: 1000, ...options });
  };

  it("starts each process in its folder, shows it running once its port listens, and stops the whole group", async () => {
    make();
    const changes: string[] = [];
    runner.start("card", [server(5971)], worktree, (kind) => changes.push(kind));
    expect(runner.status("card")[0]!.state).toBe("starting");
    await waitFor(() => runner.status("card")[0]!.state === "running");
    expect(listening(5971)).toBe(true);
    await waitFor(() => runner.status("card")[0]!.output.includes("up"));
    expect(runner.status("card")[0]!.output[0]).toBe("starting 5971");
    expect(runner.livePorts("card")).toEqual([5971]);

    await runner.stop("card");
    expect(runner.status("card")[0]).toMatchObject({ state: "stopped", reason: "Stopped." });
    expect(listening(5971)).toBe(false);
    expect(changes).toContain("state");
  }, 20000);

  it("strips terminal colour codes from the output", async () => {
    make();
    runner.start("card", [{ what: "colour", command: "printf '\\033[36mblue\\033[39m done\\n'; exit 0", dir: ".", port: 5976, url: null }], worktree, () => {});
    await waitFor(() => runner.status("card")[0]!.state === "stopped");
    expect(runner.status("card")[0]!.output).toEqual(["blue done"]);
  });

  it("shows a process that exits by itself as stopped, with its exit and output", async () => {
    make();
    runner.start("card", [{ what: "broken", command: "echo boom; exit 3", dir: ".", port: 5972, url: null }], worktree, () => {});
    await waitFor(() => runner.status("card")[0]!.state === "stopped");
    expect(runner.status("card")[0]).toMatchObject({ reason: "Stopped (exit 3).", output: ["boom"] });
  });

  it("stops a process that never listens, once its time is up", async () => {
    make({ readyMs: 600 });
    runner.start("card", [{ what: "silent", command: "sleep 30", dir: ".", port: 5973, url: null }], worktree, () => {});
    await waitFor(() => runner.status("card")[0]!.state === "stopped", 8000);
    expect(runner.status("card")[0]!.reason).toMatch(/^Didn't come up in/);
  }, 15000);

  it("doesn't start a refused entry, and starts only what isn't running", async () => {
    make();
    const refused: AppEntry = { ...server(5974), what: "outside", refused: "Its port 80 is outside the card's ports." };
    runner.start("card", [server(5975), refused], worktree, () => {});
    await waitFor(() => runner.status("card")[0]!.state === "running");
    expect(runner.status("card")[1]).toMatchObject({ state: "stopped", reason: "Its port 80 is outside the card's ports." });
    const output = runner.status("card")[0]!.output;
    runner.start("card", [server(5975)], worktree, () => {});
    expect(runner.status("card")[0]).toMatchObject({ state: "running", output });
  }, 20000);

  it("runs a command to its end, and kills one past its time limit", async () => {
    make();
    expect(await runToEnd("echo ok; echo done", worktree, 5000)).toEqual({ ok: true, reason: null, output: ["ok", "done"] });
    expect(await runToEnd("echo bad; exit 2", worktree, 5000)).toMatchObject({ ok: false, reason: "It exited with 2.", output: ["bad"] });
    const slow = await runToEnd("echo start; sleep 30", worktree, 300);
    expect(slow).toMatchObject({ ok: false, reason: expect.stringMatching(/^It ran longer than/) });
  }, 15000);
});
