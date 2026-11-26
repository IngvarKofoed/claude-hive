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
}

/** The ten lanes, in board order (docs/CONCEPT.md, The Board). */
export const LANES: readonly LaneInfo[] = [
  { id: "ideas", name: "Ideas", who: "you", limit: null, withYou: true },
  { id: "refine", name: "Refine", who: "you ⇄ product owner", limit: 3, withYou: true },
  { id: "mockup", name: "Mockup", who: "you ⇄ designer", limit: 2, withYou: true },
  { id: "spec", name: "Spec", who: "spec writer, then you", limit: 2, withYou: true },
  { id: "plan", name: "Plan", who: "planner", limit: 2, withYou: false },
  { id: "build", name: "Build", who: "developer", limit: 2, withYou: false },
  { id: "check", name: "Check", who: "reviewer, tester", limit: 2, withYou: false },
  { id: "tryit", name: "Try it", who: "you", limit: 2, withYou: true },
  { id: "ship", name: "Ship", who: "the hive", limit: 1, withYou: false },
  { id: "done", name: "Done", who: "", limit: null, withYou: false },
];

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

export type ChatItem =
  | { kind: "message"; id: string; at: string; from: "you" | "product-owner"; text: string }
  | { kind: "error"; id: string; at: string; message: string; retryable: boolean };

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
  | { type: "pending.updated"; cardId: string; pending: PendingItem | null }
  | { type: "turn.started"; cardId: string }
  | { type: "turn.ended"; cardId: string };
