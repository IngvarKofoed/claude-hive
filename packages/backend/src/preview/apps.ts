// The card's app as the hive runs it in Try it: the setup's start commands as the hive's own child processes, each in
// its own process group so Stop ends the whole tree (docs/specs/2026-11-27-try-it-runs-the-app.md, The runner).
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { AppProcess } from "@hive/shared";
import { listeners } from "./ports";

/** One process to run, checked by the hive: its folder is inside the worktree and its port is the card's. */
export interface AppEntry {
  what: string;
  command: string;
  /** Relative to the worktree. */
  dir: string;
  port: number | null;
  url: string | null;
  /** Set when the hive refused to start it, e.g. its port is outside the card's block. */
  refused?: string;
}

export interface AppRunner {
  /** Starts the entries that aren't starting or running. Calls `onChange` on every change of state or output. */
  start(cardId: string, entries: AppEntry[], worktree: string, onChange: (kind: "state" | "output") => void): void;
  /** The ports of the entries that are starting or running, which a sweep before a start must leave alone. */
  livePorts(cardId: string): number[];
  /** Stops every process of the card: SIGTERM to each group, SIGKILL after the grace. Keeps their status. */
  stop(cardId: string): Promise<void>;
  /** Stops the card's processes and forgets them, as the card leaves Try it. */
  clear(cardId: string): Promise<void>;
  status(cardId: string): AppProcess[];
  /** As the hive exits: SIGKILL to every group it started, synchronously. */
  killAll(): void;
}

const OUTPUT_LINES = 200;

/** Terminal colour and cursor codes, which a dev server prints even into a pipe, and which the page would show. */
const ANSI = /\u001b\[[0-9;?]*[ -\/]*[@-~]/g;

interface Proc {
  entry: AppEntry;
  child: ChildProcess | null;
  state: AppProcess["state"];
  reason: string | null;
  output: string[];
  stopping: boolean;
  onChange: (kind: "state" | "output") => void;
}

const alive = (child: ChildProcess | null) => !!child && child.exitCode === null && child.signalCode === null;

/** The real runner. `readyMs` is how long a process may take to listen on its port. */
export function processApps(options: { readyMs?: number; graceMs?: number } = {}): AppRunner {
  const readyMs = options.readyMs ?? 2 * 60_000;
  const graceMs = options.graceMs ?? 5000;
  const cards = new Map<string, Proc[]>();

  const killGroup = (child: ChildProcess, signal: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, signal);
    } catch {
      // the group is gone already
    }
  };

  function launch(proc: Proc, worktree: string) {
    const { entry } = proc;
    proc.state = "starting";
    proc.reason = null;
    proc.output = [];
    proc.stopping = false;
    let child: ChildProcess;
    try {
      child = spawn("sh", ["-c", entry.command], {
        cwd: join(worktree, entry.dir), detached: true, stdio: ["ignore", "pipe", "pipe"], env: process.env,
      });
    } catch (error) {
      proc.state = "stopped";
      proc.reason = `Couldn't start: ${(error as Error).message}`;
      proc.onChange("state");
      return;
    }
    proc.child = child;
    let partial = "";
    const take = (chunk: Buffer) => {
      const lines = (partial + chunk.toString()).replace(ANSI, "").split(/\r?\n/);
      partial = lines.pop() ?? "";
      proc.output.push(...lines);
      if (proc.output.length > OUTPUT_LINES) proc.output.splice(0, proc.output.length - OUTPUT_LINES);
      proc.onChange("output");
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    child.on("error", (error) => {
      proc.state = "stopped";
      proc.reason = `Couldn't start: ${error.message}`;
      proc.onChange("state");
    });
    child.on("exit", (code, signal) => {
      if (partial) proc.output.push(partial);
      proc.state = "stopped";
      proc.reason = proc.stopping
        ? proc.reason ?? "Stopped."
        : code !== null ? `Stopped (exit ${code}).` : `Stopped by signal ${signal}.`;
      proc.onChange("state");
    });

    // Running once its own child is alive and something listens on its port.
    const started = Date.now();
    const poll = async () => {
      if (proc.child !== child || !alive(child)) return;
      if (entry.port !== null && (await listeners(entry.port)).length > 0) {
        if (proc.child === child && alive(child)) {
          proc.state = "running";
          proc.onChange("state");
        }
        return;
      }
      if (Date.now() - started > readyMs) {
        proc.stopping = true;
        proc.reason = `Didn't come up in ${Math.round(readyMs / 60_000) || 1} minutes.`;
        killGroup(child, "SIGTERM");
        setTimeout(() => alive(child) && killGroup(child, "SIGKILL"), graceMs).unref?.();
        return;
      }
      setTimeout(() => void poll(), 500).unref?.();
    };
    void poll();
  }

  async function stopProcs(procs: Proc[]) {
    const live = procs.filter((p) => alive(p.child));
    for (const p of live) {
      p.stopping = true;
      p.reason = "Stopped.";
      killGroup(p.child!, "SIGTERM");
    }
    const deadline = Date.now() + graceMs;
    while (live.some((p) => alive(p.child)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    for (const p of live) if (alive(p.child)) killGroup(p.child!, "SIGKILL");
    while (live.some((p) => alive(p.child)) && Date.now() < deadline + 2000) await new Promise((r) => setTimeout(r, 50));
  }

  return {
    start(cardId, entries, worktree, onChange) {
      const procs = cards.get(cardId) ?? [];
      const next: Proc[] = entries.map((entry) => {
        const same = procs.find((p) => p.entry.what === entry.what && p.entry.port === entry.port);
        if (same && (same.state === "starting" || same.state === "running")) return same;
        return { entry, child: null, state: "stopped", reason: null, output: [], stopping: false, onChange };
      });
      cards.set(cardId, next);
      for (const proc of next) {
        if (proc.state !== "stopped") continue;
        if (proc.entry.refused) {
          proc.reason = proc.entry.refused;
          continue;
        }
        launch(proc, worktree);
      }
      onChange("state");
    },
    livePorts(cardId) {
      return (cards.get(cardId) ?? []).filter((p) => alive(p.child) && p.entry.port !== null).map((p) => p.entry.port!);
    },
    async stop(cardId) {
      await stopProcs(cards.get(cardId) ?? []);
    },
    async clear(cardId) {
      await stopProcs(cards.get(cardId) ?? []);
      cards.delete(cardId);
    },
    status(cardId) {
      return (cards.get(cardId) ?? []).map((p) => ({
        what: p.entry.what, port: p.entry.port, url: p.entry.url, state: p.state, reason: p.reason,
        output: p.output.slice(-20),
      }));
    },
    killAll() {
      for (const procs of cards.values()) for (const p of procs) if (alive(p.child)) killGroup(p.child!, "SIGKILL");
    },
  };
}

/** For tests: every entry that isn't refused is running at once; `exit` makes one stop by itself. */
export function fakeApps(): AppRunner & {
  started: { cardId: string; entries: AppEntry[] }[];
  stopped: string[];
  exit(cardId: string, what: string, code: number): void;
} {
  const cards = new Map<string, { procs: AppProcess[]; onChange: (kind: "state" | "output") => void }>();
  const started: { cardId: string; entries: AppEntry[] }[] = [];
  const stopped: string[] = [];
  return {
    started,
    stopped,
    start(cardId, entries, _worktree, onChange) {
      started.push({ cardId, entries });
      const before = cards.get(cardId)?.procs ?? [];
      const procs = entries.map((e): AppProcess => {
        const same = before.find((p) => p.what === e.what && p.port === e.port && p.state !== "stopped");
        if (same) return same;
        return e.refused
          ? { what: e.what, port: e.port, url: e.url, state: "stopped", reason: e.refused, output: [] }
          : { what: e.what, port: e.port, url: e.url, state: "running", reason: null, output: [] };
      });
      cards.set(cardId, { procs, onChange });
      onChange("state");
    },
    livePorts(cardId) {
      return (cards.get(cardId)?.procs ?? []).filter((p) => p.state !== "stopped" && p.port !== null).map((p) => p.port!);
    },
    async stop(cardId) {
      stopped.push(cardId);
      const card = cards.get(cardId);
      for (const p of card?.procs ?? []) if (p.state !== "stopped") Object.assign(p, { state: "stopped", reason: "Stopped." });
      card?.onChange("state");
    },
    async clear(cardId) {
      stopped.push(cardId);
      cards.delete(cardId);
    },
    status(cardId) {
      return (cards.get(cardId)?.procs ?? []).map((p) => ({ ...p, output: p.output.slice(-20) }));
    },
    killAll() {},
    exit(cardId, what, code) {
      const card = cards.get(cardId);
      const p = card?.procs.find((x) => x.what === what);
      if (p) Object.assign(p, { state: "stopped", reason: `Stopped (exit ${code}).` });
      card?.onChange("state");
    },
  };
}

/**
 * Runs a command to its end in a folder, as Ship runs the tests on the squash: whether it passed, why not, and its last
 * lines of output. Past the time limit its whole process group is killed, and that counts as a failure.
 */
export function runToEnd(
  command: string, cwd: string, timeoutMs: number,
): Promise<{ ok: boolean; reason: string | null; output: string[] }> {
  return new Promise((resolve) => {
    const output: string[] = [];
    let partial = "";
    let timedOut = false;
    let child: ChildProcess;
    try {
      child = spawn("sh", ["-c", command], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    } catch (error) {
      resolve({ ok: false, reason: `It couldn't start: ${(error as Error).message}`, output });
      return;
    }
    const take = (chunk: Buffer) => {
      const lines = (partial + chunk.toString()).replace(ANSI, "").split(/\r?\n/);
      partial = lines.pop() ?? "";
      output.push(...lines);
      if (output.length > OUTPUT_LINES) output.splice(0, output.length - OUTPUT_LINES);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // gone already
      }
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: `It couldn't start: ${error.message}`, output });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (partial) output.push(partial);
      if (timedOut) {
        const minutes = Math.round(timeoutMs / 60_000) || 1;
        resolve({ ok: false, reason: `It ran longer than ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`, output });
      } else if (code === 0) resolve({ ok: true, reason: null, output });
      else resolve({ ok: false, reason: code !== null ? `It exited with ${code}.` : `It was stopped by ${signal}.`, output });
    });
  });
}
