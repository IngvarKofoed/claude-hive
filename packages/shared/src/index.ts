// Types the backend and frontend both use: API bodies, event-stream messages and the brief.
// A change here lands in backend and frontend in the same change (packages/shared/CLAUDE.md).

export { APP_VERSION } from "./version";

// ---------- Lanes ----------

export type Lane =
  | "ideas"
  | "refine"
  | "mockup"
  | "spec"
  | "plan"
  | "build"
  | "check"
  | "tryit"
  | "ship"
  | "done";

export interface LaneInfo {
  id: Lane;
  name: string;
  /** Who works in the lane, as the board's lane header shows it. */
  who: string;
  /** Work-in-progress limit shown in the header. Not enforced in this slice. */
  limit: number | null;
  /** Lanes where you're in the conversation; the rest run hands off. */
  withYou: boolean;
  /**
   * Temporary: false for a lane whose slice isn't built yet. A card there shows "Not implemented yet" instead of a
   * badge. Each lane's slice turns its own flag on, and the flag goes once every lane exists.
   */
  implemented: boolean;
}

/** The ten lanes, in board order (docs/CONCEPT.md, The Board). */
export const LANES: readonly LaneInfo[] = [
  { id: "ideas", name: "Ideas", who: "you", limit: null, withYou: true, implemented: true },
  { id: "refine", name: "Refine", who: "you ⇄ product owner", limit: 3, withYou: true, implemented: true },
  { id: "mockup", name: "Mockup", who: "you ⇄ designer", limit: 2, withYou: true, implemented: false },
  { id: "spec", name: "Spec", who: "spec writer, then you", limit: 2, withYou: true, implemented: true },
  { id: "plan", name: "Plan", who: "planner", limit: 2, withYou: false, implemented: true },
  { id: "build", name: "Build", who: "developer", limit: 2, withYou: false, implemented: false },
  { id: "check", name: "Check", who: "reviewer, tester", limit: 2, withYou: false, implemented: false },
  { id: "tryit", name: "Try it", who: "you", limit: 2, withYou: true, implemented: false },
  { id: "ship", name: "Ship", who: "the hive", limit: 1, withYou: false, implemented: false },
  { id: "done", name: "Done", who: "", limit: null, withYou: false, implemented: false },
];

/** Whether a lane's slice is built yet (temporary, see LaneInfo.implemented). */
export function laneImplemented(lane: Lane): boolean {
  return LANES.find((l) => l.id === lane)?.implemented ?? false;
}

// ---------- The brief ----------

/** The product owner's brief, written through the hive's write_brief tool. */
export interface Brief {
  title: string;
  problem: string;
  whoItsFor: string;
  whatDoneLooksLike: string[];
  outOfScope: string[];
  openPoints: string[];
}

// ---------- The spec and the plan ----------

/**
 * Where the spec stands with the review gate (docs/specs/2026-11-26-spec-lane-review-gate.md):
 * none: no review yet · running: the blind reviewer is reading · applying: the spec writer is applying its findings ·
 * unfinished: the review turn ended without finishing (Retry re-sends the findings) ·
 * fresh: the file is the reviewed text, so Sign off is enabled · stale: the file changed since the review.
 */
export type ReviewState = "none" | "running" | "applying" | "unfinished" | "fresh" | "stale";

export interface SpecInfo {
  /** Relative to the card's worktree, e.g. docs/specs/2026-11-26-printer-font-size.md. */
  path: string;
  /** The file's text as it is on disk; null until the spec writer has written it. */
  text: string | null;
  review: ReviewState;
}

export interface PlanStep {
  title: string;
  detail: string;
  /** The name of the chunk that does this step. */
  chunk: string;
  /** How the step is checked. */
  check: string;
}

export interface PlanChunk {
  name: string;
  /** The files (or globs) this chunk owns. */
  owns: string[];
  model: string;
}

/** The planner's build plan: the part of its report the board keeps on the card. */
export interface Plan {
  steps: PlanStep[];
  chunks: PlanChunk[];
  tests: string[];
}

// ---------- Board ----------

/** working: a turn is running. needs-you: it's your turn, or a question waits. */
export type CardState = "working" | "needs-you";

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  /** The repo has a CLAUDE.md but Claude Code didn't load it: the folder isn't trusted. */
  trustWarning: boolean;
}

export interface CardSummary {
  id: string;
  projectId: string;
  title: string;
  lane: Lane;
  state: CardState;
  /** Why the last move failed (git's reason), shown on the tile. Null once a move succeeds. */
  moveError: string | null;
}

export interface BoardResponse {
  projects: ProjectSummary[];
  cards: CardSummary[];
}

// ---------- Card detail ----------

/** Who wrote a chat line. `hive` is the hive's own note, e.g. "The review found two fixes and one decision". */
export type ChatAuthor = "you" | "product-owner" | "spec-writer" | "planner" | "hive";

/**
 * What an error line offers: retry the failed turn, run the review again, or send a blocked plan back to Spec.
 */
export type ErrorAction = "retry" | "review" | "back-to-spec";

export type ChatItem =
  | { kind: "message"; id: string; at: string; from: ChatAuthor; text: string }
  | { kind: "error"; id: string; at: string; message: string; actions: ErrorAction[] };

export interface QuestionOption {
  label: string;
  description: string;
}

/** One question of an AskUserQuestion call, as the session asked it. */
export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

/** Something waiting for your answer on the card. */
export type PendingItem =
  | { id: string; kind: "question"; questions: Question[] }
  | { id: string; kind: "permission"; toolName: string; detail: string };

export interface CardDetail extends CardSummary {
  projectName: string;
  ideaText: string;
  branch: string | null;
  worktreePath: string | null;
  brief: Brief | null;
  /** The spec, once the card has entered Spec. */
  spec: SpecInfo | null;
  /** The planner's plan, once it has written one. */
  plan: Plan | null;
  /** The chat of the card's current lane. */
  chat: ChatItem[];
  pending: PendingItem | null;
  turnRunning: boolean;
}

// ---------- API bodies ----------

export interface AddProjectBody {
  path: string;
}

export interface NewCardBody {
  projectId: string;
  text: string;
}

export interface MoveBody {
  lane: Lane;
}

export interface MessageBody {
  text: string;
}

/**
 * Answer to a PendingItem (POST /api/for-you/:itemId).
 * question: `answers` maps each question's text to the picked label, comma-separated labels, or your own words.
 * permission: `allow` says whether the action may run.
 */
export type AnswerBody = { answers: Record<string, string> } | { allow: boolean };

export interface ApiError {
  error: string;
}

export interface HealthResponse {
  status: "ok";
  version: string;
}

// ---------- Event stream (GET /api/events) ----------

export type HiveEvent =
  | { type: "project.updated"; project: ProjectSummary }
  | { type: "card.updated"; card: CardSummary }
  /** A piece of the text block being written. */
  | { type: "chat.delta"; cardId: string; text: string }
  /** A finished chat item (a text block, your message, or an error). Replaces any partial text. */
  | { type: "chat.message"; cardId: string; item: ChatItem }
  /** A passing line such as "reading src/market.ts…". Null clears it. Never stored. */
  | { type: "chat.activity"; cardId: string; text: string | null }
  | { type: "brief.updated"; cardId: string; brief: Brief }
  | { type: "spec.updated"; cardId: string; spec: SpecInfo }
  | { type: "plan.updated"; cardId: string; plan: Plan }
  | { type: "pending.updated"; cardId: string; pending: PendingItem | null }
  | { type: "turn.started"; cardId: string }
  | { type: "turn.ended"; cardId: string };
