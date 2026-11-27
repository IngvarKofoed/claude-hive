// Test doubles: the session runner and trust probe as fakes (tests never call the real Claude API), plus
// throwaway git repos in a temp folder (tests never touch a real project repo).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  RunningTurn, SessionRunner, TrustProbe, TurnHandlers, TurnOutcome, TurnRequest,
} from "./sessions/types";

export class FakeTurn implements RunningTurn {
  pushed: string[] = [];
  interrupted = false;
  /** Set to make push() report that the input has already ended. */
  inputEnded = false;
  private finish!: (outcome: TurnOutcome) => void;
  readonly done = new Promise<TurnOutcome>((resolve) => (this.finish = resolve));

  constructor(readonly request: TurnRequest, readonly handlers: TurnHandlers) {}

  push(text: string): boolean {
    if (this.inputEnded) return false;
    this.pushed.push(text);
    return true;
  }

  async interrupt(): Promise<void> {
    this.interrupted = true;
    this.finish({ kind: "ok", interrupted: true });
  }

  /** End the turn; resolves once the hive has handled the outcome. */
  async end(outcome: TurnOutcome = { kind: "ok" }): Promise<void> {
    this.finish(outcome);
    await this.done;
    await settle();
  }
}

/** A setup report that sets nothing up, for the fake runner's default setup turns. */
export const EMPTY_SETUP_REPORT = {
  status: "done", blockedReason: null, installed: "Nothing to install.", start: [], test: "", shared: [], notes: "",
};

export class FakeRunner implements SessionRunner {
  turns: FakeTurn[] = [];
  /**
   * The worktree setup's turns, kept apart so a test about other lanes never meets one as `last`. Unless
   * `holdSetup` is set, each one ends at once with EMPTY_SETUP_REPORT.
   */
  setupTurns: FakeTurn[] = [];
  holdSetup = false;

  start(request: TurnRequest, handlers: TurnHandlers): RunningTurn {
    const turn = new FakeTurn(request, handlers);
    if (request.role.name === "setup") {
      this.setupTurns.push(turn);
      if (!this.holdSetup) setTimeout(() => void turn.end({ kind: "ok", report: EMPTY_SETUP_REPORT }), 0);
      return turn;
    }
    this.turns.push(turn);
    return turn;
  }

  get last(): FakeTurn {
    const turn = this.turns.at(-1);
    if (!turn) throw new Error("No turn has started");
    return turn;
  }
}

export class FakeProbe implements TrustProbe {
  calls: string[] = [];
  constructor(public loads = true) {}
  async loadsProjectClaudeMd(root: string): Promise<boolean> {
    this.calls.push(root);
    return this.loads;
  }
}

/** Let promise callbacks run. */
export const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Wait until `condition` holds, for work that runs real git processes in the background (Build's start and end). */
export async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

export interface TempRepo {
  root: string;
  git: (...args: string[]) => string;
  cleanup(): void;
}

/** A throwaway repo with one commit on `branch` (default main). */
export function makeRepo(options: { branch?: string; claudeMd?: boolean } = {}): TempRepo {
  const base = mkdtempSync(join(tmpdir(), "hive-test-"));
  const root = join(base, "repo");
  execFileSync("mkdir", ["-p", root]);
  git(root, "init", "-q", "-b", options.branch ?? "main");
  // A local identity, so the hive's own commits (sign-off) work without the machine's global git config.
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.com");
  writeFileSync(join(root, "app.txt"), "hello\n");
  if (options.claudeMd) writeFileSync(join(root, "CLAUDE.md"), "# Test project\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return { root, git: (...args) => git(root, ...args), cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

/** A throwaway spec-format folder with a format.md and a review.md. */
export function makeSpecFormat(): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), "hive-spec-format-"));
  writeFileSync(join(dir, "format.md"), "# What a spec contains\nWrite a spec.\n");
  writeFileSync(join(dir, "review.md"), "# The fresh-eyes review\n## For the reviewer\nReview it.\n");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
