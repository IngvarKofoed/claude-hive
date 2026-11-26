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
    this.finish({ kind: "ok" });
  }

  /** End the turn; resolves once the hive has handled the outcome. */
  async end(outcome: TurnOutcome = { kind: "ok" }): Promise<void> {
    this.finish(outcome);
    await this.done;
    await settle();
  }
}

export class FakeRunner implements SessionRunner {
  turns: FakeTurn[] = [];

  start(request: TurnRequest, handlers: TurnHandlers): RunningTurn {
    const turn = new FakeTurn(request, handlers);
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
  writeFileSync(join(root, "app.txt"), "hello\n");
  if (options.claudeMd) writeFileSync(join(root, "CLAUDE.md"), "# Test project\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return { root, git: (...args) => git(root, ...args), cleanup: () => rmSync(base, { recursive: true, force: true }) };
}
