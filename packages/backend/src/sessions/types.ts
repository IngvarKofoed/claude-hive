// The session runner sits behind this interface, so tests replace it with a fake that replays scripted SDK
// messages (packages/backend/CLAUDE.md, Testing). Everything SDK-specific lives in sdkRunner.ts.
import type { Brief } from "@hive/shared";

export interface Role {
  name: string;
  model: string;
  kind: string;
  instructions: string;
}

/** What canUseTool returns, in the SDK's own shape. */
export type ToolDecision =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string; interrupt?: boolean };

export interface TurnHandlers {
  /** A piece of the text block being written. */
  onTextDelta(text: string): void;
  /** A finished text block from the session (not from a subagent). */
  onTextBlock(text: string): void;
  /** A passing activity line ("reading src/market.ts…"), or null to clear it. */
  onActivity(text: string | null): void;
  /** The session now exists on disk, so a later turn must `resume` it. */
  onSessionCreated(): void;
  canUseTool(toolName: string, input: Record<string, unknown>, signal: AbortSignal): Promise<ToolDecision>;
}

/** The hive's own tools, offered to the session through the in-process `hive` MCP server. */
export interface HiveTools {
  /** Replace the card's brief. Returns the text the tool hands back to the session. */
  writeBrief(brief: Brief): Promise<string>;
}

export interface TurnRequest {
  sessionId: string;
  /** False on the first turn: pass the hive's `sessionId`. True after: `resume` it. */
  resume: boolean;
  cwd: string;
  role: Role;
  message: string;
  hiveTools: HiveTools;
}

export type TurnOutcome = { kind: "ok" } | { kind: "error"; message: string };

export interface RunningTurn {
  /**
   * A message you send while the turn runs joins it through the input stream. False when the turn's input has
   * already ended (its result is in, the process is exiting): the message didn't join, and needs a turn of its own.
   */
  push(text: string): boolean;
  interrupt(): Promise<void>;
  readonly done: Promise<TurnOutcome>;
}

export interface SessionRunner {
  start(request: TurnRequest, handlers: TurnHandlers): RunningTurn;
}

/** Which CLAUDE.md files a session in `root` loads (spec: the trust probe). */
export interface TrustProbe {
  /** True if at least one memory file inside `root` was loaded. */
  loadsProjectClaudeMd(root: string): Promise<boolean>;
}
