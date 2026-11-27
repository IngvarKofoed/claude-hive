// Each card's own block of ports, and stopping what still listens on them when the card leaves Build, Check or Try it
// (docs/specs/2026-11-27-worktree-setup-and-try-it.md). The preview service will grow here.
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { sep } from "node:path";
import { promisify } from "node:util";
import { CARD_PORTS } from "@hive/shared";

const run = promisify(execFile);

/** The range card port blocks come from: 80 blocks of 10. */
export const PORT_RANGE = { first: 5200, last: 5999 } as const;

/** A process the hive stopped, and the port it was listening on. */
export interface StoppedListener {
  port: number;
  pid: number;
}

/** The ports a card may use and stopping what's left on them; behind an interface so tests don't run lsof. */
export interface PortService {
  /** The first port of a free block of CARD_PORTS: not taken by another card, and nothing listening on any of it. */
  assign(taken: number[]): Promise<number | null>;
  /**
   * Stops what listens on these ports from inside the worktree: SIGTERM, then SIGKILL after `graceMs`. A process
   * whose working folder is elsewhere (another program that took the port later, your own copy) is left alone.
   */
  stopListeners(ports: number[], worktree: string, graceMs?: number): Promise<StoppedListener[]>;
}

/** The card's ports, from the first one. */
export const cardPorts = (first: number) => Array.from({ length: CARD_PORTS }, (_, i) => first + i);

/** The ids of the processes listening on a TCP port. */
export async function listeners(port: number): Promise<number[]> {
  try {
    const { stdout } = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
    return stdout.split("\n").map(Number).filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return []; // lsof exits 1 when nothing matches
  }
}

/** A process's working folder, or null if it can't be read (it ended, or belongs to another user). */
async function workingFolder(pid: number): Promise<string | null> {
  try {
    const { stdout } = await run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
    const line = stdout.split("\n").find((l) => l.startsWith("n"));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const lsofPorts: PortService = {
  async assign(taken) {
    const used = new Set(taken);
    for (let first = PORT_RANGE.first; first + CARD_PORTS - 1 <= PORT_RANGE.last; first += CARD_PORTS) {
      if (used.has(first)) continue;
      const busy = await Promise.all(cardPorts(first).map(listeners));
      if (busy.every((pids) => pids.length === 0)) return first;
    }
    return null;
  },

  async stopListeners(ports, worktree, graceMs = 5000) {
    const inside = await realpath(worktree).catch(() => worktree);
    const found: StoppedListener[] = [];
    for (const port of ports) {
      for (const pid of await listeners(port)) {
        if (pid === process.pid || found.some((f) => f.pid === pid)) continue;
        const cwd = await workingFolder(pid);
        if (!cwd) continue;
        const real = await realpath(cwd).catch(() => cwd);
        if (real === inside || real.startsWith(inside + sep)) found.push({ port, pid });
      }
    }
    for (const { pid } of found) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // it ended already
      }
    }
    const deadline = Date.now() + graceMs;
    while (found.some(({ pid }) => alive(pid)) && Date.now() < deadline) await pause(100);
    for (const { pid } of found) {
      if (!alive(pid)) continue;
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // it ended between the check and the kill
      }
    }
    return found;
  },
};

/** For tests: hands out blocks without looking at the machine, and stops nothing. */
export function fakePorts(): PortService & { stopped: { ports: number[]; worktree: string }[] } {
  const stopped: { ports: number[]; worktree: string }[] = [];
  return {
    stopped,
    async assign(taken) {
      for (let first = PORT_RANGE.first; first + CARD_PORTS - 1 <= PORT_RANGE.last; first += CARD_PORTS) {
        if (!taken.includes(first)) return first;
      }
      return null;
    },
    async stopListeners(ports, worktree) {
      stopped.push({ ports, worktree });
      return [];
    },
  };
}
