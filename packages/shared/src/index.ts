// Types the backend and frontend both use: API bodies, event-stream messages and the brief.
// A change here lands in backend and frontend in the same change (packages/shared/CLAUDE.md).

export { APP_VERSION } from "./version";
export * from "./laneActions";
import type { ErrorAction, LaneActionState } from "./laneActions";

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
  /** Lanes where you're in the conversation; the rest run hands off. */
  withYou: boolean;
}

/** The ten lanes, in board order (docs/CONCEPT.md, The Board). */
export const LANES: readonly LaneInfo[] = [
  { id: "ideas", name: "Ideas", who: "you", withYou: true },
  { id: "refine", name: "Refine", who: "you ⇄ product owner", withYou: true },
  { id: "mockup", name: "Mockup", who: "you ⇄ designer", withYou: true },
  { id: "spec", name: "Spec", who: "spec writer, then you", withYou: true },
  { id: "plan", name: "Plan", who: "planner", withYou: false },
  { id: "build", name: "Build", who: "developer", withYou: false },
  { id: "check", name: "Check", who: "reviewer, tester", withYou: false },
  { id: "tryit", name: "Try it", who: "you", withYou: true },
  { id: "ship", name: "Ship", who: "the hive", withYou: false },
  { id: "done", name: "Done", who: "", withYou: false },
];

/**
 * The lanes before `current` in board order: the ones a card has finished, as far as the hive can tell. There are no
 * lane-visit records, so order is the only signal (docs/specs/2026-11-27-card-lane-artifacts.md).
 */
export function lanesBefore(current: Lane): Lane[] {
  const index = LANES.findIndex((l) => l.id === current);
  return LANES.slice(0, Math.max(index, 0)).map((l) => l.id);
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

// ---------- The mockup ----------

/** What the designer last named with set_mockup (docs/specs/2026-11-28-mockup-lane-and-designer-role.md). */
export type MockupRef =
  /** The page to open, relative to the worktree: "docs/mockups/<card>/index.html". */
  | { kind: "pages"; page: string }
  /** A Claude Design mockup, or any https page you pasted. */
  | { kind: "link"; url: string };

/** The card's mockup, once it has entered Mockup. */
export interface MockupInfo {
  /** "docs/mockups/<card>", relative to the worktree. */
  folder: string;
  /** What the designer last named with set_mockup. */
  current: MockupRef | null;
  /** Your choice at Good; null while the card is in Mockup. */
  kept: boolean | null;
  /** The folder's files, relative to it, read now; [] once the folder or worktree is gone. */
  files: string[];
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

export type ChecklistStatus = "pending" | "in_progress" | "completed";

/**
 * One item of the developer's own task list, as its session keeps it through `TodoWrite` or `TaskCreate` /
 * `TaskUpdate` (docs/specs/2026-11-28-build-lane-checklist.md). `id` is the task's id from `TaskCreate`; `TodoWrite`
 * items have none.
 */
export interface ChecklistItem {
  id: string | null;
  text: string;
  status: ChecklistStatus;
}

/**
 * The spec keeper's verdict on an issue (docs/specs/2026-11-28-spec-keeper.md, The batch): the spec changes, the code
 * changes, or neither.
 */
export type IssueVerdict = "spec-wrong" | "code-wrong" | "no-change";

/** How far an issue reaches: the keeper settles it, it changes what you signed off, or it stops the card. */
export type IssueLevel = "minor" | "changes-signoff" | "severe";

/** The spec keeper's judgment of one issue. */
export interface IssueJudgment {
  verdict: IssueVerdict;
  level: IssueLevel;
  reason: string;
  /** For `changes-signoff` and `severe`: what the keeper would do. Empty for `minor`. */
  recommendation: string;
  /** The earlier issue on this card that this one repeats, if any. */
  repeats: string | null;
}

/**
 * Where an issue stands:
 * - `open`: no verdict yet; waiting for the spec keeper, or "Not judged" on a card moved on past a failed keeper turn;
 * - `spec-fixed`: the keeper changed the spec;
 * - `no-change`: neither the spec nor the code changes;
 * - `sent`: sent to the developer as a code fix, not yet verified by a passing Check round; `fixed` once it is;
 * - `judged`: judged in a batch that stopped on a severe issue, and not acted on yet;
 * - `severe`: the severe issue that stopped the card;
 * - `waiting`: waits for your answer;
 * - `held`: you answered Change the code (or in your own words); it goes to Build when you press Send to Build;
 * - `kept`: you answered Keep it as built (or Change the spec, for a blocked build); the spec changes to match;
 * - `settled`: closed by Back to Spec.
 */
export type IssueStatus =
  | "open" | "spec-fixed" | "no-change" | "sent" | "fixed" | "judged" | "severe" | "waiting" | "held" | "kept" | "settled";

/** Your answer to a spec keeper question about an issue. */
export interface IssueAnswer {
  /** `keep`: Keep it as built, or Change the spec; `change`: Change the code, or Keep the spec. */
  choice: "keep" | "change";
  /** Your own words, when you answered in them. */
  words: string | null;
}

/** A mismatch between spec and code, found while building or checking, and judged by the spec keeper. */
export interface SpecIssue {
  id: string;
  /** The lane the issue was found in. */
  foundIn: Lane;
  /** The spec's section. */
  where: string;
  problem: string;
  /** What was done instead. */
  guess: string;
  status: IssueStatus;
  /** The spec keeper's judgment, once it has judged the issue. */
  judgment: IssueJudgment | null;
  /** Your answer, once you've given one. */
  answer: IssueAnswer | null;
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

// ---------- History ----------

/** A spec issue as a role reported it, before the hive gave it an id. */
export interface ReportedIssue {
  where: string;
  problem: string;
  /** What was done instead. */
  guess: string;
}

/** A decision made without you, as a role reported it. */
export interface ReportedDecision {
  what: string;
  alternative: string;
}

/** One Build round: the developer's `done` report as it came in. The files changed aren't part of it. */
export interface BuildRound {
  summary: string;
  departures: Departure[];
  issues: ReportedIssue[];
  decisions: ReportedDecision[];
}

/** One finished Check round, with the spec issues the reviewer reported in it. `round` is the chat's number. */
export interface CheckRecord extends CheckRound {
  issues: ReportedIssue[];
}

/** One of Try it's rounds: a piece of your feedback, or your acceptance. */
export type TryItRound = { kind: "feedback"; text: string } | { kind: "accepted" };

/**
 * What the later lanes produced, newest round first, from the card's event rows
 * (docs/specs/2026-11-27-later-lane-artifacts.md).
 */
export interface CardHistory {
  plans: Plan[];
  builds: BuildRound[];
  checks: CheckRecord[];
  /** Your feedback, newest first, below one `accepted` when the card's last Try it row is an acceptance. */
  tryit: TryItRound[];
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

// ---------- For you ----------

/**
 * What a card waiting for you wants (docs/specs/2026-11-27-for-you.md, What each entry says). `question` and
 * `permission` are answered on the list; every other kind opens the card. `waiting` is the fallback that shouldn't
 * happen: a card that waits with nothing to say why.
 */
export type ForYouKind =
  | "question" | "permission" | "stuck" | "your-turn" | "sign-off" | "review-again" | "try-it" | "land" | "waiting";

/** One card waiting for you, as the For you page lists it. */
export interface ForYouItem {
  card: CardSummary;
  projectName: string;
  /** When the card started waiting for you (ISO time). */
  since: string;
  kind: ForYouKind;
  /** What the card wants, in one line. */
  text: string;
  /** The open question or permission, answered on the list. Null for every other kind. */
  pending: PendingItem | null;
  /**
   * The lane actions the entry offers as buttons (docs/specs/2026-11-28-for-you-actions.md, What For you offers):
   * none for a question or permission, or for a card in Try it. Land on main is always enabled here, since it only
   * opens the confirm row, which reads the Ship plan.
   */
  actions: LaneActionState[];
}

/** GET /api/for-you: every card waiting for you, the one waiting longest first. */
export interface ForYouResponse {
  items: ForYouItem[];
}

// ---------- Role prompts ----------

/** A JSON schema, as a report's `outputFormat` or a hive tool's inputs. The page reads only a few keywords of it. */
export type JsonSchema = Record<string, unknown>;

/** One of the hive's own tools a role's sessions are offered (docs/specs/2026-11-27-role-prompts-page.md). */
export interface RoleTool {
  name: string;
  description: string;
  input: JsonSchema;
}

/**
 * One role as the Role prompts page shows it (docs/specs/2026-11-27-role-prompts-page.md). An errored entry has lane,
 * model and kind null, instructions "", extras [], report null, tools [] and taskTools false; a planned one is the same,
 * except that it has its lane.
 */
export interface RoleInfo {
  /** "developer": the file name without `.md`, and the name the hive loads it by. */
  name: string;
  /** From the front matter; null when missing or not a known lane. */
  lane: Lane | null;
  /** "opus" */
  model: string | null;
  /** "conversation", "work" or "one-off" */
  kind: string | null;
  /** The text after the front matter. */
  instructions: string;
  /** Full paths of the files appended after the instructions, e.g. the spec format's `format.md`. */
  extras: string[];
  /** The fixed-format report each turn must end with. */
  report: JsonSchema | null;
  /** The hive's own tools the role's sessions are offered. */
  tools: RoleTool[];
  /** Claude Code's task-list tools are switched on for its sessions (docs/specs/2026-11-28-build-lane-checklist.md). */
  taskTools: boolean;
  /** Set when the file can't be read as a role. */
  error?: string;
  /** No file yet: listed from the hive's short list of roles still to be written. */
  planned?: true;
}

/** GET /api/roles: every role, lanes in board order. */
export interface RolesResponse {
  roles: RoleInfo[];
}

// ---------- Card detail ----------

/** Who wrote a chat line. `hive` is the hive's own note, e.g. "The review found two fixes and one decision". */
export type ChatAuthor =
  | "you" | "product-owner" | "designer" | "spec-writer" | "spec-keeper" | "planner" | "developer" | "reviewer" | "hive";

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
  | {
      id: string;
      kind: "question";
      questions: Question[];
      /**
       * Set on the spec keeper's questions: the issue each question asks about, in the same order. The hive routes the
       * answers itself; no session reads them (docs/specs/2026-11-28-spec-keeper.md, Your answer in Try it).
       */
      issueIds?: string[];
    }
  | { id: string; kind: "permission"; toolName: string; detail: string };

export interface CardDetail extends CardSummary {
  projectName: string;
  /** The idea's title as you typed it. `title` starts as this, and the brief's title replaces it in Refine. */
  ideaTitle: string;
  ideaText: string;
  branch: string | null;
  worktreePath: string | null;
  brief: Brief | null;
  /** The card's mockup; null when the card never entered Mockup. */
  mockup: MockupInfo | null;
  /** The spec, once the card has entered Spec, while its worktree is there to read it from. */
  spec: SpecInfo | null;
  /** Where the spec is, relative to the repo, even once it can't be read: a landed card's worktree is gone. */
  specPath: string | null;
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
  /** Your Try it feedback, or Ship's reason for sending the card back, while the developer works on it. */
  feedback: string | null;
  /** Ship sent the card back to Build, so `feedback` is Ship's reason and the card returns to Ship after Check. */
  shipAfterCheck: boolean;
  /** The developer session's own task list, live in Build; null until it starts one. */
  checklist: ChecklistItem[] | null;
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
  /** The chat of every lane before the current one that has any, for looking back. Live events never touch it. */
  pastChats: Partial<Record<Lane, ChatItem[]>>;
  /** What the later lanes produced, round by round. Live events never touch it; a lane change reloads it. */
  history: CardHistory;
  pending: PendingItem | null;
  turnRunning: boolean;
}

// ---------- API bodies ----------

export interface AddProjectBody {
  path: string;
}

/** A new idea: both fields are trimmed and required (docs/specs/2026-11-27-card-lane-artifacts.md). */
export interface NewCardBody {
  projectId: string;
  title: string;
  text: string;
}

/** An idea's edit, allowed only while the card is in Ideas and not moving. Both fields trimmed and required. */
export interface UpdateIdeaBody {
  title: string;
  text: string;
}

export interface MoveBody {
  lane: Lane;
}

/**
 * Good (POST /api/cards/:id/good). `skipMockup` is read in Refine: true goes straight to Spec. `keep` is required in
 * Mockup: true commits the mockup's folder on the card's branch.
 */
export interface GoodBody {
  skipMockup?: boolean;
  keep?: boolean;
}

/** What deleting a card left behind (DELETE /api/cards/:id): a line for each git step that failed, with git's reason. */
export interface DeleteResult {
  left: string[];
}

/** Land on main (POST /api/cards/:id/land). `discard` throws away the worktree's uncommitted work first. */
export interface LandBody {
  discard?: boolean;
}

/** Try it feedback (POST /api/cards/:id/feedback). Only `build` is accepted as the lane for now. */
export interface FeedbackBody {
  /** May be empty when Change the code answers are held: Send to Build then carries only those. */
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
  /** The designer named a mockup, you chose to keep it or not, or its pages were deleted at sign-off. */
  | { type: "mockup.updated"; cardId: string; mockup: MockupInfo }
  | { type: "spec.updated"; cardId: string; spec: SpecInfo }
  | { type: "plan.updated"; cardId: string; plan: Plan }
  /** The developer changed its task list: the whole list as the card now holds it. */
  | { type: "checklist.updated"; cardId: string; checklist: ChecklistItem[] }
  /** A Check round finished: the round as stored, and the card's spec issues with the ones it added. */
  | { type: "check.updated"; cardId: string; check: CheckRound; issues: SpecIssue[] }
  /** The spec keeper judged issues, or your answers changed them, while the card stays in its lane. */
  | { type: "issues.updated"; cardId: string; issues: SpecIssue[] }
  | { type: "setup.updated"; cardId: string; setup: SetupReport; port: number | null }
  | { type: "app.updated"; cardId: string; apps: AppProcess[]; appStopped: boolean }
  | { type: "pending.updated"; cardId: string; pending: PendingItem | null }
  /** The card was deleted: everything about it is gone (docs/specs/2026-11-27-delete-a-card.md). */
  | { type: "card.deleted"; cardId: string }
  | { type: "turn.started"; cardId: string }
  | { type: "turn.ended"; cardId: string };
