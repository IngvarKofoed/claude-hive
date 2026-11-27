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
  { id: "build", name: "Build", who: "developer", limit: 2, withYou: false, implemented: true },
  { id: "check", name: "Check", who: "reviewer, tester", limit: 2, withYou: false, implemented: true },
  { id: "tryit", name: "Try it", who: "you", limit: 2, withYou: true, implemented: true },
  { id: "ship", name: "Ship", who: "the hive", limit: 1, withYou: false, implemented: true },
  { id: "done", name: "Done", who: "", limit: null, withYou: false, implemented: true },
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

// ---------- The build ----------

/** Where the developer departed from the plan, and why. */
export interface Departure {
  step: string;
  what: string;
  why: string;
}

/** A file changed on the card's branch against main. Null line counts mean a binary file. */
export interface FileChange {
  path: string;
  added: number | null;
  removed: number | null;
}

/**
 * The developer's `done` report, as the board keeps it on the card (docs/specs/2026-11-26-build-lane-developer.md).
 * `files` is the whole branch against main, filled in once the hive's checkpoint is committed.
 */
export interface BuildReport {
  summary: string;
  departures: Departure[];
  files: FileChange[];
}

/** A mismatch between spec and code, found while building. Judged later by the spec keeper. */
export interface SpecIssue {
  id: string;
  /** The lane the issue was found in. */
  foundIn: Lane;
  /** The spec's section. */
  where: string;
  problem: string;
  /** What was done instead. */
  guess: string;
}

/** A decision made without you, listed so you can ask for it the other way in Try it. */
export interface Decision {
  id: string;
  lane: Lane;
  what: string;
  alternative: string;
  /** Who decided, e.g. "developer". */
  source: string;
}

// ---------- Check ----------

/** A bug Check's reviewer found: code that doesn't do what the spec clearly says, or is broken. */
export interface Bug {
  /** Where in the code, as `file:line`. */
  where: string;
  problem: string;
}

/**
 * The last finished Check round, as the board keeps it on the card (docs/specs/2026-11-27-check-lane-reviewer.md).
 * Bugs fail the round; no bugs moves the card on to Try it.
 */
export interface CheckRound {
  /** 1 for the first round since the last plan. */
  round: number;
  summary: string;
  bugs: Bug[];
}

// ---------- Worktree setup ----------

/** One process of the card's app, as setup worked it out: a server the hive runs for Try it on the card's ports. */
export interface StartCommand {
  /** What it starts, e.g. "backend" or "the app". */
  what: string;
  /** Run with `sh -c` in `dir`. */
  command: string;
  /** The folder to run it in, relative to the worktree; "." for the root. Missing in setups made before it existed. */
  dir?: string;
  /** The one port of the card's block it listens on. Missing in setups made before it existed: read from `url`. */
  port?: number;
  /** The address to open, if it serves one. */
  url: string | null;
}

/** One process of the card's app as the hive runs it in Try it (docs/specs/2026-11-27-try-it-runs-the-app.md). */
export interface AppProcess {
  what: string;
  port: number | null;
  url: string | null;
  state: "starting" | "running" | "stopped";
  /** Why it stopped, or why it couldn't start. */
  reason: string | null;
  /** The last lines of its output, stdout and stderr together. */
  output: string[];
}

/**
 * The card's worktree setup (docs/specs/2026-11-27-worktree-setup-and-try-it.md): the local files copied from your
 * checkout, the dependencies installed, and how to run the app and its tests on the card's own ports.
 */
export interface SetupReport {
  status: "running" | "done" | "failed";
  /** Why a failed setup didn't finish. */
  reason: string | null;
  /** The local files and folders the hive copied into the worktree. */
  copied: string[];
  /** The git-ignored entries that weren't copied: junk the code left out, and what the session didn't pick. */
  leftOut: string[];
  /** What was run to install dependencies. */
  installed: string;
  start: StartCommand[];
  /** How to run the tests. */
  test: string;
  /** What the worktree still shares with your checkout, e.g. a server database. */
  shared: string[];
  notes: string;
}

/** How many ports each card gets, starting at `CardDetail.port`. */
export const CARD_PORTS = 10;

// ---------- Ship ----------

/** The one commit a card landed as (docs/specs/2026-11-27-ship-lane.md). */
export interface Landed {
  commit: string;
  subject: string;
  /** What it landed on: "origin/main", or "main" in a project without a remote. */
  base: string;
  /** Pushed to origin. */
  remote: boolean;
  /** "updated", or why your checkout's main wasn't brought up to date. */
  checkout: string;
}

/** What Land on main would do now, for the Ship page (GET /api/cards/:id/ship). */
export interface ShipPlan {
  base: "origin/main" | "main";
  /** Uncommitted work in the card's worktree, as `git status --porcelain` lines. Blocks Land on main. */
  uncommitted: string[];
  /** Commits on your local main that origin/main lacks. Blocks Land on main. */
  unpushed: number;
  /** The test command that will run on the squash, or null. */
  tests: string | null;
  /** Why no tests will run, when `tests` is null. */
  noTestsReason: string | null;
  /** Without a remote: your checkout has main checked out with uncommitted changes, so main can't move yet. */
  checkoutBlocks: boolean;
  /** Another card of the project is landing. */
  busy: boolean;
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
export type ChatAuthor = "you" | "product-owner" | "spec-writer" | "planner" | "developer" | "reviewer" | "hive";

/**
 * What an error line offers: retry the failed turn, run the review again, send a blocked plan or build back to Spec,
 * or, for a card that Check stopped, send it back to Build for one more round or move it on to Try it.
 */
export type ErrorAction = "retry" | "review" | "back-to-spec" | "back-to-build" | "move-on";

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
  /** The developer's last `done` report, once it has built. */
  build: BuildReport | null;
  /** Check's last finished round since the last plan, once one has finished. */
  check: CheckRound | null;
  /** The worktree's setup, once one has started. */
  setup: SetupReport | null;
  /** The first of the card's CARD_PORTS ports, once it has them. */
  port: number | null;
  /** Your Try it feedback, while the developer works on it. */
  feedback: string | null;
  /** The card's app as the hive runs it in Try it; empty elsewhere. */
  apps: AppProcess[];
  /** You stopped the app: a hive restart or a finished setup leaves it stopped. */
  appStopped: boolean;
  /** Where the card landed, once it has. */
  landed: Landed | null;
  /** Land on main is running for this card. */
  landing: boolean;
  /** Spec issues found so far, waiting for the spec keeper. */
  issues: SpecIssue[];
  /** Decisions made without you. */
  decisions: Decision[];
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

/** Land on main (POST /api/cards/:id/land). `discard` throws away the worktree's uncommitted work first. */
export interface LandBody {
  discard?: boolean;
}

/** Try it feedback (POST /api/cards/:id/feedback). Only `build` is accepted as the lane for now. */
export interface FeedbackBody {
  text: string;
  lane?: Lane;
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
  /** A Check round finished: the round as stored, and the card's spec issues with the ones it added. */
  | { type: "check.updated"; cardId: string; check: CheckRound; issues: SpecIssue[] }
  | { type: "setup.updated"; cardId: string; setup: SetupReport; port: number | null }
  | { type: "app.updated"; cardId: string; apps: AppProcess[]; appStopped: boolean }
  | { type: "pending.updated"; cardId: string; pending: PendingItem | null }
  | { type: "turn.started"; cardId: string }
  | { type: "turn.ended"; cardId: string };
