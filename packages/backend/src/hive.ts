// The hive's orchestration: projects, cards and their moves, and every session's turns, from Ideas through Refine,
// Spec, Plan, Build, Check and Try it, with each card's worktree setup (docs/specs/2026-11-26-board-refine-chat.md,
// docs/specs/2026-11-26-spec-lane-review-gate.md, docs/specs/2026-11-26-build-lane-developer.md,
// docs/specs/2026-11-27-check-lane-reviewer.md, docs/specs/2026-11-27-worktree-setup-and-try-it.md).
// Plain code decides; Claude sessions only do the work (packages/backend/CLAUDE.md, Rules).
import { randomUUID } from "node:crypto";
import {
  appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import type {
  AnswerBody, BoardResponse, Brief, Bug, CardDetail, CardHistory, CardSummary, ChatAuthor, ChatItem, CheckRound, ErrorAction,
  FeedbackBody, FileChange, ForYouItem, ForYouResponse, GoodBody, IssueAnswer, IssueJudgment, IssueStatus, Landed, LandBody, Lane,
  LaneActionInput, LaneErrorAction, MockupInfo, MockupRef, PendingItem, Plan, Question, RoleInfo, RolesResponse, SetupReport,
  ShipPlan, SpecInfo, SpecIssue, TryItRound, UpdateIdeaBody,
} from "@hive/shared";
import { CARD_PORTS, LANES, lanesBefore } from "@hive/shared";
import {
  CHECK_ROUNDS, afterBlocking, canMove, fateOf, laneAfter, laneAfterBuild, laneAfterCheck, laneAfterJudging,
  laneAfterLanding, laneAfterPlan, type IssueFate,
} from "./board/moves";
import { forYouActions, waitsForYou, whatItWants } from "./board/forYou";
import { HiveDb, projectSummary, type CardRow, type KeeperJudging, type MockupState, type SessionRow } from "./db";
import type { EventHub } from "./events";
import { applyChecklistChange } from "./sessions/checklist";
import { describeHiveTool, type HiveToolName } from "./sessions/hiveTools";
import { PLANNED_ROLES, type RoleEntry } from "./sessions/roles";
import type {
  ChecklistChange, HiveTools, Role, RunningTurn, SessionRunner, ToolDecision, TrustProbe, TurnOutcome,
} from "./sessions/types";
import { readSpec, reviewState, SpecWatch, specPathFor } from "./spec";
import {
  CHECK_SCHEMA, COMMIT_SCHEMA, DEVELOPER_SCHEMA, findingsMessage, KEEPER_SCHEMA, parseCheckReport, parseCommitReport,
  parseDeveloperReport, parseKeeperReport, parsePlanReport, parseReviewReport, parseSetupReport, PLAN_SCHEMA,
  REVIEW_SCHEMA, SETUP_SCHEMA,
} from "./spec/reports";
import type { CopyOutcome, LocalFileList, MainBase, MergeResult, PushResult, SquashResult } from "./git";
import { fakeApps, openableUrl, runToEnd, type AppEntry, type AppRunner } from "./preview/apps";
import { cardPorts, fakePorts, type PortService } from "./preview/ports";

/** The git service's API (packages/backend/src/git). */
export interface GitService {
  resolveRepoRoot(path: string): Promise<string>;
  hasBranch(root: string, branch: string): Promise<boolean>;
  ensureWorktreesExcluded(root: string): Promise<void>;
  createCardWorktree(root: string, slug: string, base?: string): Promise<{ worktreePath: string; branch: string }>;
  commitFile(worktree: string, path: string, message: string): Promise<boolean>;
  mergeMain(worktree: string, base?: string): Promise<MergeResult>;
  mergeInProgress(worktree: string): Promise<boolean>;
  abortMerge(worktree: string): Promise<void>;
  commitAll(worktree: string, message: string): Promise<boolean>;
  changedFiles(worktree: string): Promise<FileChange[]>;
  listLocalFiles(root: string): Promise<LocalFileList>;
  copyLocalFiles(root: string, worktree: string, paths: string[]): Promise<CopyOutcome[]>;
  mainBase(root: string): Promise<MainBase>;
  hasOrigin(root: string): Promise<boolean>;
  squashTree(root: string, baseRef: string, branch: string): Promise<SquashResult>;
  commitTree(root: string, tree: string, parent: string, message: string): Promise<string>;
  diffStat(root: string, base: string, tree: string): Promise<string>;
  recentMessages(root: string, baseRef: string, count?: number): Promise<string[]>;
  pushMain(root: string, commit: string): Promise<PushResult>;
  unpushedCount(root: string): Promise<number>;
  mainCheckout(root: string): Promise<{ path: string; dirty: boolean } | null>;
  isOn(root: string, commit: string, ref: string): Promise<boolean>;
  moveLocalMain(root: string, commit: string): Promise<string>;
  worktreeStatus(worktree: string): Promise<string[]>;
  discardChanges(worktree: string): Promise<void>;
  switchWorktree(worktree: string, target: { commit: string } | { branch: string }): Promise<void>;
  fileAt(root: string, commit: string, path: string): Promise<string>;
  removeCardWorktree(root: string, worktree: string, branch: string): Promise<void>;
  removeWorktree(root: string, worktree: string): Promise<void>;
  pruneWorktrees(root: string): Promise<void>;
  deleteBranch(root: string, branch: string): Promise<void>;
  cardSlug(title: string, id: string): string;
}

/** An error whose message is meant for the page, with the HTTP status to send it with. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface HiveDeps {
  db: HiveDb;
  hub: EventHub;
  git: GitService;
  runner: SessionRunner;
  probe: TrustProbe;
  /** Loads a role by name, e.g. "product-owner". */
  role: (name: string) => Role;
  /** Every file in roles/, read now, for the Role prompts page. server.ts passes the real one; without it, there are none. */
  listRoles?: () => RoleEntry[];
  /** The folder with the spec format's `format.md` and `review.md` (~/.claude/skills/spec-format). */
  specFormatDir: string;
  /** Today's date as YYYY-MM-DD, for spec file names. */
  today?: () => string;
  /** Each card's ports. server.ts passes the real one; without it, blocks are handed out without checking the machine. */
  ports?: PortService;
  /** How long a setup turn may run before it's stopped. Ten minutes unless a test says otherwise. */
  setupLimitMs?: number;
  /** Runs the card's app in Try it. server.ts passes the real one; without it, every app runs at once on paper. */
  apps?: AppRunner;
  log?: (message: string) => void;
}

/** The role whose session a lane talks to. */
const LANE_ROLE: Partial<Record<Lane, string>> = {
  refine: "product-owner",
  mockup: "designer",
  spec: "spec-writer",
  plan: "planner",
  build: "developer",
  check: "reviewer",
};
/** The blind spec reviewer of the review gate; Check's reviewer is LANE_ROLE.check. */
const SPEC_REVIEWER = "spec-reviewer";
/** The worktree's setup session: in the background, its sessions are filed under Refine, where the worktree is made. */
const SETUP = "setup";
/**
 * The spec keeper: not a session of its own, but turns in the spec writer's session after sign-off. Its role file only
 * holds the instructions sent at the top of each keeper message (docs/specs/2026-11-28-spec-keeper.md, Key decisions).
 */
const SPEC_KEEPER = "spec-keeper";
const CHAT_LANES: Lane[] = ["refine", "mockup", "spec"];

/** The options of a spec keeper question in Try it, and on a blocked build; the keeper's choice goes first. */
const KEEP_AS_BUILT = "Keep it as built";
const CHANGE_THE_CODE = "Change the code";
const CHANGE_THE_SPEC = "Change the spec";
const KEEP_THE_SPEC = "Keep the spec";

/** What a role's sessions get beyond its file. */
interface RoleTurn {
  /** Files from the spec format's folder, appended after the role's instructions. */
  specFormat?: string[];
  /** The fixed-format report each turn must end with (`outputFormat`). */
  report?: Record<string, unknown>;
  /** The hive's own tools its sessions are offered. */
  tools?: HiveToolName[];
  /**
   * Claude Code's own task-list tools (`TaskCreate`, `TaskUpdate`, …), which an SDK session doesn't get unless they're
   * switched on (docs/specs/2026-11-28-build-lane-checklist.md).
   */
  taskTools?: boolean;
}

/**
 * The one table of what each role gets beyond its file. turnOptions(), startTurn(), the committer's turn and the Role
 * prompts page all read it, so the page can't drift from what sessions get
 * (docs/specs/2026-11-27-role-prompts-page.md, Key decisions).
 */
const ROLE_TURNS: Record<string, RoleTurn> = {
  "product-owner": { tools: ["write_brief"] },
  designer: { tools: ["set_mockup"] },
  setup: { report: SETUP_SCHEMA, tools: ["copy_local_files"] },
  "spec-writer": { specFormat: ["format.md"] },
  "spec-keeper": { report: KEEPER_SCHEMA },
  "spec-reviewer": { report: REVIEW_SCHEMA },
  planner: { specFormat: ["format.md"], report: PLAN_SCHEMA },
  developer: { report: DEVELOPER_SCHEMA, taskTools: true },
  reviewer: { report: CHECK_SCHEMA },
  committer: { report: COMMIT_SCHEMA },
};

const AUTHOR: Record<string, ChatAuthor> = {
  "product-owner": "product-owner",
  designer: "designer",
  "spec-writer": "spec-writer",
  planner: "planner",
  developer: "developer",
  reviewer: "reviewer",
};

function refineFirstMessage(projectName: string, title: string, idea: string): string {
  return [
    `A new idea for the project ${projectName}:`,
    "",
    `Title: ${title}`,
    "",
    `The idea: ${idea}`,
    "",
    "Read the repo, then open with a draft brief through write_brief, and ask what you need to know with AskUserQuestion.",
  ].join("\n");
}

const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none)");

function briefText(brief: Brief | null): string {
  if (!brief) return "(The product owner wrote no brief.)";
  return [
    `Title: ${brief.title}`,
    `Problem: ${brief.problem}`,
    `Who it's for: ${brief.whoItsFor}`,
    "What done looks like:",
    list(brief.whatDoneLooksLike),
    "Out of scope:",
    list(brief.outOfScope),
    "Open points:",
    list(brief.openPoints),
  ].join("\n");
}

/** The plan as text, for the developer's message. */
function planText(plan: Plan | null): string {
  if (!plan) return "(The card has no plan.)";
  const steps = plan.steps.map((s, i) =>
    [`${i + 1}. ${s.title} [chunk: ${s.chunk}]`, s.detail ? `   ${s.detail}` : "", `   Checked by: ${s.check}`]
      .filter(Boolean)
      .join("\n"));
  const chunks = plan.chunks.map((c) => `- ${c.name} (${c.model}): ${c.owns.join(", ") || "(no files listed)"}`);
  return ["Steps:", ...steps, "", "Chunks:", ...chunks, "", "Tests:", list(plan.tests)].join("\n");
}

/** Bugs as a list, for the developer's and the next reviewer's messages. */
const bugList = (bugs: Bug[]) => list(bugs.map((b) => `${b.where}: ${b.problem}`));
const issueList = (issues: SpecIssue[]) => list(issues.map((i) => `${i.where}: ${i.problem}`));

/** Spec issues going to the developer as code changes: what's wrong, what was built, why, and your words if any. */
function keeperFixList(issues: SpecIssue[]): string {
  return issues.map((i) => [
    `- ${i.where}: ${i.problem}`,
    `  Built: ${i.guess}`,
    ...(i.judgment ? [`  The spec keeper: ${i.judgment.reason}`] : []),
    ...(i.answer?.words ? [`  The person said: ${i.answer.words}`] : []),
  ].join("\n")).join("\n");
}

const portRange = (first: number) => `${first}–${first + CARD_PORTS - 1}`;

/**
 * The card's ports and how to run things in its worktree, for the developer's and the reviewer's messages: the ports
 * always, so nothing runs on the project's defaults beside the person's own copy, and the setup's commands once done.
 */
function runningText(card: CardRow): string | null {
  if (card.port === null) return null;
  const lines = [
    `Running things in this worktree: use only the card's ports, ${portRange(card.port)}, so nothing clashes with the ` +
      "person's own copy of the app.",
  ];
  const s = card.setup;
  if (s?.status === "done") {
    for (const c of s.start) lines.push(`- Start ${c.what}: \`${c.command}\`${c.url ? ` (${openableUrl(c.url)})` : ""}`);
    if (s.test) lines.push(`- Tests: ${s.test}`);
    if (s.shared.length) lines.push(`- Still shared with the person's checkout: ${s.shared.join("; ")}`);
  }
  return lines.join("\n");
}

const withRunning = (card: CardRow, parts: string[]) => {
  const running = runningText(card);
  return running ? [...parts, "", running] : parts;
};

const noSetup = (): SetupReport => ({
  status: "running", reason: null, copied: [], leftOut: [], installed: "", start: [], test: "", shared: [], notes: "",
});

const portFromUrl = (url: string | null): number | null => {
  try {
    const port = Number(new URL(url ?? "").port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
};

/**
 * The setup's start entries as the hive will run them, each checked: its port is one of the card's, its folder is
 * inside the worktree, and no two share a port. A setup made before entries had a port gives it through its URL
 * (docs/specs/2026-11-27-try-it-runs-the-app.md, The setup's report).
 */
function appEntries(card: CardRow): AppEntry[] {
  const worktree = card.worktreePath!;
  const seen = new Set<number>();
  return (card.setup?.start ?? []).map((s): AppEntry => {
    const dir = s.dir ?? ".";
    const port = s.port ?? portFromUrl(s.url);
    const entry: AppEntry = { what: s.what, command: s.command, dir, port, url: openableUrl(s.url) };
    const folder = resolve(worktree, dir);
    if (port === null) return { ...entry, refused: "It has no port. Prepare it again." };
    if (card.port === null || port < card.port || port >= card.port + CARD_PORTS) {
      return { ...entry, refused: `Its port ${port} is outside the card's ports. Prepare it again.` };
    }
    if (folder !== worktree && !folder.startsWith(worktree + sep)) {
      return { ...entry, refused: "Its folder is outside the worktree. Prepare it again." };
    }
    if (seen.has(port)) return { ...entry, refused: `Another process already uses port ${port}. Prepare it again.` };
    seen.add(port);
    return entry;
  });
}

/** A path as the listing and the copy tool give it, without a folder's trailing slash, for comparing. */
const bare = (path: string) => path.replace(/\/+$/, "");

const human = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1024 ** 3
    ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** Up to three names, then "and N more". */
function some(names: string[]): string {
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

/** What bringing in the base (`main`, or a fetched `origin/main`) did, as the hive's note in Build's chat. */
export function mergeNote(merge: MergeResult, base = "main"): string {
  const name = base === "main" ? "Main" : base;
  switch (merge.kind) {
    case "clean":
      return merge.commits === 0 ? `${name} was already in.` : `Brought in ${base}: ${count(merge.commits, "new commit", "new commits")}.`;
    case "conflict":
      return `Bringing in ${base} stopped on conflicts in ${merge.files.join(", ") || "some files"}. The developer resolves them first.`;
    case "failed":
      return `Bringing in ${base} failed: ${sentence(merge.reason)} The developer was told to bring it in itself.`;
  }
}

/** What bringing in the base did, and what to do about it, for the developer. */
function mergeInstruction(merge: MergeResult, base = "main"): string {
  switch (merge.kind) {
    case "clean":
      return merge.commits === 0
        ? `${base} was already in this branch.`
        : `the hive merged ${count(merge.commits, "new commit", "new commits")} from ${base} into this branch.`;
    case "conflict":
      return `the merge of ${base} stopped on conflicts in ${merge.files.join(", ") || "some files"}. Resolve them and ` +
        "commit the merge first.";
    case "failed":
      return `git merge ${base} failed: ${sentence(merge.reason)} Merge ${base} into this branch yourself first.`;
  }
}

/** What a role's turns need beyond the basics. A background turn leaves the card's state and the chat alone. */
interface TurnOptions {
  extraInstructions?: string;
  outputFormat?: Record<string, unknown>;
  persist?: boolean;
  background?: boolean;
  taskTools?: boolean;
}

/** Hands-off roles whose turn cut off by a restart is resumed once, and what they're told. */
const RESUMED: Record<string, { who: string; message: string }> = {
  planner: { who: "planner", message: "Finish the build plan and report it." },
  // Not "build to the plan": a developer may have been fixing the bugs Check found.
  developer: { who: "developer", message: "Carry on with what you were doing, then end with your report." },
  reviewer: { who: "reviewer", message: "Finish the review and report." },
  setup: { who: "setup", message: "Finish setting up the worktree and report." },
};

/** A question waiting for an answer that a live turn is blocked on. */
interface Waiter {
  resolve(answer: AnswerBody): void;
}

const localDate = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD in local time

export class Hive {
  private turns = new Map<string, RunningTurn>(); // session id → running turn
  private waiters = new Map<string, Waiter>(); // pending item id → live turn waiting on it
  private stopping = new Set<string>(); // session ids being stopped by you
  private withdrawn = new Set<string>(); // session ids whose turn had a question withdrawn
  private followUps = new Map<string, string[]>(); // session id → messages that missed a turn already ending
  private moving = new Set<string>(); // card ids with a move in flight
  private starting = new Set<string>(); // card ids whose developer is being started (bringing in main)
  private reviews = new Map<string, { sessionId: string; hash: string }>(); // card id → running review and H0
  private setupTimers = new Map<string, ReturnType<typeof setTimeout>>(); // setup session id → its time limit
  private timedOut = new Set<string>(); // setup session ids stopped by their time limit
  private appTimers = new Map<string, ReturnType<typeof setTimeout>>(); // card id → a pending app.updated for output
  private landingProjects = new Map<string, string>(); // project id → the card landing on its main, one at a time
  private previousSetup = new Map<string, SetupReport>(); // card id → its last finished setup, while it's prepared again
  private portQueue: Promise<unknown> = Promise.resolve(); // port blocks are handed out one card at a time
  private setupStopped = new Set<string>(); // card ids whose setup you stopped in Build before its turn started
  private deleting = new Set<string>(); // card ids being deleted: late callbacks for them stand down
  private deletingTurns = new Map<string, Set<string>>(); // card id → its interrupted turns that haven't ended yet
  private readonly ports: PortService;
  private readonly apps: AppRunner;
  private lastSpec = new Map<string, string>(); // card id → the spec.updated last sent, to send only changes
  private landedSpecs = new Map<string, string>(); // card id → its spec at the landed commit, which never changes
  private watch = new SpecWatch();

  constructor(private deps: HiveDeps) {
    this.ports = deps.ports ?? fakePorts();
    this.apps = deps.apps ?? fakeApps();
  }

  private get db() {
    return this.deps.db;
  }

  private log(message: string) {
    (this.deps.log ?? console.error)(message);
  }

  /** Stops watching spec folders. */
  close(): void {
    this.watch.closeAll();
    for (const timer of [...this.appTimers.values(), ...this.setupTimers.values()]) clearTimeout(timer);
  }

  // ---------- reads ----------

  board(): BoardResponse {
    return {
      projects: this.db.listProjects().map(projectSummary),
      cards: this.db.listCards().map(cardSummary),
    };
  }

  card(id: string): CardDetail {
    const card = this.requireCard(id);
    const project = this.db.getProject(card.projectId)!;
    return {
      ...cardSummary(card),
      projectName: project.name,
      ideaTitle: card.ideaTitle,
      ideaText: card.ideaText,
      branch: card.branch,
      worktreePath: card.worktreePath,
      brief: card.brief,
      mockup: this.mockupInfo(card),
      spec: card.specPath ? (this.landedSpec(card) ?? this.refreshSpec(card.id)) : null,
      specPath: card.specPath,
      plan: card.plan,
      build: card.build,
      check: card.check,
      setup: card.setup,
      port: card.port,
      feedback: card.feedback,
      shipAfterCheck: card.shipAfterCheck,
      checklist: card.checklist,
      apps: card.lane === "tryit" ? this.apps.status(card.id) : [],
      appStopped: card.appStopped,
      landed: card.landed,
      landing: this.landingProjects.get(card.projectId) === card.id,
      issues: this.db.issuesFor(card.id),
      decisions: this.db.decisionsFor(card.id),
      chat: this.db.chatFor(card.id, card.lane),
      pastChats: this.pastChats(card.id, card.lane),
      history: this.history(card.id),
      pending: this.db.openPendingFor(card.id)?.item ?? null,
      turnRunning: this.anyTurnRunning(card.id),
    };
  }

  /**
   * Every role, as the Role prompts page shows it: each file in roles/ read now, with what ROLE_TURNS adds, and the
   * roles still to be written (docs/specs/2026-11-27-role-prompts-page.md, Backend).
   */
  roles(): RolesResponse {
    const knownLane = (lane: string | undefined): Lane | null =>
      LANES.some((l) => l.id === lane) ? (lane as Lane) : null;
    const empty = { model: null, kind: null, instructions: "", extras: [], report: null, tools: [], taskTools: false };
    const entries = this.deps.listRoles?.() ?? [];
    const roles: RoleInfo[] = entries.map((entry): RoleInfo => {
      if ("error" in entry) return { name: entry.name, lane: null, ...empty, error: entry.error };
      const { role } = entry;
      const turn = ROLE_TURNS[entry.name] ?? {};
      return {
        name: entry.name,
        lane: knownLane(role.lane),
        model: role.model,
        kind: role.kind,
        instructions: role.instructions,
        extras: (turn.specFormat ?? []).map((file) => join(this.deps.specFormatDir, file)),
        report: turn.report ?? null,
        tools: (turn.tools ?? []).map(describeHiveTool),
        taskTools: turn.taskTools ?? false,
      };
    });
    for (const planned of PLANNED_ROLES) {
      if (!entries.some((entry) => entry.name === planned.name)) {
        roles.push({ name: planned.name, lane: planned.lane, ...empty, planned: true });
      }
    }
    // Lanes in board order; within a lane its own role first, then by name; roles with no lane last, by name.
    const laneIndex = (lane: Lane | null) => (lane ? LANES.findIndex((l) => l.id === lane) : LANES.length);
    const ownFirst = (role: RoleInfo) => (role.lane && LANE_ROLE[role.lane] === role.name ? 0 : 1);
    roles.sort((a, b) =>
      laneIndex(a.lane) - laneIndex(b.lane) || ownFirst(a) - ownFirst(b) || a.name.localeCompare(b.name));
    return { roles };
  }

  /**
   * The card for its page. A landed card's worktree is gone, so its spec is first read from the commit it landed as
   * (docs/specs/2026-11-27-later-lane-artifacts.md, A landed card's spec).
   */
  async cardForPage(id: string): Promise<CardDetail> {
    await this.readLandedSpec(id);
    return this.card(id);
  }

  /** Reads a landed card's spec from its landed commit, once. A failed read isn't kept, so the next fetch tries again. */
  private async readLandedSpec(cardId: string): Promise<void> {
    const card = this.requireCard(cardId);
    if (!card.landed || card.worktreePath || !card.specPath || this.landedSpecs.has(cardId)) return;
    const root = this.db.getProject(card.projectId)?.path;
    if (!root) return;
    try {
      this.landedSpecs.set(cardId, await this.deps.git.fileAt(root, card.landed.commit, card.specPath));
    } catch (error) {
      this.log(`Can't read the landed spec of card ${cardId}: ${(error as Error).message}`);
    }
  }

  /** A landed card's spec as read from its landed commit: reviewed and signed off before it landed. */
  private landedSpec(card: CardRow): SpecInfo | null {
    const text = card.landed && !card.worktreePath && card.specPath ? this.landedSpecs.get(card.id) : undefined;
    return text === undefined ? null : { path: card.specPath!, text, review: "fresh" };
  }

  /**
   * What the later lanes produced, newest round first, from the event rows written as each round finished
   * (docs/specs/2026-11-27-later-lane-artifacts.md, Where it comes from).
   */
  private history(cardId: string): CardHistory {
    const rows = this.db.eventsOf(cardId, ["plan", "build", "check", "feedback", "accept"]);
    const newestFirst = (type: string) => rows.filter((r) => r.type === type).map((r) => r.data).reverse();
    const feedback: TryItRound[] = newestFirst("feedback").map((d) => ({ kind: "feedback", text: String(d.text) }));
    // One acceptance, on top, and only while it's the last word: one that Back to Try it undid isn't shown.
    const lastTryIt = rows.filter((r) => r.type === "feedback" || r.type === "accept").at(-1);
    return {
      plans: newestFirst("plan"),
      builds: newestFirst("build").map((d) => ({
        summary: d.summary, departures: d.departures ?? [], issues: d.issues ?? [], decisions: d.decisions ?? [],
      })),
      checks: newestFirst("check").map((d) => ({
        round: d.round, summary: d.summary, bugs: d.bugs ?? [], issues: d.issues ?? [],
      })),
      tryit: lastTryIt?.type === "accept" ? [{ kind: "accepted" }, ...feedback] : feedback,
    };
  }

  /** The chat of every lane before the current one that has any (docs/specs/2026-11-27-card-lane-artifacts.md). */
  private pastChats(cardId: string, current: Lane): Partial<Record<Lane, ChatItem[]>> {
    return this.db.chatsByLane(cardId, lanesBefore(current));
  }

  // ---------- projects ----------

  async addProject(path: string): Promise<void> {
    if (typeof path !== "string" || !path.trim()) throw new HttpError(400, "Give the path to a git repo.");
    let root: string;
    try {
      root = await this.deps.git.resolveRepoRoot(path.trim());
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    if (this.db.getProjectByPath(root)) throw new HttpError(409, `${root} is already a project.`);
    if (!(await this.deps.git.hasBranch(root, "main"))) {
      throw new HttpError(400, `${root} has no main branch. Cards start from main.`);
    }
    const project = { id: randomUUID(), name: basename(root), path: root, trustWarning: false };
    this.db.insertProject(project);
    this.deps.hub.emit({ type: "project.updated", project: projectSummary(project) });
    void this.checkTrust(project.id); // the row warns once the probe is back; adding doesn't wait for it
  }

  /** Run the trust probe and set the project's warning (spec: the trust probe). */
  async checkTrust(projectId: string): Promise<void> {
    const project = this.db.getProject(projectId);
    if (!project) throw new HttpError(404, "No such project.");
    const hasClaudeMd = ["CLAUDE.md", join(".claude", "CLAUDE.md")].some((f) => existsSync(join(project.path, f)));
    let warning = false;
    if (hasClaudeMd) {
      try {
        warning = !(await this.deps.probe.loadsProjectClaudeMd(project.path));
      } catch (error) {
        this.log(`Trust probe failed for ${project.path}: ${(error as Error).message}`);
        return; // can't tell; leave the warning as it was
      }
    }
    this.db.setTrustWarning(project.id, warning);
    this.deps.hub.emit({ type: "project.updated", project: projectSummary({ ...project, trustWarning: warning }) });
  }

  // ---------- cards and moves ----------

  createCard(projectId: string, title: string, text: string): CardSummary {
    if (!this.db.getProject(projectId)) throw new HttpError(404, "No such project.");
    if (typeof title !== "string" || !title.trim()) throw new HttpError(400, "Give the idea a title first.");
    if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "Type an idea first.");
    const id = randomUUID();
    this.db.insertCard({
      id, projectId, title: title.trim(), ideaTitle: title.trim(), ideaText: text.trim(), lane: "ideas",
      state: "needs-you", branch: null, worktreePath: null, brief: null, moveError: null,
      specPath: null, reviewedSpecHash: null, reviewApplying: false, plan: null, build: null, check: null,
      setup: null, port: null, feedback: null, appStopped: false, landing: null, landed: null, shipAfterCheck: false,
    });
    this.emitCard(id);
    return cardSummary(this.requireCard(id));
  }

  /** Edits an idea's title and text, until Start. */
  updateIdea(id: string, body: UpdateIdeaBody): CardSummary {
    const card = this.db.getCard(id);
    if (!card) throw new HttpError(404, "No such card.");
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!title) throw new HttpError(400, "Give the idea a title first.");
    if (!text) throw new HttpError(400, "Type an idea first.");
    if (card.lane !== "ideas") throw new HttpError(409, "The idea can only be edited while the card is in Ideas.");
    if (this.moving.has(id)) throw new HttpError(409, "This card is moving. Try again in a moment.");
    this.db.updateCard(id, { ideaTitle: title, ideaText: text, title });
    this.emitCard(id);
    return cardSummary(this.requireCard(id));
  }

  /**
   * Every card waiting for you, the one waiting longest first, each with what it wants
   * (docs/specs/2026-11-27-for-you.md). A card being deleted is already gone.
   */
  forYou(): ForYouResponse {
    const projects = new Map(this.db.listProjects().map((p) => [p.id, p.name]));
    const items = this.db
      .listCards()
      .filter((card) => waitsForYou(card) && !this.deleting.has(card.id))
      .map((card): ForYouItem => {
        const pending = this.db.openPendingFor(card.id)?.item ?? null;
        const lastChat = this.db.lastChatItem(card.id, card.lane) ?? null;
        const spec = card.lane === "spec" ? this.refreshSpec(card.id) : null;
        const { kind, text } = whatItWants({
          lane: card.lane, pending, lastChat: lastChat ?? undefined, review: spec?.review ?? null,
        });
        // The Ship plan is never read here: it needs git on every reload, and the confirm row reads it instead.
        const input: LaneActionInput = {
          lane: card.lane,
          turnRunning: this.anyTurnRunning(card.id),
          pending: pending !== null,
          lastChat,
          spec: spec ? { review: spec.review, hasText: spec.text !== null } : null,
          issues: this.db.issuesFor(card.id).map((issue) => issue.status),
          landing: this.landingProjects.get(card.projectId) === card.id,
          shipPlan: null,
          hasFeedback: false,
          mockup: this.mockupInfo(card),
        };
        return {
          card: cardSummary(card),
          projectName: projects.get(card.projectId) ?? "",
          since: card.waitingSince,
          kind,
          text,
          pending: kind === "question" || kind === "permission" ? pending : null,
          actions: forYouActions(kind, input),
        };
      });
    // listCards is oldest card first, and the sort is stable, so equal times keep that order.
    items.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
    return { items };
  }

  async moveCard(id: string, lane: Lane): Promise<CardSummary> {
    const card = this.requireCard(id);
    if (!canMove(card.lane, lane)) throw new HttpError(409, `A card can't move from ${card.lane} to ${lane} yet.`);
    return this.oneMoveAtATime(id, () => this.enterRefine(card, lane));
  }

  /** A second move while the first is still running would trip over what the first just made. */
  private async oneMoveAtATime<T>(id: string, move: () => Promise<T>): Promise<T> {
    if (this.moving.has(id)) throw new HttpError(409, "This card is already moving.");
    this.moving.add(id);
    try {
      return await move();
    } finally {
      this.moving.delete(id);
    }
  }

  private async enterRefine(card: CardRow, lane: Lane): Promise<CardSummary> {
    const id = card.id;
    const project = this.db.getProject(card.projectId)!;

    // The lane changes only once the worktree exists; a git failure leaves the card in Ideas.
    let worktree: { worktreePath: string; branch: string };
    try {
      await this.deps.git.ensureWorktreesExcluded(project.path);
      // The hive's one base: a fetched origin/main, or main without a remote (docs/specs/2026-11-27-ship-lane.md).
      const base = await this.deps.git.mainBase(project.path);
      worktree = await this.deps.git.createCardWorktree(project.path, this.deps.git.cardSlug(card.title, card.id), base.ref);
    } catch (error) {
      this.db.updateCard(id, { moveError: (error as Error).message });
      this.emitCard(id);
      throw new HttpError(409, (error as Error).message);
    }
    // Load the role before the lane changes, so a broken role file leaves the card in Ideas instead of in Refine
    // with no session to talk to.
    let role: Role;
    try {
      role = this.deps.role(LANE_ROLE.refine!);
    } catch (error) {
      this.db.updateCard(id, { moveError: (error as Error).message });
      this.emitCard(id);
      throw new HttpError(500, (error as Error).message);
    }
    this.db.updateCard(id, { lane, branch: worktree.branch, worktreePath: worktree.worktreePath, moveError: null });

    const sessionId = randomUUID();
    this.db.insertSession({ id: sessionId, cardId: id, lane, role: LANE_ROLE.refine!, kind: role.kind });
    this.startTurn(id, sessionId, refineFirstMessage(project.name, card.ideaTitle, card.ideaText));
    // The worktree is set up in the background while you chat (docs/specs/2026-11-27-worktree-setup-and-try-it.md).
    void this.startSetup(id).catch((error: unknown) => this.log(`Setting up card ${id} failed: ${String(error)}`));
    return cardSummary(this.requireCard(id));
  }

  /**
   * Good: Refine → Mockup, or straight to Spec with `skipMockup`; Mockup → Spec, keeping the mockup or not
   * (docs/specs/2026-11-28-mockup-lane-and-designer-role.md, Into Mockup and Out of Mockup).
   */
  async good(cardId: string, body: GoodBody = {}): Promise<CardSummary> {
    const card = this.requireCard(cardId);
    if (card.lane === "mockup") return this.leaveMockup(cardId, body ?? {});
    if (body?.skipMockup !== undefined && typeof body.skipMockup !== "boolean") {
      throw new HttpError(400, "skipMockup must be true or false.");
    }
    const to = laneAfter(card.lane, body?.skipMockup ? "skip-mockup" : "good");
    if (!to) throw new HttpError(409, "Good moves a card on from Refine or Mockup.");
    if (this.anyTurnRunning(cardId) || this.db.openPendingFor(cardId)) {
      throw new HttpError(409, "Wait for the product owner to finish.");
    }
    if (to === "spec") {
      const spec = this.prepareSpec();
      return this.oneMoveAtATime(cardId, async () => {
        this.enterSpec(cardId, spec);
        return cardSummary(this.requireCard(cardId));
      });
    }
    // Load the designer's role before anything changes, so a missing or broken file leaves the card in Refine.
    let role: Role;
    try {
      role = this.deps.role(LANE_ROLE.mockup!);
    } catch (error) {
      throw new HttpError(500, `The designer's role can't be loaded: ${(error as Error).message}`);
    }
    return this.oneMoveAtATime(cardId, async () => {
      const worktree = card.worktreePath!;
      // The folder is named after the worktree, the same slug as the branch hive/<card>. Git can't see it while it's
      // empty, so making it early leaves nothing on the branch.
      const folder = `docs/mockups/${basename(worktree)}`;
      try {
        mkdirSync(join(worktree, folder), { recursive: true });
      } catch (error) {
        throw new HttpError(409, `The mockup folder couldn't be made: ${(error as Error).message}`);
      }
      this.db.updateCard(cardId, { lane: to, mockup: { folder, current: null, kept: null } });
      const sessionId = randomUUID();
      this.db.insertSession({ id: sessionId, cardId, lane: to, role: LANE_ROLE.mockup!, kind: role.kind });
      this.emitMockup(cardId);
      this.startTurn(cardId, sessionId, this.designerFirstMessage(cardId));
      return cardSummary(this.requireCard(cardId));
    });
  }

  /** Mockup → Spec: Keep commits the mockup's folder on the card's branch; Don't keep leaves it until sign-off. */
  private async leaveMockup(cardId: string, body: GoodBody): Promise<CardSummary> {
    const card = this.requireCard(cardId);
    if (laneAfter(card.lane, "good") !== "spec") throw new HttpError(409, "Good moves a card on from Mockup to Spec.");
    if (typeof body.keep !== "boolean") throw new HttpError(400, "Say whether to keep the mockup: keep must be true or false.");
    if (this.anyTurnRunning(cardId) || this.db.openPendingFor(cardId)) {
      throw new HttpError(409, "Wait for the designer to finish.");
    }
    const keep = body.keep;
    if (keep) this.refuseUnkeepable(card);
    const spec = this.prepareSpec();
    return this.oneMoveAtATime(cardId, async () => {
      const now = this.requireCard(cardId);
      if (keep) await this.commitMockup(now);
      this.db.updateCard(cardId, { mockup: { ...now.mockup!, kept: keep } });
      this.enterSpec(cardId, spec);
      this.emitMockup(cardId);
      return cardSummary(this.requireCard(cardId));
    });
  }

  /**
   * Keep, at Good or after all in Spec, needs a named mockup, and an HTML one needs pages in its folder. A link needs
   * no files: Keep writes its README.
   */
  private refuseUnkeepable(card: CardRow): void {
    const mockup = card.mockup;
    if (!mockup?.current) throw new HttpError(409, "There's no mockup to keep: the designer hasn't named one.");
    if (mockup.current.kind === "pages" && this.mockupFiles(card).length === 0) {
      throw new HttpError(409, `There's nothing to keep: ${mockup.folder}/ is empty.`);
    }
  }

  /**
   * Keep it after all: Keep, done later. It commits a mockup you didn't keep while the card is in Spec, and refuses
   * what Keep refuses. It touches only the mockup's folder, so it neither waits for the spec writer nor starts a turn.
   */
  async keepMockup(cardId: string): Promise<void> {
    const check = (card: CardRow) => {
      if (card.lane !== "spec") throw new HttpError(409, "Keep it after all works while the card is in Spec.");
      if (!card.mockup || card.mockup.kept === null) throw new HttpError(409, "This card has no mockup to keep.");
      if (card.mockup.kept) throw new HttpError(409, "The mockup is already kept.");
      this.refuseUnkeepable(card);
    };
    check(this.requireCard(cardId));
    await this.oneMoveAtATime(cardId, async () => {
      const card = this.requireCard(cardId);
      check(card);
      await this.commitMockup(card);
      this.db.updateCard(cardId, { mockup: { ...card.mockup!, kept: true } });
      this.emitMockup(cardId);
      this.addNote(cardId, "spec", `The mockup is kept after all, at ${card.mockup!.folder}/.`);
    });
  }

  /**
   * Commits the mockup's folder alone as `Mockup: <title>`. A Claude Design link gets a README.md with its link
   * first, in a folder made again if it's gone. A git error refuses the move.
   */
  private async commitMockup(card: CardRow): Promise<void> {
    const { folder, current } = card.mockup!;
    const worktree = card.worktreePath!;
    try {
      if (current?.kind === "link") writeMockupReadme(join(worktree, folder), card.title, current.url);
      await this.deps.git.commitFile(worktree, folder, `Mockup: ${card.title}`);
    } catch (error) {
      throw new HttpError(409, `The mockup couldn't be committed: ${(error as Error).message}`);
    }
  }

  /**
   * What entering Spec needs, checked before anything moves: the spec format (format.md for the writer, review.md for
   * the review gate later) and the spec writer's role.
   */
  private prepareSpec(): { options: TurnOptions; role: Role } {
    const options = this.turnOptions(LANE_ROLE.spec!); // reads format.md: a missing one refuses here, before the move
    this.formatFile("review.md"); // the review gate needs it later; refuse now rather than in the middle of Spec
    return { options, role: this.deps.role(LANE_ROLE.spec!) };
  }

  /** Into Spec: the spec writer's session and its first turn, and the watch on the spec. Run inside oneMoveAtATime. */
  private enterSpec(cardId: string, { options, role }: { options: TurnOptions; role: Role }): void {
    const card = this.requireCard(cardId);
    const specPath = specPathFor(card.worktreePath!, card.brief?.title || card.title, (this.deps.today ?? localDate)());
    this.db.updateCard(cardId, { lane: "spec", specPath, reviewedSpecHash: null, reviewApplying: false });
    const sessionId = randomUUID();
    this.db.insertSession({ id: sessionId, cardId, lane: "spec", role: LANE_ROLE.spec!, kind: role.kind });
    this.watchSpec(cardId);
    this.startTurn(cardId, sessionId, this.specFirstMessage(cardId, specPath), options);
  }

  /** Spec → Plan, only while the spec on disk is the text the last finished review produced. */
  async signoff(cardId: string): Promise<CardSummary> {
    const card = this.requireCard(cardId);
    const to = laneAfter(card.lane, "signoff");
    if (!to || !card.specPath) throw new HttpError(409, "Sign off moves a card on from Spec.");
    if (this.anyTurnRunning(cardId)) throw new HttpError(409, "Wait for the running turn to finish.");
    if (card.reviewApplying) throw new HttpError(409, "The review wasn't finished. Retry it first.");
    if (!card.reviewedSpecHash) throw new HttpError(409, "Run the review first.");
    const { hash } = readSpec(card.worktreePath!, card.specPath);
    if (hash !== card.reviewedSpecHash) {
      this.refreshSpec(cardId);
      throw new HttpError(409, "The spec changed since the review. Review it again first.");
    }
    return this.oneMoveAtATime(cardId, async () => {
      try {
        await this.deps.git.commitFile(card.worktreePath!, card.specPath!, `Spec: ${card.title}`);
      } catch (error) {
        throw new HttpError(409, (error as Error).message);
      }
      // A mockup you didn't keep was never committed. It goes now, before Build's checkpoint (`git add -A`) could
      // commit it; a failed delete refuses sign-off. The spec commit above finds nothing to do on the next try.
      const mockup = this.requireCard(cardId).mockup;
      const deleted = mockup?.kept === false && existsSync(join(card.worktreePath!, mockup.folder));
      if (deleted) {
        try {
          rmSync(join(card.worktreePath!, mockup.folder), { recursive: true, force: true });
        } catch (error) {
          this.emitMockup(cardId);
          throw new HttpError(409,
            `The mockup you didn't keep couldn't be deleted from ${mockup.folder}/: ${(error as Error).message}`);
        }
      }
      this.watch.unwatch(cardId);
      // Keeper fix rounds count from sign-off (docs/specs/2026-11-28-spec-keeper.md, After the batch).
      this.db.updateCard(cardId, { lane: to, keeperRounds: 0 });
      if (deleted) this.emitMockup(cardId);
      this.startPlanner(cardId);
      return cardSummary(this.requireCard(cardId));
    });
  }

  /**
   * A blocked plan or build goes back to the spec writer with its reason; a new review and sign-off follow. A build's
   * partial work is committed first, after aborting an unfinished merge of main, which the next Build merges again.
   */
  async backToSpec(cardId: string): Promise<CardSummary> {
    const card = this.requireCard(cardId);
    const from = card.lane;
    const to = laneAfter(from, "back-to-spec");
    if (!to) throw new HttpError(409, "Only a card in Plan, Build or Check can go back to Spec.");
    const who = from === "build" ? "developer" : from === "check" ? "spec keeper" : "planner";
    if (this.anyTurnRunning(cardId)) throw new HttpError(409, `Wait for the ${who} to finish.`);
    const last = this.db.lastChatItem(cardId, from);
    if (!last || last.kind !== "error" || !last.actions.includes("back-to-spec")) {
      throw new HttpError(409, from === "check"
        ? "Only a card the spec keeper stopped goes back to Spec from Check."
        : `Only a blocked ${from === "build" ? "build" : "plan"} goes back to Spec.`);
    }
    const writer = this.db.getSessionFor(cardId, "spec", LANE_ROLE.spec!);
    if (!writer) throw new HttpError(409, "This card has no spec writer to go back to.");
    // The keeper stopped the card on a severe issue: its own finding goes back to it, as the spec writer.
    const severe = this.db.issuesFor(cardId).some((i) => i.status === "severe");
    return this.oneMoveAtATime(cardId, async () => {
      if (from === "check") await this.stopCardServers(cardId, "check");
      if (from === "build") {
        const worktree = card.worktreePath!;
        try {
          await this.stopCardServers(cardId, "build");
          if (await this.deps.git.mergeInProgress(worktree)) await this.deps.git.abortMerge(worktree);
          await this.deps.git.commitAll(worktree, `Build (unfinished): ${card.title}`);
        } catch (error) {
          throw new HttpError(409, `The build's partial work couldn't be committed: ${(error as Error).message}`);
        }
      }
      // Every issue not yet settled is settled in Spec: the spec writer gets them, and none is judged or asked after
      // the new sign-off (docs/specs/2026-11-28-spec-keeper.md, After the batch).
      const unsettled: IssueStatus[] = ["open", "judged", "severe", "waiting", "held"];
      const settled = this.db.issuesFor(cardId).filter((i) => unsettled.includes(i.status));
      const open = this.db.openPendingFor(cardId);
      const question = open?.item.kind === "question" && open.item.issueIds ? open : null;
      // Stored Try it feedback goes with it: the developer's reason carries it to the spec writer, and after the new
      // sign-off the developer must get the new plan.
      this.db.transaction(() => {
        this.db.setIssueStatus(settled.map((i) => i.id), "settled");
        if (question) this.db.setPendingAnswer(question.id, { withdrawn: true });
        this.db.updateCard(cardId, {
          lane: to, reviewedSpecHash: null, reviewApplying: false, feedback: null, shipAfterCheck: false,
          judging: null, keeperFixes: null,
        });
      });
      if (question) this.deps.hub.emit({ type: "pending.updated", cardId, pending: null });
      this.watchSpec(cardId);
      const opening = severe
        ? [`As the spec keeper, you stopped the card on a severe issue:`, "", last.message, "",
          "The person sent the card back to Spec. Revise the spec with them, then say briefly what you changed. It " +
            "needs a new review and sign-off."]
        : [`The ${who} couldn't ${from === "build" ? "build" : "plan"} from the signed-off spec. What it reported:`, "",
          last.message, "",
          "Revise the spec to resolve this, then say briefly what you changed. It needs a new review and sign-off."];
      const closing = settled.length
        ? ["", "These spec issues were still open on the card. They're closed now; settle in the spec what needs it:",
          issueList(settled)]
        : [];
      this.startTurn(cardId, writer.id, [...opening, ...closing].join("\n"), this.turnOptions(LANE_ROLE.spec!));
      return cardSummary(this.requireCard(cardId));
    });
  }

  /** One more round for a card that Check stopped: back to the same developer with the last round's bugs. */
  async backToBuild(cardId: string): Promise<CardSummary> {
    const card = this.requireCard(cardId);
    const to = laneAfter(card.lane, "back-to-build");
    if (!to) throw new HttpError(409, "Only a card in Check or Ship can go back to Build.");
    this.requireOffered(cardId, card.lane, "back-to-build");
    if (card.lane === "ship") {
      // A Retry's landing runs with the old error line still last until its first note: it mustn't be pulled from under it.
      if (this.landingProjects.get(card.projectId) === cardId) throw new HttpError(409, "The card is landing.");
      // The tests failed on the squash: their output goes to the developer, and after Check the card returns to Ship.
      const last = this.db.lastChatItem(cardId, "ship");
      return this.oneMoveAtATime(cardId, async () => {
        this.shipToBuild(cardId, last?.kind === "error" ? last.message : "Landing on main stopped.");
        return cardSummary(this.requireCard(cardId));
      });
    }
    return this.oneMoveAtATime(cardId, async () => {
      const developer = this.db.getSessionFor(cardId, "build", LANE_ROLE.build!);
      this.db.transaction(() => {
        this.db.updateCard(cardId, { lane: to, build: null });
        if (developer) this.db.updateSession(developer.id, { lastMessage: null });
      });
      this.emitCard(cardId);
      void this.startDeveloper(cardId)
        .catch((error: unknown) => this.log(`Starting the developer of card ${cardId} failed: ${String(error)}`));
      return cardSummary(this.requireCard(cardId));
    });
  }

  /** Try it as built, for a card that Check stopped or couldn't review. */
  async moveOn(cardId: string): Promise<CardSummary> {
    const card = this.requireCard(cardId);
    const to = laneAfter(card.lane, "move-on");
    if (!to) throw new HttpError(409, "Only a card in Check can move on to Try it.");
    this.requireOffered(cardId, card.lane, "move-on");
    const issues = this.db.issuesFor(cardId);
    const open = issues.filter((i) => i.status === "open");
    return this.oneMoveAtATime(cardId, async () => {
      // Past a keeper turn that failed: the issues it was judging stay open, shown as not judged.
      if (card.judging) {
        this.db.updateCard(cardId, { judging: null });
        this.addNote(cardId, "check", "You moved the card on to Try it past the spec keeper. Its issues aren't judged.");
      } else if (issues.some((i) => i.status === "severe")) {
        // After a severe verdict, the batch is taken as built: the severe issue and its code fixes come to you.
        this.db.setIssueStatus(issues.filter((i) => i.status === "severe" || i.status === "judged").map((i) => i.id), "waiting");
        this.addNote(cardId, "check", "You moved the card on to Try it as built. The spec keeper's questions wait for you there.");
      } else if (open.length > 0) {
        // The batch is judged first, as built: every code fix becomes a question.
        this.addNote(cardId, "check", "You moved the card on to Try it as built.");
        this.startKeeper(cardId, "as-built", open);
        return cardSummary(this.requireCard(cardId));
      } else {
        this.addNote(cardId, "check", "You moved the card on to Try it as built.");
      }
      await this.moveToTryIt(cardId, "check");
      return cardSummary(this.requireCard(cardId));
    });
  }

  /**
   * The card moves on to Try it: whatever listens on its ports goes, its app starts, and every spec issue waiting for
   * you is asked there in one question (docs/specs/2026-11-28-spec-keeper.md, After the batch).
   */
  private async moveToTryIt(cardId: string, from: Lane): Promise<void> {
    await this.stopCardServers(cardId, from);
    this.db.updateCard(cardId, { lane: "tryit", shipAfterCheck: false });
    this.askWaitingIssues(cardId);
    this.emitCard(cardId);
    void this.startApp(cardId).catch((error: unknown) => this.log(`Starting the app of card ${cardId} failed: ${String(error)}`));
  }

  /** A button on an error line counts only while nothing runs and that line is still the lane's last. */
  private requireOffered(cardId: string, lane: Lane, action: ErrorAction): void {
    if (this.anyTurnRunning(cardId)) throw new HttpError(409, "Wait for the running turn to finish.");
    const last = this.db.lastChatItem(cardId, lane);
    if (!last || last.kind !== "error" || !last.actions.includes(action)) {
      throw new HttpError(409, "That isn't on offer for this card any more.");
    }
  }

  // ---------- deleting a card ----------

  /** A card being deleted counts as gone at the public entry points (the routes ask before calling in). */
  isDeleting(cardId: string): boolean {
    return this.deleting.has(cardId);
  }

  /**
   * Background work for the card stands down: it's being deleted, or already is. The mark alone isn't enough, since
   * it lifts when the delete ends while a start awaiting git may still be on its way.
   */
  private gone(cardId: string): boolean {
    return this.deleting.has(cardId) || !this.db.getCard(cardId);
  }

  /**
   * Deletes a card for good: everything it runs is stopped, its worktree and branch are removed, and every row and bit
   * of memory about it goes. Refused only while it lands on main or a move is in flight. A git step that fails is
   * listed in `left`, and the card is deleted anyway (docs/specs/2026-11-27-delete-a-card.md).
   */
  async deleteCard(cardId: string): Promise<{ left: string[] }> {
    if (this.deleting.has(cardId)) throw new HttpError(404, "No such card.");
    const card = this.requireCard(cardId); // read once; the steps below work from this row
    if (this.landingProjects.get(card.projectId) === cardId) throw new HttpError(409, "Wait for the landing to finish.");
    if (this.moving.has(cardId)) throw new HttpError(409, "This card is moving. Try again in a moment.");
    const root = this.db.getProject(card.projectId)?.path;
    const sessions = this.db.sessionsFor(cardId);
    this.deleting.add(cardId);

    // Every running turn of every session of the card is interrupted, and not waited for: the mark above stays until
    // the last of them has ended, so even a late one stands down.
    const interrupted = new Set<string>();
    for (const session of sessions) {
      const turn = this.turns.get(session.id);
      if (!turn) continue;
      interrupted.add(session.id);
      this.stopping.add(session.id);
      void turn.interrupt().catch(() => undefined);
    }
    if (interrupted.size) this.deletingTurns.set(cardId, interrupted);

    await this.apps.clear(cardId).catch((error: unknown) => this.log(`Stopping the app of card ${cardId} failed: ${String(error)}`));
    if (card.port !== null && card.worktreePath) {
      await this.ports.stopListeners(cardPorts(card.port), card.worktreePath)
        .catch((error: unknown) => this.log(`Clearing the ports of card ${cardId} failed: ${String(error)}`));
    }
    this.watch.unwatch(cardId);

    const left: string[] = [];
    if (root && card.worktreePath) {
      try {
        if (existsSync(card.worktreePath)) await this.deps.git.removeWorktree(root, card.worktreePath);
        else await this.deps.git.pruneWorktrees(root);
      } catch (error) {
        left.push(`The worktree ${card.worktreePath}: ${sentence((error as Error).message)}`);
      }
    }
    if (root && card.branch && (await this.deps.git.hasBranch(root, card.branch).catch(() => false))) {
      try {
        await this.deps.git.deleteBranch(root, card.branch);
      } catch (error) {
        left.push(`The branch ${card.branch}: ${sentence((error as Error).message)}`);
      }
    }

    this.db.deleteCard(cardId);
    for (const id of [cardId]) {
      this.reviews.delete(id);
      this.lastSpec.delete(id);
      this.landedSpecs.delete(id);
      this.moving.delete(id);
      this.starting.delete(id);
      this.previousSetup.delete(id);
      this.setupStopped.delete(id);
      clearTimeout(this.appTimers.get(id));
      this.appTimers.delete(id);
    }
    for (const session of sessions) {
      if (interrupted.has(session.id)) continue; // its turn end clears its own
      this.followUps.delete(session.id);
      this.withdrawn.delete(session.id);
      this.stopping.delete(session.id);
      clearTimeout(this.setupTimers.get(session.id));
      this.setupTimers.delete(session.id);
      this.timedOut.delete(session.id);
    }
    for (const [itemId] of [...this.waiters]) {
      if (!this.db.getPending(itemId)) this.waiters.delete(itemId);
    }
    if (!this.deletingTurns.has(cardId)) this.deleting.delete(cardId);
    this.deps.hub.emit({ type: "card.deleted", cardId });
    return { left };
  }

  /** An interrupted turn of a deleted card has ended: its bookkeeping goes, and the last one lifts the mark. */
  private standDown(cardId: string, sessionId: string): void {
    this.followUps.delete(sessionId);
    this.withdrawn.delete(sessionId);
    this.stopping.delete(sessionId);
    clearTimeout(this.setupTimers.get(sessionId));
    this.setupTimers.delete(sessionId);
    this.timedOut.delete(sessionId);
    const left = this.deletingTurns.get(cardId);
    left?.delete(sessionId);
    if (!left || left.size === 0) {
      this.deletingTurns.delete(cardId);
      if (!this.db.getCard(cardId)) this.deleting.delete(cardId);
    }
  }

  // ---------- chat ----------

  sendMessage(cardId: string, text: string): void {
    if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "Type a message first.");
    const card = this.requireCard(cardId);
    if (!CHAT_LANES.includes(card.lane)) throw new HttpError(409, "Nobody to chat with in this lane.");
    this.refuseWhileMoving(cardId);
    const session = this.requireLaneSession(cardId);
    const open = this.db.openPendingFor(cardId);
    const answersQuestion = open?.item.kind === "question";

    // While a review runs or is being applied, the spec mustn't change outside it (spec: Review).
    if (card.lane === "spec") {
      if (this.reviews.has(cardId)) throw new HttpError(409, "Wait for the review to finish.");
      if (card.reviewApplying && this.turns.has(session.id) && !answersQuestion) {
        throw new HttpError(409, "The spec writer is applying the review. Answer its questions, or wait.");
      }
      if (card.reviewApplying && !this.turns.has(session.id)) {
        this.db.updateCard(cardId, { reviewApplying: false });
        this.addNote(cardId, "spec", "The unfinished review is set aside. Press Review again when the spec is ready.");
        this.refreshSpec(cardId);
      }
    }

    this.addChat(cardId, card.lane, "you", text.trim());
    // A message sent while a question waits answers it instead of joining the turn.
    if (open && open.item.kind === "question") {
      const answers = Object.fromEntries(open.item.questions.map((q) => [q.question, text.trim()]));
      this.answer(open.id, { answers }, { alreadyInChat: true });
      return;
    }
    this.deliver(cardId, session.id, text.trim());
  }

  answer(itemId: string, body: AnswerBody, opts: { alreadyInChat?: boolean } = {}): void {
    const pending = this.db.getPending(itemId);
    if (!pending) throw new HttpError(404, "Nothing is waiting with that id.");
    if (pending.answered) throw new HttpError(409, "That has already been answered.");
    if (pending.item.kind === "question" && !isAnswers(body)) throw new HttpError(400, "Send answers.");
    if (pending.item.kind === "permission" && !("allow" in body)) throw new HttpError(400, "Send allow.");
    // A spec keeper question is asked in the lane the card is in, and plain code routes its answers.
    const keeperItem = pending.item.kind === "question" && !!pending.item.issueIds;
    const lane = keeperItem
      ? this.requireCard(pending.cardId).lane
      : this.db.getSession(pending.sessionId)?.lane ?? this.requireCard(pending.cardId).lane;
    if (keeperItem && this.anyTurnRunning(pending.cardId)) throw new HttpError(409, "Wait for the running turn to finish.");

    this.db.setPendingAnswer(itemId, body);
    this.deps.hub.emit({ type: "pending.updated", cardId: pending.cardId, pending: null });
    // Your answer stays in the chat however it was given, since the question card goes once it's answered.
    if (isAnswers(body) && !opts.alreadyInChat) {
      this.addChat(pending.cardId, lane, "you", summarizeAnswers(body.answers));
    }
    if (keeperItem && pending.item.kind === "question" && isAnswers(body)) {
      this.answerKeeper(pending.cardId, pending.item.questions, pending.item.issueIds!, body.answers);
      return;
    }

    const waiter = this.waiters.get(itemId);
    if (waiter) {
      this.waiters.delete(itemId);
      this.setState(pending.cardId, "working");
      waiter.resolve(body);
      return;
    }
    // The turn that asked is gone (a restart, or its canUseTool call was aborted): the answer goes to the session
    // as a message, joining a turn that is still running rather than starting a second one beside it.
    if (pending.item.kind === "question" && isAnswers(body)) {
      this.deliver(pending.cardId, pending.sessionId, answerAsMessage(pending.item.questions, body.answers));
    } else {
      this.setState(pending.cardId, "needs-you");
    }
  }

  async stop(cardId: string): Promise<void> {
    const card = this.requireCard(cardId);
    if (this.starting.has(cardId)) throw new HttpError(409, "Build is bringing in main. Stop once the developer runs.");
    // Build waits for a setup that is still listing files, before its turn starts: it ends as soon as it gets there.
    if (card.lane === "build" && card.setup?.status === "running") {
      const setup = this.db.getSessionFor(cardId, "refine", SETUP);
      if (!setup || !this.turns.has(setup.id)) this.setupStopped.add(cardId);
    }
    for (const session of this.cardSessions(cardId)) {
      const running = this.turns.get(session.id);
      if (!running) continue;
      this.stopping.add(session.id);
      await running.interrupt();
    }
  }

  retry(cardId: string): void | Promise<void> {
    const card = this.requireCard(cardId);
    this.refuseWhileMoving(cardId);
    if (this.anyTurnRunning(cardId)) throw new HttpError(409, "A turn is already running.");
    const last = this.db.lastChatItem(cardId, card.lane);
    if (!last || last.kind !== "error" || !last.actions.includes("retry")) {
      throw new HttpError(409, "There is no failed turn to retry.");
    }
    // A spec keeper turn that failed: the same message goes to the spec writer's session again.
    if (card.judging) {
      const writer = this.db.getSessionFor(cardId, "spec", LANE_ROLE.spec!);
      const { kind, issueIds } = card.judging;
      // A keeper message that couldn't be built (a broken role file): build it again.
      if (writer && !writer.lastMessage && kind !== "answers") {
        return this.startKeeper(cardId, kind, this.db.issuesFor(cardId).filter((i) => issueIds.includes(i.id)));
      }
      if (!writer?.lastMessage) throw new HttpError(409, "There is no spec keeper turn to retry.");
      this.startTurn(cardId, writer.id, writer.lastMessage, this.keeperOptions(card.judging));
      return;
    }
    // Every Retry in Ship starts the landing over (docs/specs/2026-11-27-ship-lane.md).
    if (card.lane === "ship") return this.land(cardId, {});
    if (card.lane === "check") {
      // A review is a fresh read: Retry starts a new reviewer for the same round.
      this.startReviewer(cardId);
      return;
    }
    if (card.lane === "build") {
      // A stored report whose checkpoint failed: redo only the checkpoint and the move, not the build.
      if (card.build) {
        void this.oneMoveAtATime(cardId, () => this.finishBuild(cardId))
          .catch((error: unknown) => this.log(`Finishing the build of card ${cardId} failed: ${String(error)}`));
        return;
      }
      // A developer that has had no turn yet in this visit: start it afresh, bringing in main again.
      const developer = this.db.getSessionFor(cardId, "build", LANE_ROLE.build!);
      if (!developer?.lastMessage) {
        void this.startDeveloper(cardId)
          .catch((error: unknown) => this.log(`Starting the developer of card ${cardId} failed: ${String(error)}`));
        return;
      }
    }
    const session = this.requireLaneSession(cardId);
    if (!session.lastMessage) throw new HttpError(409, "There is no failed turn to retry.");
    this.startTurn(cardId, session.id, session.lastMessage, this.turnOptions(session.role));
  }

  // ---------- the review gate ----------

  /** Start the blind review of the spec as it is on disk now (spec: Review). */
  review(cardId: string): void {
    const card = this.requireCard(cardId);
    if (card.lane !== "spec" || !card.specPath) throw new HttpError(409, "Only a spec can be reviewed.");
    this.refuseWhileMoving(cardId);
    if (this.anyTurnRunning(cardId)) throw new HttpError(409, "Wait for the running turn to finish.");
    if (card.reviewApplying) throw new HttpError(409, "The last review wasn't finished. Retry it first.");
    const { hash } = readSpec(card.worktreePath!, card.specPath);
    if (!hash) throw new HttpError(409, "There is no spec to review yet.");
    const reviewMd = join(this.deps.specFormatDir, "review.md");
    if (!existsSync(reviewMd)) throw new HttpError(409, `The review guide is missing: ${reviewMd}`);

    const role = this.deps.role(SPEC_REVIEWER);
    const sessionId = randomUUID();
    this.db.insertSession({ id: sessionId, cardId, lane: "spec", role: SPEC_REVIEWER, kind: role.kind });
    this.reviews.set(cardId, { sessionId, hash });
    this.startTurn(
      cardId,
      sessionId,
      `Review the spec at ${join(card.worktreePath!, card.specPath)}. Read ${reviewMd} and follow its "For the reviewer" part.`,
      this.turnOptions(SPEC_REVIEWER),
    );
    this.refreshSpec(cardId);
  }

  private onReviewEnded(cardId: string, outcome: TurnOutcome, stopped: boolean): void {
    const started = this.reviews.get(cardId);
    this.reviews.delete(cardId);
    const again = (message: string) => this.addError(cardId, "spec", message, ["review"]);
    if (stopped || (outcome.kind === "ok" && outcome.interrupted)) return again("The review was stopped. Press Review again.");
    if (outcome.kind === "error") return again(`The review failed: ${outcome.message}`);
    const report = parseReviewReport(outcome.report);
    if (!report) return again("The review didn't return a report.");
    if (report.status === "blocked") return again(`The reviewer couldn't review the spec: ${report.reason}`);

    const card = this.requireCard(cardId);
    const { hash } = readSpec(card.worktreePath!, card.specPath!);
    if (!started || hash !== started.hash) {
      this.addNote(cardId, "spec", "The spec changed during the review, so its findings may not fit. Press Review again.");
      return;
    }
    if (report.findings.length === 0) {
      this.db.updateCard(cardId, { reviewedSpecHash: hash });
      this.addNote(cardId, "spec", "The review found nothing to change. You can sign off.");
      return;
    }
    const fixes = report.findings.filter((f) => f.kind === "fix").length;
    const decisions = report.findings.length - fixes;
    this.addNote(cardId, "spec",
      `The review found ${count(fixes, "fix", "fixes")} and ${count(decisions, "decision", "decisions")}. ` +
        "The spec writer is applying them.");
    let options: ReturnType<Hive["turnOptions"]>;
    try {
      options = this.turnOptions(LANE_ROLE.spec!);
    } catch (error) {
      return again(`The review's findings can't be sent to the spec writer: ${(error as Error).message}`);
    }
    this.db.updateCard(cardId, { reviewApplying: true });
    const writer = this.db.getSessionFor(cardId, "spec", LANE_ROLE.spec!)!;
    // A start that fails (a role file broken since the review began) must not leave this turn-end handler early: the
    // reviewer's turn has already left `turns`, so its turn.ended still has to follow, with Review again to offer.
    try {
      this.startTurn(cardId, writer.id, findingsMessage(report.findings), options);
    } catch (error) {
      this.db.updateCard(cardId, { reviewApplying: false });
      return again(`The review's findings can't be sent to the spec writer: ${(error as Error).message}`);
    }
  }

  /** The spec writer's turn ended. If it was the review turn, only a finished one makes the spec reviewed. */
  private onWriterEnded(cardId: string, outcome: TurnOutcome, stopped: boolean, withdrew: boolean): void {
    const card = this.requireCard(cardId);
    if (!card.reviewApplying) return;
    const finished = outcome.kind === "ok" && !outcome.interrupted && !stopped && !withdrew;
    if (finished) {
      const { hash } = readSpec(card.worktreePath!, card.specPath!);
      this.db.updateCard(cardId, { reviewApplying: false, reviewedSpecHash: hash });
      this.addNote(cardId, "spec", "The review is applied. You can sign off.");
    } else {
      const why = outcome.kind === "error" ? `: ${outcome.message}` : ".";
      this.addError(cardId, "spec", `The review wasn't finished${why} Retry sends its findings again.`, ["retry"]);
    }
  }

  // ---------- the planner ----------

  private startPlanner(cardId: string): void {
    const card = this.requireCard(cardId);
    let planner = this.db.getSessionFor(cardId, "plan", LANE_ROLE.plan!);
    const again = !!planner;
    if (!planner) {
      const role = this.deps.role(LANE_ROLE.plan!);
      const id = randomUUID();
      this.db.insertSession({ id, cardId, lane: "plan", role: LANE_ROLE.plan!, kind: role.kind });
      planner = this.db.getSession(id)!;
    }
    const message = again
      ? `The spec was revised and signed off again: ${card.specPath}. Read it again and write the build plan as your report.`
      : `The spec for this card is signed off: ${card.specPath}. Read it and the code, and write the build plan as your report.`;
    this.startTurn(cardId, planner.id, message, this.turnOptions(LANE_ROLE.plan!));
  }

  private onPlannerEnded(cardId: string, outcome: TurnOutcome, stopped: boolean): void {
    const fail = (message: string, actions: LaneErrorAction<"plan">[]) => this.addError(cardId, "plan", message, actions);
    if (stopped || (outcome.kind === "ok" && outcome.interrupted)) return fail("The planner was stopped.", ["retry"]);
    if (outcome.kind === "error") return fail(`The planner failed: ${outcome.message}`, ["retry"]);
    const report = parsePlanReport(outcome.report);
    if (!report) return fail("The planner didn't return a plan.", ["retry", "back-to-spec"]);
    if (report.status === "blocked") {
      return fail(`The planner couldn't plan from this spec: ${report.reason}`, ["retry", "back-to-spec"]);
    }
    // A new plan starts Check's rounds over.
    this.db.updateCard(cardId, { plan: report.plan, lane: laneAfterPlan("done"), check: null });
    this.db.addEvent(cardId, "plan", report.plan, randomUUID());
    this.deps.hub.emit({ type: "plan.updated", cardId, plan: report.plan });
    this.emitCard(cardId);
    void this.startDeveloper(cardId)
      .catch((error: unknown) => this.log(`Starting the developer of card ${cardId} failed: ${String(error)}`));
  }

  // ---------- the worktree's setup ----------

  /**
   * A setup run for the card's worktree, in the background: the card's ports, the checkout's local files to choose
   * from, and a new setup session (docs/specs/2026-11-27-worktree-setup-and-try-it.md, Setup).
   */
  private async startSetup(cardId: string): Promise<void> {
    if (this.gone(cardId)) return;
    const card = this.requireCard(cardId);
    if (!card.worktreePath || card.setup?.status === "running") return;
    const project = this.db.getProject(card.projectId)!;
    // A re-run that fails keeps the setup that worked before it.
    if (card.setup?.status === "done") this.previousSetup.set(cardId, card.setup);
    else this.previousSetup.delete(cardId);
    // Marked running at once, so a second start (Build entry, a button) waits for this one instead of racing it.
    this.setSetup(cardId, noSetup());
    this.setupStopped.delete(cardId);
    try {
      // The setup checks its commands on the card's ports, where the app would be running.
      if (card.lane === "tryit") await this.apps.stop(cardId);
      const role = this.deps.role(SETUP);
      if (card.port === null && (await this.assignPort(cardId)) === null) {
        return this.endSetup(cardId, { reason: "No free ports: every block of 10 in 5200–5999 is taken by a card." });
      }
      const local = await this.deps.git.listLocalFiles(project.path);
      if (this.gone(cardId)) return;
      // What wasn't copied: the candidates first, as the ones worth a look, then the junk. `.claude/` holds the hive's
      // own worktrees and your Claude settings, and is never worth naming.
      const junk = local.junk.filter((j) => j !== ".claude/" && !j.startsWith(".claude/"));
      this.setSetup(cardId, { ...noSetup(), leftOut: [...local.candidates.map((c) => c.path), ...junk] });
      // Stop was pressed while Build waited and the files were still being listed: no turn to interrupt yet.
      if (this.setupStopped.delete(cardId)) return this.endSetup(cardId, { reason: "It was stopped." });
      const id = randomUUID();
      this.db.insertSession({ id, cardId, lane: "refine", role: SETUP, kind: role.kind });
      const port = this.requireCard(cardId).port!;
      this.startTurn(cardId, id, [
        "Set up this card's worktree so it runs like the person's checkout, without stepping on it.",
        "",
        `The checkout: ${project.path}`,
        `This worktree: ${card.worktreePath}`,
        `The card's ports: ${portRange(port)}`,
        "",
        "Git-ignored entries in the checkout you may copy, with their sizes:",
        list(local.candidates.map((c) => `${c.path} (${human(c.bytes)})`)),
        "",
        junk.length ? `Left out already as junk: ${some(junk)}.` : "Nothing was left out as junk.",
        "",
        "End with your report.",
      ].join("\n"), this.turnOptions(SETUP));
    } catch (error) {
      if (this.gone(cardId)) return;
      this.endSetup(cardId, { reason: sentence((error as Error).message) });
    }
  }

  /**
   * Gives the card a free block of ports, one card at a time: two setups starting together would otherwise both read
   * the same blocks as free while the other's lsof checks were still running.
   */
  private assignPort(cardId: string): Promise<number | null> {
    const next = this.portQueue.then(async () => {
      const card = this.requireCard(cardId);
      if (card.port !== null) return card.port;
      const taken = this.db.listCards().map((c) => c.port).filter((p): p is number => p !== null);
      const port = await this.ports.assign(taken);
      if (port !== null) this.db.updateCard(cardId, { port });
      return port;
    });
    this.portQueue = next.catch(() => undefined);
    return next;
  }

  /** The copy tool's work: the hive's code copies, under the guards, and keeps track of what's in the worktree. */
  private async copyLocalFiles(cardId: string, paths: string[]): Promise<string> {
    const card = this.requireCard(cardId);
    const project = this.db.getProject(card.projectId)!;
    const outcomes = await this.deps.git.copyLocalFiles(project.path, card.worktreePath!, paths);
    const present = new Set(outcomes.filter((o) => o.result !== "refused").map((o) => bare(o.path)));
    const setup = this.requireCard(cardId).setup ?? noSetup();
    const copied = [...setup.copied, ...setup.leftOut.filter((p) => present.has(bare(p)))];
    // A path inside a listed folder (data/dev.db out of data/) isn't in the list, but it is in the worktree now.
    for (const o of outcomes) {
      if (o.result !== "refused" && !copied.some((c) => bare(c) === bare(o.path))) copied.push(o.path);
    }
    this.setSetup(cardId, { ...setup, copied, leftOut: setup.leftOut.filter((p) => !present.has(bare(p))) });
    return outcomes
      .map((o) => o.result === "copied" ? `${o.path}: copied (${count(o.files, "file", "files")})`
        : o.result === "kept" ? `${o.path}: kept (already in the worktree)`
          : `${o.path}: refused (${o.reason ?? "no reason given"})`)
      .join("\n");
  }

  private onSetupEnded(cardId: string, sessionId: string, outcome: TurnOutcome, stopped: boolean): void {
    clearTimeout(this.setupTimers.get(sessionId));
    this.setupTimers.delete(sessionId);
    const timedOut = this.timedOut.delete(sessionId);
    if (timedOut) return this.endSetup(cardId, { reason: "It ran longer than 10 minutes and was stopped." });
    if (stopped || (outcome.kind === "ok" && outcome.interrupted)) return this.endSetup(cardId, { reason: "It was stopped." });
    if (outcome.kind === "error") return this.endSetup(cardId, { reason: `It failed: ${sentence(outcome.message)}` });
    const report = parseSetupReport(outcome.report);
    if (!report) return this.endSetup(cardId, { reason: "It didn't return a report." });
    if (report.status === "blocked") return this.endSetup(cardId, { reason: sentence(report.reason) });
    this.endSetup(cardId, { done: { ...report, start: report.start.map((s) => ({ ...s, url: openableUrl(s.url) })) } });
  }

  /** A setup ends done or failed: stored, noted in the card's current lane, and Build goes on if it was waiting. */
  private endSetup(
    cardId: string,
    end: { reason: string } | { done: Extract<ReturnType<typeof parseSetupReport>, { status: "done" }> },
    { continueBuild = true } = {},
  ): void {
    const card = this.requireCard(cardId);
    const previous = this.previousSetup.get(cardId);
    this.previousSetup.delete(cardId);
    if (!("done" in end) && previous) {
      // Preparing it again didn't finish: the setup that worked stays, commands and all.
      this.setSetup(cardId, previous);
      this.addNote(cardId, card.lane, `Preparing the worktree again didn't finish: ${end.reason} The earlier setup stays.`);
      if (card.lane === "tryit" && !card.appStopped) {
        void this.startApp(cardId).catch((error: unknown) => this.log(`Starting the app of card ${cardId} failed: ${String(error)}`));
      }
      if (continueBuild && card.lane === "build" && !this.starting.has(cardId)) {
        const developer = this.db.getSessionFor(cardId, "build", LANE_ROLE.build!);
        if (!developer?.lastMessage) {
          void this.startDeveloper(cardId)
            .catch((error: unknown) => this.log(`Starting the developer of card ${cardId} failed: ${String(error)}`));
        }
      }
      return;
    }
    const was = card.setup ?? noSetup();
    const setup: SetupReport = "done" in end
      ? { ...was, ...end.done, status: "done", reason: null }
      : { ...was, status: "failed", reason: end.reason };
    this.setSetup(cardId, setup);
    this.db.addEvent(cardId, "setup", setup, randomUUID());
    const note = setup.status === "done"
      ? [
          "The worktree is set up.",
          setup.copied.length ? `Copied: ${some(setup.copied)}.` : "No local files were copied.",
          setup.leftOut.length ? `Left out: ${some(setup.leftOut)}.` : "",
          setup.shared.length ? `Shared with your checkout: ${setup.shared.join("; ")}.` : "",
        ].filter(Boolean).join(" ")
      : `The worktree's setup didn't finish: ${setup.reason} The developer installs what it needs itself.`;
    this.addNote(cardId, card.lane, note);
    // In Try it, the app starts again with the new commands, unless you stopped it.
    if (setup.status === "done" && card.lane === "tryit" && !card.appStopped) {
      void this.startApp(cardId).catch((error: unknown) => this.log(`Starting the app of card ${cardId} failed: ${String(error)}`));
    }
    // Build waited for this setup: the developer starts now, whether it finished or not.
    const developer = this.db.getSessionFor(cardId, "build", LANE_ROLE.build!);
    if (continueBuild && card.lane === "build" && !developer?.lastMessage && !this.starting.has(cardId)) {
      void this.startDeveloper(cardId)
        .catch((error: unknown) => this.log(`Starting the developer of card ${cardId} failed: ${String(error)}`));
    }
  }

  private setSetup(cardId: string, setup: SetupReport): void {
    this.db.updateCard(cardId, { setup });
    this.deps.hub.emit({ type: "setup.updated", cardId, setup, port: this.requireCard(cardId).port });
  }

  /** Set up the worktree again, from Try it's button: new files are copied, existing ones kept. */
  setupAgain(cardId: string): void {
    const card = this.requireCard(cardId);
    if (!card.worktreePath) throw new HttpError(409, "This card has no worktree yet.");
    if (card.setup?.status === "running") throw new HttpError(409, "The worktree is being set up already.");
    void this.startSetup(cardId).catch((error: unknown) => this.log(`Setting up card ${cardId} failed: ${String(error)}`));
  }

  /**
   * Stops what still listens on the card's ports from inside its worktree, as the card leaves Build, Check or Try it,
   * before the next lane's work starts. A failure is logged; it never holds up the move.
   */
  private async stopCardServers(cardId: string, leaving: Lane): Promise<void> {
    const card = this.requireCard(cardId);
    if (card.port === null || !card.worktreePath) return;
    try {
      const stopped = await this.ports.stopListeners(cardPorts(card.port), card.worktreePath);
      const ports = [...new Set(stopped.map((s) => s.port))];
      if (ports.length) this.addNote(cardId, leaving, `Stopped what was running on ${ports.join(" and ")}.`);
    } catch (error) {
      this.log(`Stopping the servers of card ${cardId} failed: ${String(error)}`);
    }
  }

  // ---------- the card's app in Try it ----------

  /**
   * Starts whatever of the card's app isn't running, after sweeping the ports it's about to use, so a copy you
   * started by hand, or a leftover, can't pass for it (docs/specs/2026-11-27-try-it-runs-the-app.md).
   */
  private async startApp(cardId: string): Promise<void> {
    if (this.gone(cardId)) return;
    const card = this.requireCard(cardId);
    if (card.lane !== "tryit" || card.setup?.status !== "done" || !card.worktreePath) return;
    const entries = appEntries(card);
    const live = new Set(this.apps.livePorts(cardId));
    const sweep = entries.filter((e) => !e.refused && e.port !== null && !live.has(e.port)).map((e) => e.port!);
    if (sweep.length) {
      try {
        await this.ports.stopListeners(sweep, card.worktreePath);
      } catch (error) {
        this.log(`Clearing the ports of card ${cardId} failed: ${String(error)}`);
      }
    }
    // It moved on, or you pressed Stop, while the ports were cleared.
    if (this.gone(cardId)) return;
    const now = this.requireCard(cardId);
    if (now.lane !== "tryit" || now.appStopped) return;
    this.apps.start(cardId, entries, card.worktreePath, (kind) => this.appChanged(cardId, kind));
  }

  /** A change of state goes to the page at once; output at most once a second. */
  private appChanged(cardId: string, kind: "state" | "output"): void {
    if (kind === "output") {
      if (this.appTimers.has(cardId)) return;
      const timer = setTimeout(() => {
        this.appTimers.delete(cardId);
        this.emitApps(cardId);
      }, 1000);
      timer.unref?.();
      this.appTimers.set(cardId, timer);
      return;
    }
    clearTimeout(this.appTimers.get(cardId));
    this.appTimers.delete(cardId);
    this.emitApps(cardId);
  }

  private emitApps(cardId: string): void {
    try {
      const card = this.db.getCard(cardId);
      if (!card) return;
      const apps = card.lane === "tryit" ? this.apps.status(cardId) : [];
      this.deps.hub.emit({ type: "app.updated", cardId, apps, appStopped: card.appStopped });
    } catch (error) {
      this.log(`Sending the app status of card ${cardId} failed: ${String(error)}`);
    }
  }

  private requireAppLane(cardId: string, needsSetup: boolean): CardRow {
    const card = this.requireCard(cardId);
    if (card.lane !== "tryit") throw new HttpError(409, "The card's app runs only in Try it.");
    if (needsSetup && card.setup?.status !== "done") throw new HttpError(409, "Prepare the worktree first.");
    return card;
  }

  /** Start: whatever isn't running, and your Stop is forgotten. */
  async appStart(cardId: string): Promise<void> {
    this.requireAppLane(cardId, true);
    this.db.updateCard(cardId, { appStopped: false });
    await this.startApp(cardId);
  }

  /** Stop: everything, and remembered, so a hive restart or a finished setup leaves it stopped. */
  async appStop(cardId: string): Promise<void> {
    this.requireAppLane(cardId, false);
    await this.apps.stop(cardId);
    this.db.updateCard(cardId, { appStopped: true });
    this.emitApps(cardId);
  }

  async appRestart(cardId: string): Promise<void> {
    this.requireAppLane(cardId, true);
    this.db.updateCard(cardId, { appStopped: false });
    await this.apps.stop(cardId);
    await this.startApp(cardId);
  }

  // ---------- Try it ----------

  /** Your words from Try it go to the same developer; Check then starts over (spec: Try it, Send to Build). */
  async feedback(cardId: string, body: FeedbackBody): Promise<CardSummary> {
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (body.lane !== undefined && body.lane !== "build") throw new HttpError(400, "Only Build takes feedback for now.");
    const card = this.requireCard(cardId);
    const to = laneAfter(card.lane, "feedback");
    if (!to) throw new HttpError(409, "Only a card in Try it can be sent back with feedback.");
    if (this.anyTurnRunning(cardId)) throw new HttpError(409, "Wait for the running turn to finish.");
    this.refuseWhileKeeperAsks(cardId);
    // Your Change the code answers wait for Send to Build, and go with your feedback
    // (docs/specs/2026-11-28-spec-keeper.md, Your answer in Try it).
    const held = this.db.issuesFor(cardId).filter((i) => i.status === "held");
    if (!text && held.length === 0) throw new HttpError(400, "Write what's wrong first.");
    return this.oneMoveAtATime(cardId, async () => {
      await this.apps.clear(cardId);
      const developer = this.db.getSessionFor(cardId, "build", LANE_ROLE.build!);
      this.db.transaction(() => {
        this.db.updateCard(cardId, {
          lane: to, build: null, check: null, feedback: text || null, appStopped: false, shipAfterCheck: false,
          keeperFixes: held.length ? { from: "tryit", ids: held.map((i) => i.id) } : null,
        });
        this.db.setIssueStatus(held.map((i) => i.id), "sent");
        if (developer) this.db.updateSession(developer.id, { lastMessage: null });
        if (text) this.db.addEvent(cardId, "feedback", { text }, randomUUID());
      });
      this.emitCard(cardId);
      void this.startDeveloper(cardId)
        .catch((error: unknown) => this.log(`Starting the developer of card ${cardId} failed: ${String(error)}`));
      return cardSummary(this.requireCard(cardId));
    });
  }

  /** You accept the card: it goes on to Ship. */
  async accept(cardId: string): Promise<CardSummary> {
    const card = this.requireCard(cardId);
    const to = laneAfter(card.lane, "accept");
    if (!to) throw new HttpError(409, "Only a card in Try it can be accepted.");
    if (this.anyTurnRunning(cardId)) throw new HttpError(409, "Wait for the running turn to finish.");
    this.refuseWhileKeeperAsks(cardId);
    if (this.db.issuesFor(cardId).some((i) => i.status === "held")) {
      throw new HttpError(409, "You asked for code changes. Send them to Build first.");
    }
    return this.oneMoveAtATime(cardId, async () => {
      await this.apps.clear(cardId);
      await this.stopCardServers(cardId, "tryit");
      this.db.updateCard(cardId, { lane: to, appStopped: false });
      this.db.addEvent(cardId, "accept", {}, randomUUID());
      this.emitCard(cardId);
      return cardSummary(this.requireCard(cardId));
    });
  }

  /** Out of Ship, until Ship is built, so a misclick or a late bug doesn't strand the card. */
  async backToTryIt(cardId: string): Promise<CardSummary> {
    const card = this.requireCard(cardId);
    const to = laneAfter(card.lane, "back-to-tryit");
    if (!to) throw new HttpError(409, "Only a card in Ship can go back to Try it.");
    if (this.landingProjects.get(card.projectId) === cardId) throw new HttpError(409, "The card is landing.");
    return this.oneMoveAtATime(cardId, async () => {
      // A line in Ship's chat, so a failed landing's error isn't what the card reads as when it comes back.
      this.addNote(cardId, "ship", "Back to Try it.");
      this.db.updateCard(cardId, { lane: to, shipAfterCheck: false });
      this.emitCard(cardId);
      void this.startApp(cardId).catch((error: unknown) => this.log(`Starting the app of card ${cardId} failed: ${String(error)}`));
      return cardSummary(this.requireCard(cardId));
    });
  }

  // ---------- Ship ----------

  /** What Land on main would do now, for the Ship page (docs/specs/2026-11-27-ship-lane.md, The page). */
  async shipPlan(cardId: string): Promise<ShipPlan> {
    const card = this.requireCard(cardId);
    if (card.lane !== "ship") throw new HttpError(409, "Only a card in Ship has a landing to plan.");
    const root = this.db.getProject(card.projectId)!.path;
    const origin = await this.deps.git.hasOrigin(root);
    const test = this.landingTests(card);
    const where = origin ? null : await this.deps.git.mainCheckout(root);
    const landing = this.landingProjects.get(card.projectId);
    return {
      base: origin ? "origin/main" : "main",
      uncommitted: card.worktreePath ? await this.deps.git.worktreeStatus(card.worktreePath) : [],
      unpushed: origin ? await this.deps.git.unpushedCount(root) : 0,
      tests: test.command,
      noTestsReason: test.why,
      checkoutBlocks: !!where?.dirty,
      busy: landing !== undefined && landing !== cardId,
    };
  }

  /** The test command that runs on the squash, or why none will. */
  private landingTests(card: CardRow): { command: string | null; why: string | null } {
    if (card.setup?.status !== "done") return { command: null, why: "the worktree has no finished setup" };
    if (!card.setup.test.trim()) return { command: null, why: "the setup found no test command" };
    return { command: card.setup.test.trim(), why: null };
  }

  /**
   * Land on main is your approval: the checks that need nothing but git are made at once, so a refusal reaches the
   * page; the rest runs in the background, step by step in Ship's history (docs/specs/2026-11-27-ship-lane.md).
   */
  async land(cardId: string, body: LandBody): Promise<void> {
    const card = this.requireCard(cardId);
    if (card.lane !== "ship" || !card.worktreePath || !card.branch) {
      throw new HttpError(409, "Only a card in Ship can land on main.");
    }
    this.refuseWhileMoving(cardId);
    if (this.anyTurnRunning(cardId)) throw new HttpError(409, "Wait for the running turn to finish.");
    if (this.landingProjects.has(card.projectId)) throw new HttpError(409, "A card of this project is landing already.");
    const root = this.db.getProject(card.projectId)!.path;
    const discard = body?.discard === true;
    // Claimed before the git checks below, so a second press (or another card) can't pass them while they run.
    this.landingProjects.set(card.projectId, cardId);
    let origin: boolean;
    try {
      const uncommitted = await this.deps.git.worktreeStatus(card.worktreePath);
      if (uncommitted.length > 0 && !discard) {
        throw new HttpError(409, "The card's worktree has uncommitted work that wouldn't land. Discard it, or send the card back.");
      }
      origin = await this.deps.git.hasOrigin(root);
      const unpushed = origin ? await this.deps.git.unpushedCount(root) : 0;
      if (unpushed > 0) {
        throw new HttpError(409,
          `Your local main has ${count(unpushed, "commit", "commits")} that ${unpushed === 1 ? "isn't" : "aren't"} on origin. ` +
          "Push them first, then press Land on main.");
      }
      if (!origin && (await this.deps.git.mainCheckout(root))?.dirty) {
        throw new HttpError(409, "Your checkout has main checked out with uncommitted changes, and without a remote main " +
          "can only move through it. Commit or stash them, then press Land on main again.");
      }
    } catch (error) {
      if (this.landingProjects.get(card.projectId) === cardId) this.landingProjects.delete(card.projectId);
      throw error;
    }
    this.setState(cardId, "working");
    void this.landFlow(cardId, { discard, origin })
      .catch((error: unknown) => this.log(`Landing card ${cardId} failed: ${String(error)}`))
      .finally(() => {
        if (this.landingProjects.get(card.projectId) === cardId) this.landingProjects.delete(card.projectId);
        try {
          // A card sent back to Build has its developer starting; anything else waits for you.
          if (!this.anyTurnRunning(cardId)) this.setState(cardId, "needs-you");
        } catch {
          // the database closed under a test
        }
      });
  }

  private async landFlow(cardId: string, opts: { discard: boolean; origin: boolean }): Promise<void> {
    const card = this.requireCard(cardId);
    const root = this.db.getProject(card.projectId)!.path;
    const worktree = card.worktreePath!;
    const branch = card.branch!;
    const note = (text: string) => this.addNote(cardId, "ship", text);
    // A landing left from a cut-off run may have left the worktree detached on its commit: put it back on any way out.
    let switched = card.landing !== null;
    // Every way out that isn't a landing puts the worktree back on the card's branch and forgets the commit.
    const stop = async (message: string, actions: LaneErrorAction<"ship">[] = ["retry"]) => {
      if (switched) await this.deps.git.switchWorktree(worktree, { branch }).catch(() => undefined);
      this.db.updateCard(cardId, { landing: null });
      this.addError(cardId, "ship", message, actions);
    };
    try {
      if (opts.discard) {
        await this.deps.git.discardChanges(worktree);
        note("Discarded the uncommitted work in the card's worktree.");
      }
      let message: string | null = null;
      for (let attempt = 1; ; attempt++) {
        const base = await this.deps.git.mainBase(root);
        if (opts.origin && base.fetchFailed) {
          return await stop(`Couldn't fetch origin: ${sentence(base.fetchFailed)} Nothing reached main.`);
        }
        const squash = await this.deps.git.squashTree(root, base.ref, branch);
        if (squash.kind === "conflict") {
          if (switched) await this.deps.git.switchWorktree(worktree, { branch });
          return this.shipToBuild(cardId,
            `Landing on main stopped on conflicts with ${base.ref} in ${squash.files.join(", ")}. Bring ${base.ref} in and resolve them.`);
        }
        if (squash.kind === "same") {
          note(`The card's changes are already on ${base.ref}.`);
          const checkout = opts.origin ? await this.deps.git.moveLocalMain(root, squash.base) : "updated";
          return await this.finishLanding(cardId, {
            commit: squash.base, subject: "(already on main)", base: base.ref, remote: opts.origin, checkout,
          });
        }
        message ??= await this.commitMessage(this.requireCard(cardId), root, base.ref, squash.tree);
        const commit = await this.deps.git.commitTree(root, squash.tree, squash.base, message);
        this.db.updateCard(cardId, { landing: { base: base.ref, commit, pushed: false } });
        note(`Squashed onto ${base.ref} as ${commit.slice(0, 7)}.`);

        const test = this.landingTests(this.requireCard(cardId));
        if (test.command) {
          await this.deps.git.switchWorktree(worktree, { commit });
          switched = true;
          note(`Running the tests on it: ${test.command}`);
          const result = await runToEnd(test.command, worktree, 10 * 60_000);
          if (!result.ok) {
            const tail = result.output.slice(-30).join("\n");
            return await stop(`The tests failed on the squash. ${result.reason}${tail ? `\n\n${tail}` : ""}`, ["retry", "back-to-build"]);
          }
          note("The tests passed.");
        } else {
          note(`No tests ran: ${test.why}.`);
        }

        if (opts.origin) {
          const push = await this.deps.git.pushMain(root, commit);
          if (push.kind === "moved") {
            if (attempt >= 3) return await stop("Main kept moving: the push was refused 3 times. Nothing reached main.");
            note("Main moved on meanwhile. Squashing again.");
            continue;
          }
          if (push.kind === "failed") return await stop(`The push was refused: ${sentence(push.reason)} Nothing reached main.`);
          note(`Pushed to origin/main as ${commit.slice(0, 7)}.`);
        } else {
          const moved = await this.deps.git.moveLocalMain(root, commit);
          if (moved !== "updated") {
            return await stop(`Your main couldn't move: ${moved}. Commit or stash your changes, then press Land on main again.`);
          }
          note(`Moved main to ${commit.slice(0, 7)}.`);
        }
        this.db.updateCard(cardId, { landing: { base: base.ref, commit, pushed: true } });
        const checkout = opts.origin ? await this.deps.git.moveLocalMain(root, commit) : "updated";
        return await this.finishLanding(cardId, {
          commit, subject: message.split("\n")[0]!, base: base.ref, remote: opts.origin, checkout,
        });
      }
    } catch (error) {
      if (this.requireCard(cardId).landing?.pushed) {
        this.log(`Finishing the landing of card ${cardId} failed: ${String(error)}`);
        return;
      }
      await stop(`Landing stopped: ${sentence((error as Error).message)} Nothing reached main.`);
    }
  }

  /**
   * The commit message, in the repo's style, from a short one-off session; the hive adds the Spec and Hive-Card lines.
   * A session that fails, reports nothing, or runs past 3 minutes gives way to a message from the card.
   */
  private async commitMessage(card: CardRow, root: string, baseRef: string, tree: string): Promise<string> {
    const trailers = `${card.specPath ? `Spec: ${card.specPath}\n` : ""}Hive-Card: ${card.id}`;
    const fallback = (why: string) => {
      this.addNote(card.id, "ship", `The commit message was written from the card: ${why}`);
      const spec = card.specPath && card.worktreePath ? readSpec(card.worktreePath, card.specPath).text : null;
      const bullet = spec?.split("**What you get:**")[1]?.split("\n").find((l) => l.trim().startsWith("- "));
      const line = bullet?.trim().replace(/^- /, "").replace(/\*\*/g, "");
      return [card.title, ...(line ? ["", line] : []), "", trailers].join("\n");
    };
    let role: Role;
    try {
      role = this.deps.role("committer");
    } catch (error) {
      return fallback(sentence((error as Error).message));
    }
    const [stat, recent] = await Promise.all([
      this.deps.git.diffStat(root, baseRef, tree),
      this.deps.git.recentMessages(root, baseRef, 15),
    ]);
    const message = [
      "Write the commit message for this card. It lands on main as one commit.",
      "",
      `The card: ${card.title}`,
      `Its spec: ${card.specPath ?? "(none)"}. Read its Outcome.`,
      "",
      "The changes:",
      stat || "(none listed)",
      "",
      "The last commit messages on main, for the repo's style:",
      ...recent.flatMap((m) => ["---", m]),
      "---",
      "",
      "Return the subject and the body in that style. Don't add Spec: or Hive-Card: lines; the hive adds them.",
    ].join("\n");
    const turn = this.deps.runner.start(
      {
        sessionId: randomUUID(), resume: false, cwd: card.worktreePath!, role, message,
        outputFormat: ROLE_TURNS.committer!.report!, persist: false,
      },
      {
        onTextDelta: () => {}, onTextBlock: () => {}, onActivity: () => {}, onChecklist: () => {},
        onSessionCreated: () => {},
        canUseTool: async (toolName, input) => toolName === "AskUserQuestion"
          ? { behavior: "deny", message: "Nobody is there to answer. Decide, and write the message." }
          : { behavior: "allow", updatedInput: input },
      },
    );
    const timer = setTimeout(() => void turn.interrupt(), 3 * 60_000);
    timer.unref?.();
    let outcome: TurnOutcome;
    try {
      outcome = await turn.done;
    } catch (error) {
      outcome = { kind: "error", message: (error as Error).message };
    } finally {
      clearTimeout(timer);
    }
    if (outcome.kind === "error") return fallback(sentence(outcome.message));
    const report = parseCommitReport(outcome.report);
    if (!report) return fallback(outcome.interrupted ? "the session took longer than 3 minutes." : "the session returned no message.");
    return [report.subject, ...(report.body ? ["", report.body] : []), "", trailers].join("\n");
  }

  /** The card is on main: its app stopped, its worktree and branch removed, its ports freed, and on to Done. */
  private async finishLanding(cardId: string, landed: Landed): Promise<void> {
    const card = this.requireCard(cardId);
    const root = this.db.getProject(card.projectId)!.path;
    // The commit is on main: a failed clean-up is a note, and the card still goes to Done.
    try {
      await this.apps.clear(cardId);
      await this.stopCardServers(cardId, "ship");
    } catch (error) {
      this.addNote(cardId, "ship", `The card's app couldn't be stopped: ${sentence((error as Error).message)}`);
    }
    if (card.worktreePath && card.branch) {
      try {
        await this.deps.git.removeCardWorktree(root, card.worktreePath, card.branch);
      } catch (error) {
        this.addNote(cardId, "ship", `The card's worktree and branch couldn't be removed: ${sentence((error as Error).message)}`);
      }
    }
    const checkout = landed.checkout === "updated"
      ? "updated"
      : `behind ${landed.base}: ${landed.checkout}. Bring it up to date when you're ready`;
    this.addNote(cardId, "ship", `Landed on ${landed.base} as ${landed.commit.slice(0, 7)}.`);
    this.db.transaction(() => {
      this.db.updateCard(cardId, {
        lane: laneAfterLanding("landed"), landed: { ...landed, checkout }, landing: null, port: null, worktreePath: null,
        shipAfterCheck: false,
      });
      this.db.addEvent(cardId, "landed", { ...landed, checkout }, randomUUID());
    });
    this.emitCard(cardId);
  }

  /** Ship sends the card back to Build: the developer gets why, and after Check the card returns to Ship. */
  private shipToBuild(cardId: string, text: string): void {
    const developer = this.db.getSessionFor(cardId, "build", LANE_ROLE.build!);
    this.addNote(cardId, "ship", `Back to Build: ${text}`);
    this.db.transaction(() => {
      this.db.updateCard(cardId, {
        lane: laneAfterLanding("conflict"), build: null, check: null, feedback: text, shipAfterCheck: true, landing: null,
      });
      if (developer) this.db.updateSession(developer.id, { lastMessage: null });
    });
    this.emitCard(cardId);
    void this.startDeveloper(cardId)
      .catch((error: unknown) => this.log(`Starting the developer of card ${cardId} failed: ${String(error)}`));
  }

  /** After a restart: a landing that reached main is finished; any other is undone; without origin, nothing is said. */
  private async recoverLanding(cardId: string): Promise<void> {
    const card = this.requireCard(cardId);
    const landing = card.landing!;
    const root = this.db.getProject(card.projectId)!.path;
    const origin = await this.deps.git.hasOrigin(root);
    if (origin && (await this.deps.git.mainBase(root)).fetchFailed) {
      this.addError(cardId, "ship", "Landing was cut off, and the hive couldn't reach origin to see how far it got.", ["retry"]);
      return;
    }
    if (await this.deps.git.isOn(root, landing.commit, landing.base)) {
      const checkout = origin ? await this.deps.git.moveLocalMain(root, landing.commit) : "updated";
      return this.finishLanding(cardId, {
        commit: landing.commit, subject: "(landed before the hive restarted)", base: landing.base, remote: origin, checkout,
      });
    }
    if (card.worktreePath && card.branch) {
      await this.deps.git.switchWorktree(card.worktreePath, { branch: card.branch }).catch(() => undefined);
    }
    this.db.updateCard(cardId, { landing: null });
    this.addError(cardId, "ship", "Landing was cut off. Nothing reached main.", ["retry"]);
  }

  // ---------- the developer ----------

  /**
   * Each entry to Build: stop what the lane being left still runs on the card's ports, wait for the worktree's setup,
   * bring in main, then start the developer, or resume it with your Try it feedback, the bugs Check found, or the
   * revised spec and plan. Why the card is entering Build is read from what's stored, so Retry and a restart get it
   * right too: `Card.feedback` is set only between Send to Build and the developer's next `done` report, and
   * `Card.check` holding bugs only ever means the card came back from Check, since a new plan and your feedback clear
   * it and a round without bugs moves the card on. Whatever bringing in main did is told to the developer; there is no
   * separate error path for it.
   */
  private async startDeveloper(cardId: string): Promise<void> {
    if (this.gone(cardId)) return;
    const roleName = LANE_ROLE.build!;
    this.starting.add(cardId);
    this.setState(cardId, "working");
    this.deps.hub.emit({ type: "turn.started", cardId }); // so a start with no lane change shows the line during the merge
    try {
      const entering = this.requireCard(cardId);
      const feedback = entering.feedback;
      // Code fixes from the spec keeper, or your held Change the code answers (docs/specs/2026-11-28-spec-keeper.md,
      // Back to the developer).
      const fixes = entering.keeperFixes;
      const fixIssues = fixes ? this.db.issuesFor(cardId).filter((i) => fixes.ids.includes(i.id)) : [];
      const fromCheck = !feedback && !fixes && entering.check && entering.check.bugs.length > 0 ? entering.check : null;
      if (feedback || fromCheck || fixes) {
        await this.stopCardServers(cardId,
          feedback ? (entering.shipAfterCheck ? "ship" : "tryit") : fixes ? fixes.from : "check");
      }

      // A new visit starts without a report (Card.build is set only between a done report and the move to Check),
      // and without a last message: until this visit's first turn starts, Retry starts the developer afresh,
      // bringing in main again, instead of re-sending an earlier visit's message with its old plan. Cleared before
      // waiting for setup, so the setup's end sees a developer that hasn't started this visit.
      // A new visit also gets its own keeper turn for a blocked report (A blocked build).
      this.db.updateCard(cardId, { build: null, blockJudged: false });
      const existing = this.db.getSessionFor(cardId, "build", roleName);
      if (existing) this.db.updateSession(existing.id, { lastMessage: null });

      // Build waits for the worktree's setup: one still running, or the first one for a worktree that never had one.
      // While it waits, the setup counts as the card's running turn, so the badge shows working and Stop ends it.
      if (entering.worktreePath && (entering.setup === null || entering.setup.status === "running")) {
        this.addNote(cardId, "build", "Build waits for the worktree's setup. Stop ends it, and Build goes ahead.");
        this.deps.hub.emit({ type: "turn.started", cardId });
        if (entering.setup === null) {
          void this.startSetup(cardId).catch((error: unknown) => this.log(`Setting up card ${cardId} failed: ${String(error)}`));
        }
        return;
      }

      const role = this.deps.role(roleName); // a broken role file fails here, before the merge
      const card = this.requireCard(cardId);
      if (feedback) this.addNote(cardId, "build", `Sent back from ${card.shipAfterCheck ? "Ship" : "Try it"}: ${feedback}`);
      if (fixIssues.length) {
        this.addNote(cardId, "build", fixes!.from === "tryit"
          ? `You asked for ${count(fixIssues.length, "code change", "code changes")} on the spec keeper's questions. The developer is making them.`
          : `The spec keeper sent ${count(fixIssues.length, "code fix", "code fixes")}. The developer is making them.`);
      }
      if (fromCheck) {
        this.addNote(cardId, "build",
          `Check round ${fromCheck.round} found ${count(fromCheck.bugs.length, "bug", "bugs")}. The developer is fixing them.`);
      }
      const base = await this.deps.git.mainBase(this.db.getProject(card.projectId)!.path);
      if (base.fetchFailed) this.addNote(cardId, "build", `Couldn't fetch origin: ${sentence(base.fetchFailed)} Using the last fetched ${base.ref}.`);
      const merge = await this.deps.git.mergeMain(card.worktreePath!, base.ref);
      if (this.gone(cardId)) return;
      this.addNote(cardId, "build", mergeNote(merge, base.ref));
      let developer = this.db.getSessionFor(cardId, "build", roleName);
      const again = !!developer?.existsYet;
      if (!developer) {
        const id = randomUUID();
        this.db.insertSession({ id, cardId, lane: "build", role: roleName, kind: role.kind });
        developer = this.db.getSession(id)!;
        // The checklist is the developer session's own list, so only a new session starts it empty. A card coming
        // back to Build resumes the same developer, which still holds its list (docs/specs/2026-11-28-build-lane-checklist.md).
        if (card.checklist) {
          this.db.updateCard(cardId, { checklist: null });
          this.deps.hub.emit({ type: "checklist.updated", cardId, checklist: [] });
        }
      }
      // Said in the fix messages as well as in the role, since a session keeps the instructions of its first turn.
      const wholeBuild = "Your report replaces the card's build report, so its summary and departures describe the " +
        "whole build as it stands now. List only the issues and decisions that are new since your last report.";
      const keepChecklist = "Keep a task list as you work, one item per piece of the work, and keep its statuses " +
        "current: the person follows the build from it on the card page.";
      const message = feedback && entering.shipAfterCheck
        ? [
            "Landing the card on main stopped:",
            "",
            feedback,
            "",
            "Fix it, then end with your report. After Check, the card goes back to Ship.",
            "",
            `Bringing in ${base.ref}: ${mergeInstruction(merge, base.ref)}`,
            "",
            wholeBuild,
            "",
            keepChecklist,
          ]
        : feedback
        ? [
            "The person tried the card's build and found this:",
            "",
            feedback,
            "",
            ...(fixIssues.length
              ? ["They also asked for these code changes, on spec issues the spec keeper raised:", keeperFixList(fixIssues), ""]
              : []),
            "Fix it, then end with your report.",
            "",
            `Bringing in ${base.ref}: ${mergeInstruction(merge, base.ref)}`,
            "",
            "`git status` may show files left from trying the app. Remove what doesn't belong before you report.",
            "",
            wholeBuild,
            "",
            keepChecklist,
          ]
        : fixIssues.length
        ? [
            fixes!.from === "tryit"
              ? "The person tried the card's build and asked for these code changes, on spec issues the spec keeper " +
                "raised. Make each, then end with your report."
              : "The spec keeper judged these spec issues: the code should change to match the spec. Fix each, then " +
                "end with your report. Check's next reviewer verifies each one.",
            "",
            `Bringing in ${base.ref}: ${mergeInstruction(merge, base.ref)}`,
            "",
            keeperFixList(fixIssues),
            "",
            ...(fixes!.from === "tryit"
              ? ["`git status` may show files left from trying the app. Remove what doesn't belong before you report.", ""]
              : []),
            wholeBuild,
            "",
            keepChecklist,
          ]
        : fromCheck
          ? [
              `Check round ${fromCheck.round} found bugs in the branch. Fix them, then end with your report.`,
              "",
              `Bringing in ${base.ref}: ${mergeInstruction(merge, base.ref)}`,
              "",
              "The bugs:",
              bugList(fromCheck.bugs),
              "",
              "If you think one isn't a bug, leave the code as it is, and end your summary with the bugs you left and " +
                "why. The next round's reviewer reads it.",
              "",
              wholeBuild,
              "",
              keepChecklist,
            ]
          : [
              again
                ? `The spec was revised and signed off again: ${card.specPath}, and the planner re-planned. Bring your ` +
                  "work in line with the spec and the new plan below, then end with your report."
                : `The spec for this card is signed off: ${card.specPath}. Read it, then build to the planner's plan ` +
                  "below, and end with your report.",
              "",
              `Bringing in ${base.ref}: ${mergeInstruction(merge, base.ref)}`,
              "",
              keepChecklist,
              "",
              "The plan:",
              "",
              planText(card.plan),
            ];
      this.startTurn(cardId, developer.id, withRunning(card, message).join("\n"), this.turnOptions(roleName));
    } catch (error) {
      if (!this.gone(cardId)) this.addError(cardId, "build", `Build couldn't start: ${(error as Error).message}`, ["retry"]);
    } finally {
      this.starting.delete(cardId);
      if (!this.gone(cardId) && !this.anyTurnRunning(cardId)) {
        this.setState(cardId, "needs-you");
        this.deps.hub.emit({ type: "turn.ended", cardId });
      }
    }
  }

  private async onDeveloperEnded(cardId: string, session: SessionRow, outcome: TurnOutcome, stopped: boolean): Promise<void> {
    const fail = (message: string, actions: LaneErrorAction<"build">[]) => this.addError(cardId, "build", message, actions);
    if (stopped || (outcome.kind === "ok" && outcome.interrupted)) return fail("The developer was stopped.", ["retry"]);
    if (outcome.kind === "error") return fail(`The developer failed: ${outcome.message}`, ["retry"]);
    const report = parseDeveloperReport(outcome.report);
    if (!report) return fail("The developer didn't return a report.", ["retry", "back-to-spec"]);
    if (report.status === "blocked") {
      const blocked = this.requireCard(cardId);
      // The first block in a Build visit goes to the spec keeper at once; a second one stops as it always did
      // (docs/specs/2026-11-28-spec-keeper.md, A blocked build).
      if (blocked.blockJudged) {
        return fail(`The developer couldn't build this: ${report.reason}`, ["retry", "back-to-spec"]);
      }
      const id = this.db.addIssue(cardId, {
        foundIn: "build", where: "Blocking", problem: report.reason, guess: "Nothing yet: the build stopped here.",
      });
      this.db.updateCard(cardId, { blockJudged: true });
      this.addNote(cardId, "build", `The developer is blocked: ${report.reason} The spec keeper is judging it.`);
      this.startKeeper(cardId, "blocking", this.db.issuesFor(cardId).filter((i) => i.id === id));
      return;
    }
    const card = this.requireCard(cardId);
    const mergeUnfinished = await this.deps.git.mergeInProgress(card.worktreePath!);
    if (laneAfterBuild("done", mergeUnfinished) !== "check") {
      return fail("The developer reported done, but the merge of main isn't finished.", ["retry", "back-to-spec"]);
    }
    // The report is stored before the checkpoint, so nothing in it is lost if git refuses the commit.
    this.db.transaction(() => {
      // Your Try it feedback, and the keeper's code fixes, are handled once the developer reports done.
      this.db.updateCard(cardId, {
        build: { summary: report.summary, departures: report.departures, files: [] }, feedback: null, keeperFixes: null,
      });
      for (const issue of report.issues) this.db.addIssue(cardId, { foundIn: "build", ...issue });
      for (const decision of report.decisions) {
        this.db.addDecision(cardId, { lane: "build", source: "developer", ...decision }, session.id);
      }
      this.db.addEvent(cardId, "build", report, randomUUID());
    });
    await this.finishBuild(cardId);
  }

  /** Leave Build with a done report stored: the checkpoint, the changed files, then the move to Check. */
  private async finishBuild(cardId: string): Promise<void> {
    const card = this.requireCard(cardId);
    let files: FileChange[];
    try {
      await this.deps.git.commitAll(card.worktreePath!, `Build: ${card.title}`);
      files = await this.deps.git.changedFiles(card.worktreePath!);
    } catch (error) {
      if (this.gone(cardId)) return;
      const why = sentence((error as Error).message);
      this.addError(cardId, "build", `The build's checkpoint couldn't be committed: ${why} Retry commits it again.`, ["retry"]);
      return;
    }
    // Deleted while the checkpoint was committed: nothing to move.
    if (this.gone(cardId)) return;
    this.db.updateCard(cardId, { build: { ...card.build!, files }, lane: laneAfterBuild("done") });
    this.emitCard(cardId);
    await this.stopCardServers(cardId, "build");
    this.startReviewer(cardId);
  }

  // ---------- Check's reviewer ----------

  /**
   * A Check round: a new reviewer session reads the whole branch against main and the spec. Retry starts a new one
   * for the same round, since a review is a fresh read (docs/specs/2026-11-27-check-lane-reviewer.md, A round).
   */
  private startReviewer(cardId: string): void {
    if (this.gone(cardId)) return;
    const roleName = LANE_ROLE.check!;
    const card = this.requireCard(cardId);
    const round = (card.check?.round ?? 0) + 1;
    let role: Role;
    try {
      role = this.deps.role(roleName);
    } catch (error) {
      this.addError(cardId, "check", `Check couldn't start: ${sentence((error as Error).message)}`, ["retry"]);
      return;
    }
    const id = randomUUID();
    this.db.insertSession({ id, cardId, lane: "check", role: roleName, kind: role.kind });
    this.addNote(cardId, "check", `Round ${round}: the reviewer is reading the branch.`);
    this.startTurn(cardId, id, this.reviewerMessage(card, round), this.turnOptions(roleName));
  }

  private reviewerMessage(card: CardRow, round: number): string {
    const build = card.build;
    const parts = [
      `Check round ${round} for the card "${card.title}". Review the whole branch against main ` +
        `(\`git diff main...HEAD\`) and against the spec at ${card.specPath}, then end with your report.`,
      "",
      "The developer's report:",
      "",
      build?.summary || "(The developer left no report.)",
      "",
      "Its departures from the plan:",
      list((build?.departures ?? []).map((d) => `${d.step}: ${d.what} (${d.why})`)),
      "",
      "Spec issues already on the card. Don't report them again:",
      issueList(this.db.issuesFor(card.id).filter((i) => i.status !== "sent")),
      "",
      "Decisions made without the person. They aren't bugs unless they break something:",
      list(this.db.decisionsFor(card.id).map((d) => d.what)),
    ];
    if (card.check && card.check.bugs.length > 0) {
      parts.push(
        "",
        `Round ${card.check.round} found these bugs. Check that each one is fixed, along with the rest of the branch:`,
        bugList(card.check.bugs),
      );
    }
    // Code fixes from the spec keeper or your answers: verified like bugs, since nothing else re-raises one that
    // wasn't made (docs/specs/2026-11-28-spec-keeper.md, Back to the developer).
    const sent = this.db.issuesFor(card.id).filter((i) => i.status === "sent");
    if (sent.length > 0) {
      parts.push(
        "",
        "These spec issues were sent to the developer as code fixes. Check that each one is fixed; one that isn't is a bug:",
        keeperFixList(sent),
      );
    }
    return withRunning(card, parts).join("\n");
  }

  private onReviewerEnded(cardId: string, outcome: TurnOutcome, stopped: boolean): void {
    const fail = (message: string, actions: LaneErrorAction<"check">[]) => this.addError(cardId, "check", message, actions);
    if (stopped || (outcome.kind === "ok" && outcome.interrupted)) return fail("The reviewer was stopped.", ["retry"]);
    if (outcome.kind === "error") return fail(`The reviewer failed: ${outcome.message}`, ["retry"]);
    // A reviewer that can't review, or can't report, may do so every time: Move on keeps the card from being stuck.
    const report = parseCheckReport(outcome.report);
    if (!report) return fail("The reviewer didn't return a report.", ["retry", "move-on"]);
    if (report.status === "blocked") {
      return fail(`The reviewer couldn't review this: ${report.reason}`, ["retry", "move-on"]);
    }

    const card = this.requireCard(cardId);
    const check: CheckRound = { round: (card.check?.round ?? 0) + 1, summary: report.summary, bugs: report.bugs };
    const before = this.db.issuesFor(cardId);
    const waiting = before.some((i) => i.status === "waiting");
    // This round's issues are open too: they're stored with the round below.
    const openIssues = before.filter((i) => i.status === "open").length + report.issues.length;
    const to = laneAfterCheck("done", check.bugs.length, check.round, card.shipAfterCheck, waiting, openIssues);
    const bugs = count(check.bugs.length, "bug", "bugs");
    const developer = this.db.getSessionFor(cardId, "build", LANE_ROLE.build!);
    let judge: SpecIssue[] = [];
    // The round and the move land together, so a restart can't fall between them. Going back to Build clears the
    // build report and the developer's last message, as every entry to Build does, so a restart before the developer
    // starts offers "Build hasn't started yet" and its Retry starts it with these bugs.
    this.db.transaction(() => {
      for (const issue of report.issues) this.db.addIssue(cardId, { foundIn: "check", ...issue });
      this.db.addEvent(cardId, "check", { ...check, issues: report.issues }, randomUUID());
      if (check.bugs.length === 0) {
        // A passing round verifies every code fix it was asked to check.
        const issues = this.db.issuesFor(cardId);
        this.db.setIssueStatus(issues.filter((i) => i.status === "sent").map((i) => i.id), "fixed");
        // Open spec issues are judged before the card moves on, while it stays in Check
        // (docs/specs/2026-11-28-spec-keeper.md, The batch).
        if (to === "check") {
          judge = issues.filter((i) => i.status === "open");
          this.addNote(cardId, "check", `Round ${check.round}: no bugs.`);
          this.db.updateCard(cardId, { check });
        } else {
          this.addNote(cardId, "check", to === "ship" ? `Round ${check.round}: no bugs. Back to Ship.` : `Round ${check.round}: no bugs.`);
          this.db.updateCard(cardId, { check, lane: to, shipAfterCheck: false });
        }
      } else if (to === "build") {
        this.addNote(cardId, "check", `Round ${check.round} found ${bugs}. Back to the developer.`);
        this.db.updateCard(cardId, { check, lane: to, build: null });
        if (developer) this.db.updateSession(developer.id, { lastMessage: null });
      } else {
        this.db.updateCard(cardId, { check });
        fail(`Round ${check.round} still found ${bugs}, and Check runs only ${CHECK_ROUNDS} rounds without you. Back ` +
          "to Build gives the developer one more round; Move on takes the card to Try it as built.",
        ["back-to-build", "move-on"]);
      }
    });
    // A round that stops the card leaves it in Check, so the page wouldn't refetch the round or its issues.
    this.deps.hub.emit({ type: "check.updated", cardId, check, issues: this.db.issuesFor(cardId) });
    this.emitCard(cardId);
    if (judge.length > 0) return this.startKeeper(cardId, "batch", judge);
    if (to === "ship") void this.stopCardServers(cardId, "check");
    if (to === "tryit") {
      this.askWaitingIssues(cardId);
      void this.stopCardServers(cardId, "check")
        .then(() => this.startApp(cardId))
        .catch((error: unknown) => this.log(`Starting the app of card ${cardId} failed: ${String(error)}`));
    }
    if (to === "build") {
      void this.startDeveloper(cardId)
        .catch((error: unknown) => this.log(`Starting the developer of card ${cardId} failed: ${String(error)}`));
    }
  }

  // ---------- the spec keeper (docs/specs/2026-11-28-spec-keeper.md) ----------

  /** A keeper turn's options: the spec writer's, plus the keeper's report on a turn that judges. */
  private keeperOptions(judging: KeeperJudging): TurnOptions {
    const options = this.turnOptions(LANE_ROLE.spec!);
    return judging.kind === "answers" ? options : { ...options, outputFormat: ROLE_TURNS[SPEC_KEEPER]!.report };
  }

  /**
   * A keeper turn that judges: the batch once Check passes, the batch as built after Move on, or a blocked build's
   * reason. It's a turn in the spec writer's session, with the keeper's instructions at the top of its message, since
   * the session keeps the system prompt of its first turn. `Card.judging` stays set until it succeeds.
   */
  private startKeeper(cardId: string, kind: "batch" | "as-built" | "blocking", issues: SpecIssue[]): void {
    if (this.gone(cardId)) return;
    const card = this.requireCard(cardId);
    const judging: KeeperJudging = { kind, issueIds: issues.map((i) => i.id) };
    this.db.updateCard(cardId, { judging });
    const writer = this.db.getSessionFor(cardId, "spec", LANE_ROLE.spec!);
    let built = false;
    try {
      if (!writer) throw new Error("This card has no spec writer to judge its issues.");
      const message = this.keeperMessage(card, kind, issues);
      built = true;
      this.addNote(cardId, card.lane,
        `The spec keeper is judging ${count(issues.length, "spec issue", "spec issues")}${kind === "as-built" ? " as built" : ""}.`);
      this.startTurn(cardId, writer.id, message, this.keeperOptions(judging));
    } catch (error) {
      // A message that was never built leaves no last message, so Retry builds it again instead of re-sending the
      // writer's earlier one.
      if (writer) this.db.updateSession(writer.id, { turnRunning: false, ...(built ? {} : { lastMessage: null }) });
      this.setState(cardId, "needs-you");
      this.keeperFailed(cardId, `The spec keeper couldn't start: ${sentence((error as Error).message)}`);
    }
  }

  private keeperMessage(card: CardRow, kind: "batch" | "as-built" | "blocking", issues: SpecIssue[]): string {
    const role = this.deps.role(SPEC_KEEPER); // a broken role file fails here, before the turn
    const ids = new Set(issues.map((i) => i.id));
    const earlier = this.db.issuesFor(card.id).filter((i) => i.judgment && !ids.has(i.id));
    const describe = (i: SpecIssue) =>
      [`- id ${i.id}, found in ${i.foundIn}`, `  Section: ${i.where}`, `  Problem: ${i.problem}`, `  Built: ${i.guess}`]
        .join("\n");
    return [
      role.instructions,
      "",
      kind === "blocking"
        ? "The developer is blocked and has stopped. Judge the problem it reported:"
        : kind === "as-built"
          ? "The person moved the card on to Try it as built. Judge these spec issues:"
          : "Check passed. Judge these spec issues:",
      "",
      issues.map(describe).join("\n"),
      "",
      "Issues judged earlier on this card, for marking a repeat:",
      earlier.length
        ? earlier.map((i) => `- id ${i.id}: ${i.where}: ${i.problem} (you judged it ${i.judgment!.verdict})`).join("\n")
        : "- (none)",
      "",
      // The card's base is a fetched origin/main when there's a remote, so a stale local main would show changes that
      // aren't the card's (docs/specs/2026-11-28-spec-keeper.md, The batch: `git diff <base>...HEAD`).
      `The spec is ${card.specPath}. Read the branch against the base it was built on, in your working folder: ` +
        "`git diff origin/main...HEAD` if the repo has an origin remote, otherwise `git diff main...HEAD`.",
      `Today is ${(this.deps.today ?? localDate)()}, for the Amendments lines.`,
      "",
      "End with your report: one judgment for each issue above, by its id.",
    ].join("\n");
  }

  /** The end of a keeper turn, whichever kind it was. */
  private async onKeeperEnded(cardId: string, outcome: TurnOutcome, stopped: boolean): Promise<void> {
    const judging = this.requireCard(cardId).judging!;
    if (stopped || (outcome.kind === "ok" && outcome.interrupted)) return this.keeperFailed(cardId, "The spec keeper was stopped.");
    if (outcome.kind === "error") return this.keeperFailed(cardId, `The spec keeper failed: ${outcome.message}`);
    if (judging.kind === "answers") return this.onAnswersEnded(cardId, judging);
    const report = parseKeeperReport(outcome.report, judging.issueIds);
    if (!report) return this.keeperFailed(cardId, "The spec keeper didn't judge every issue.");
    if (report.status === "blocked") return this.keeperFailed(cardId, `The spec keeper couldn't judge: ${report.reason}`);
    await this.commitSpecChange(cardId);
    if (this.gone(cardId)) return;
    if (judging.kind === "blocking") return this.afterBlockingJudged(cardId, report.judgments[0]!);
    await this.afterBatchJudged(cardId, judging.kind, report.judgments);
  }

  /**
   * A keeper turn that failed: Retry sends the same message again, since `Card.judging` stays set. In Check, Move on
   * takes the card on past it, its issues not judged; in Build, Back to Spec stays the way out of a blocked build.
   */
  private keeperFailed(cardId: string, message: string): void {
    const lane = this.requireCard(cardId).lane;
    const actions: ErrorAction[] = lane === "check" ? ["retry", "move-on"] : lane === "build" ? ["retry", "back-to-spec"] : ["retry"];
    this.addError(cardId, lane, message, actions);
  }

  /**
   * The keeper's change to the spec, committed alone. git refuses a one-file commit during a merge, so a change made
   * while a blocked build's merge is unfinished goes in with the merge commit or the next checkpoint.
   */
  private async commitSpecChange(cardId: string): Promise<void> {
    const card = this.requireCard(cardId);
    if (!card.worktreePath || !card.specPath) return;
    try {
      if (await this.deps.git.mergeInProgress(card.worktreePath)) return;
      await this.deps.git.commitFile(card.worktreePath, card.specPath, `Spec keeper: ${card.title}`);
    } catch (error) {
      this.addNote(cardId, card.lane,
        `The spec keeper's change to the spec couldn't be committed: ${sentence((error as Error).message)} It goes in with the next checkpoint.`);
    }
  }

  /** A judged batch: store each judgment with what it leads to, then move the card as plain code decides. */
  private async afterBatchJudged(
    cardId: string, kind: "batch" | "as-built", judgments: ({ issueId: string } & IssueJudgment)[],
  ): Promise<void> {
    const card = this.requireCard(cardId);
    const fates = new Map(judgments.map((j) => [j.issueId, fateOf(j, kind, card.keeperRounds)] as const));
    const all = [...fates.values()];
    const severe = all.includes("severe");
    // A batch stopped on a severe issue acts on nothing else yet: Move on asks the rest, Back to Spec settles them.
    const statusOf = (fate: IssueFate): IssueStatus =>
      fate === "fix" ? (severe ? "judged" : "sent") : fate === "waits" ? (severe ? "judged" : "waiting") : fate;
    const waitingBefore = this.db.issuesFor(cardId).some((i) => i.status === "waiting");
    const to = laneAfterJudging(all, card.shipAfterCheck, waitingBefore);
    const fixIds = judgments.filter((j) => fates.get(j.issueId) === "fix").map((j) => j.issueId);
    const developer = this.db.getSessionFor(cardId, "build", LANE_ROLE.build!);
    const tally = (fate: IssueFate) => all.filter((f) => f === fate).length;
    this.db.transaction(() => {
      for (const { issueId, ...judgment } of judgments) {
        const flips = judgment.repeats ? this.db.flipsOf(judgment.repeats) + 1 : 0;
        this.db.judgeIssue(issueId, judgment, statusOf(fates.get(issueId)!), flips);
      }
      this.db.addEvent(cardId, "judged", { kind, judgments }, randomUUID());
      this.db.updateCard(cardId, { judging: null });
      const parts = [
        tally("spec-fixed") && `${count(tally("spec-fixed"), "spec fix", "spec fixes")}`,
        tally("fix") && `${count(tally("fix"), "code fix", "code fixes")}`,
        tally("waits") && `${tally("waits")} for you`,
        tally("no-change") && `${tally("no-change")} with no change`,
      ].filter(Boolean);
      if (!severe) this.addNote(cardId, "check", `The spec keeper judged the issues: ${parts.join(", ")}.`);
      if (to === "build") {
        this.addNote(cardId, "check", "The code fixes go to the developer, and Check starts again at round 1.");
        this.db.updateCard(cardId, {
          lane: "build", build: null, check: null, keeperRounds: card.keeperRounds + 1,
          keeperFixes: { from: "check", ids: fixIds },
        });
        if (developer) this.db.updateSession(developer.id, { lastMessage: null });
      } else if (to === "check") {
        const issue = judgments.find((j) => j.level === "severe")!;
        const where = this.db.issuesFor(cardId).find((i) => i.id === issue.issueId)?.where ?? "";
        this.addError(cardId, "check",
          `The spec keeper found a severe issue in ${where}: ${sentence(issue.reason)}` +
            (issue.recommendation ? ` It recommends: ${sentence(issue.recommendation)}` : "") +
            " Back to Spec revises the spec with the spec writer; Move on takes the card to Try it as built, where the " +
            "issues are put to you.",
          ["back-to-spec", "move-on"]);
      } else if (to === "ship") {
        this.addNote(cardId, "check", "Back to Ship.");
        this.db.updateCard(cardId, { lane: "ship", shipAfterCheck: false });
      }
    });
    this.emitIssues(cardId);
    this.emitCard(cardId);
    if (to === "build") {
      void this.startDeveloper(cardId)
        .catch((error: unknown) => this.log(`Starting the developer of card ${cardId} failed: ${String(error)}`));
    } else if (to === "tryit") {
      await this.moveToTryIt(cardId, "check");
    } else if (to === "ship") {
      await this.stopCardServers(cardId, "check");
    }
  }

  /** The keeper judged a blocked build's reason: plain code decides what follows (A blocked build). */
  private afterBlockingJudged(cardId: string, judgment: { issueId: string } & IssueJudgment): void {
    const card = this.requireCard(cardId);
    const { issueId, ...j } = judgment;
    const next = afterBlocking(j);
    const status: IssueStatus = next === "stop" ? "severe" : next === "fall-back" ? "no-change" : next === "ask"
      ? "waiting" : next === "spec-fixed" ? "spec-fixed" : "sent";
    this.db.transaction(() => {
      this.db.judgeIssue(issueId, j, status, j.repeats ? this.db.flipsOf(j.repeats) + 1 : 0);
      this.db.addEvent(cardId, "judged", { kind: "blocking", judgments: [judgment] }, randomUUID());
      this.db.updateCard(cardId, { judging: null });
    });
    this.emitIssues(cardId);
    const issue = this.db.issuesFor(cardId).find((i) => i.id === issueId)!;
    switch (next) {
      case "stop":
        this.addError(cardId, "build",
          `The spec keeper found the block severe: ${sentence(j.reason)}` +
            (j.recommendation ? ` It recommends: ${sentence(j.recommendation)}` : ""),
          ["back-to-spec"]);
        return;
      case "fall-back":
        this.addError(cardId, "build",
          `The developer couldn't build this: ${sentence(issue.problem)} The spec keeper: ${sentence(j.reason)}`,
          ["retry", "back-to-spec"]);
        return;
      case "ask":
        this.askBlocking(cardId, issue);
        return;
      case "spec-fixed":
        this.resumeDeveloper(cardId,
          `The spec keeper changed the spec: ${sentence(j.reason)} Read ${card.specPath} again where it changed, then ` +
            "carry on and end with your report.");
        return;
      case "carry-on":
        this.resumeDeveloper(cardId, `The spec stands: ${sentence(j.reason)} Carry on, then end with your report.`);
    }
  }

  /** The same developer carries on after the keeper settled what blocked it. */
  private resumeDeveloper(cardId: string, message: string): void {
    const developer = this.db.getSessionFor(cardId, "build", LANE_ROLE.build!);
    try {
      if (!developer) throw new Error("This card has no developer to carry on.");
      this.startTurn(cardId, developer.id, message, this.turnOptions(LANE_ROLE.build!));
    } catch (error) {
      if (developer) this.db.updateSession(developer.id, { turnRunning: false });
      this.setState(cardId, "needs-you");
      this.addError(cardId, "build", `The developer couldn't carry on: ${sentence((error as Error).message)}`,
        ["retry", "back-to-spec"]);
    }
  }

  /** One question about an issue the keeper puts to you; its choice is the first option. */
  private keeperQuestion(issue: SpecIssue, n: number, onBlockedBuild: boolean): Question {
    const j = issue.judgment!;
    const recommended = "The spec keeper recommends this.";
    const [spec, code] = onBlockedBuild
      ? [{ label: CHANGE_THE_SPEC, description: "The spec keeper changes the spec, and the developer carries on." },
        { label: KEEP_THE_SPEC, description: "The developer carries on with the spec as it is." }]
      : [{ label: KEEP_AS_BUILT, description: "The spec changes to describe what was built." },
        { label: CHANGE_THE_CODE, description: "The code changes to match the spec, when you press Send to Build." }];
    const specFirst = j.verdict !== "code-wrong";
    const options = (specFirst ? [spec, code] : [code, spec])
      .map((o, i) => (i === 0 ? { ...o, description: `${recommended} ${o.description}` } : o));
    return {
      question: `${n + 1}. ${issue.where}: ${sentence(issue.problem)} ${sentence(j.recommendation || j.reason)}` +
        (j.repeats ? " It came back after it was settled once." : ""),
      header: "Spec issue",
      options,
      multiSelect: false,
    };
  }

  /** Every issue waiting for you is asked in one question once the card is in Try it (After the batch). */
  private askWaitingIssues(cardId: string): void {
    const card = this.requireCard(cardId);
    if (card.lane !== "tryit" || this.db.openPendingFor(cardId)) return;
    const waiting = this.db.issuesFor(cardId).filter((i) => i.status === "waiting" && i.judgment);
    if (waiting.length === 0) return;
    this.raiseKeeperQuestion(cardId, waiting, false);
  }

  /** A blocked build's issue that needs you is asked at once, on the card in Build. */
  private askBlocking(cardId: string, issue: SpecIssue): void {
    this.raiseKeeperQuestion(cardId, [issue], true);
  }

  private raiseKeeperQuestion(cardId: string, issues: SpecIssue[], onBlockedBuild: boolean): void {
    const writer = this.db.getSessionFor(cardId, "spec", LANE_ROLE.spec!);
    if (!writer) return;
    const item: PendingItem = {
      id: randomUUID(), kind: "question",
      questions: issues.map((i, n) => this.keeperQuestion(i, n, onBlockedBuild)),
      issueIds: issues.map((i) => i.id),
    };
    this.db.insertPending({ item, cardId, sessionId: writer.id });
    this.deps.hub.emit({ type: "pending.updated", cardId, pending: item });
    this.setState(cardId, "needs-you");
  }

  /**
   * Your answers to a keeper question, routed by plain code (Your answer in Try it, A blocked build). Answering never
   * moves the card: Keep it as built and your own words go to the keeper to change the spec at once; Change the code
   * and your own words are held for Send to Build. On a blocked build, Change the spec (or your words) goes to the keeper
   * and Keep the spec straight back to the developer.
   */
  private answerKeeper(cardId: string, questions: Question[], issueIds: string[], answers: Record<string, string>): void {
    const card = this.requireCard(cardId);
    const onBlockedBuild = card.lane === "build";
    const issues = this.db.issuesFor(cardId);
    const toSpec: SpecIssue[] = [];
    const standing: SpecIssue[] = [];
    questions.forEach((q, n) => {
      const issue = issues.find((i) => i.id === issueIds[n]);
      if (!issue) return;
      const given = (answers[q.question] ?? "").trim() || q.options[0]!.label;
      const [keepLabel, changeLabel] = onBlockedBuild ? [CHANGE_THE_SPEC, KEEP_THE_SPEC] : [KEEP_AS_BUILT, CHANGE_THE_CODE];
      const answer: IssueAnswer = given === keepLabel ? { choice: "keep", words: null }
        : given === changeLabel ? { choice: "change", words: null }
        // Your own words: a change you want made, written into the spec as well.
        : { choice: onBlockedBuild ? "keep" : "change", words: given };
      const status: IssueStatus = answer.choice === "keep" ? "kept" : onBlockedBuild ? "sent" : "held";
      this.db.answerIssue(issue.id, answer, status);
      const answered = { ...issue, answer, status };
      // A no-change issue kept as built needs no edit (docs/specs/2026-11-28-spec-keeper.md, Your answer in Try it).
      if (answer.words || (answer.choice === "keep" && issue.judgment?.verdict !== "no-change")) toSpec.push(answered);
      else if (onBlockedBuild) standing.push(answered);
    });
    this.emitIssues(cardId);
    if (toSpec.length > 0) return this.startAnswersTurn(cardId, toSpec);
    if (onBlockedBuild) {
      const reasons = standing.map((i) => sentence(i.judgment?.reason ?? "")).join(" ");
      this.resumeDeveloper(cardId, `The spec stands: ${reasons} Carry on, then end with your report.`);
    }
  }

  /** The keeper changes the spec to match your answers, with an Amendments line each; no new judging. */
  private startAnswersTurn(cardId: string, issues: SpecIssue[]): void {
    const card = this.requireCard(cardId);
    const judging: KeeperJudging = { kind: "answers", issueIds: issues.map((i) => i.id) };
    this.db.updateCard(cardId, { judging });
    const writer = this.db.getSessionFor(cardId, "spec", LANE_ROLE.spec!);
    const what = (i: SpecIssue) =>
      i.answer?.words
        ? `  The person decided, in their own words: "${i.answer.words}". Make the spec say it; don't judge it again.`
        : card.lane === "build"
          ? "  The person chose to change the spec, so that this no longer blocks the build."
          : "  The person chose to keep it as built: change the spec to describe what was built.";
    const message = [
      "As the spec keeper: the person answered your questions on these spec issues. Change the spec to match each " +
        "answer, and add a line to the `## Amendments` section at the end of the spec for every change, creating it " +
        "if it isn't there: `- YYYY-MM-DD: <what changed>. <why, in one line>.` Change no other file, and end with a " +
        "short summary of what you changed.",
      "",
      issues.map((i) => [`- ${i.where}: ${i.problem}`, `  Built: ${i.guess}`, what(i)].join("\n")).join("\n"),
      "",
      `The spec is ${card.specPath}. Today is ${(this.deps.today ?? localDate)()}.`,
    ].join("\n");
    try {
      if (!writer) throw new Error("This card has no spec writer to change the spec.");
      this.addNote(cardId, card.lane, "The spec keeper is changing the spec to match your answers.");
      this.startTurn(cardId, writer.id, message, this.keeperOptions(judging));
    } catch (error) {
      if (writer) this.db.updateSession(writer.id, { turnRunning: false });
      this.setState(cardId, "needs-you");
      this.keeperFailed(cardId, `The spec keeper couldn't start: ${sentence((error as Error).message)}`);
    }
  }

  /** The spec now matches your answers: commit it, and on a blocked build the developer carries on. */
  private async onAnswersEnded(cardId: string, judging: KeeperJudging): Promise<void> {
    await this.commitSpecChange(cardId);
    if (this.gone(cardId)) return;
    const card = this.requireCard(cardId);
    this.db.updateCard(cardId, { judging: null });
    this.addNote(cardId, card.lane, "The spec keeper changed the spec to match your answers.");
    if (card.lane !== "build") return;
    const words = this.db.issuesFor(cardId)
      .filter((i) => judging.issueIds.includes(i.id) && i.answer?.words)
      .map((i) => `The person said: "${i.answer!.words}"`);
    this.resumeDeveloper(cardId, [
      `The spec keeper changed the spec to settle what blocked you. Read ${card.specPath} again where it changed, then ` +
        "carry on and end with your report.",
      ...words,
    ].join("\n"));
  }

  /** Send to Build and Accept wait for the spec keeper: a question to answer, or a turn of its that failed. */
  private refuseWhileKeeperAsks(cardId: string): void {
    const card = this.requireCard(cardId);
    if (card.judging) throw new HttpError(409, "The spec keeper's last turn didn't finish. Retry it first.");
    const open = this.db.openPendingFor(cardId);
    const asking = open?.item.kind === "question" && !!open.item.issueIds;
    if (asking || this.db.issuesFor(cardId).some((i) => i.status === "waiting")) {
      throw new HttpError(409, "Answer the spec keeper's question first.");
    }
  }

  private emitIssues(cardId: string): void {
    this.deps.hub.emit({ type: "issues.updated", cardId, issues: this.db.issuesFor(cardId) });
  }

  // ---------- startup ----------

  /**
   * After a restart. A chat lane's cut-off turn is not resumed; it waits for you. A cut-off planner or developer turn
   * is resumed once, as for any hands-off lane. A cut-off review, or review turn, gets its own way to start again.
   * A card in Build or Check that nothing is resuming gets a line with Retry, so it's never stuck without a way on;
   * nothing starts a build or a review by itself, since that would spend a long Opus turn without anyone asking.
   */
  recoverAfterRestart(): void {
    for (const session of this.db.listRunningSessions()) {
      this.db.updateSession(session.id, { turnRunning: false });
      this.db.updateCard(session.cardId, { state: "needs-you" });
      const card = this.db.getCard(session.cardId);
      if (!card) continue;
      if (session.role === SPEC_REVIEWER) {
        this.addError(card.id, "spec", "The review was cut off when the hive stopped. Press Review again.", ["review"]);
      } else if (RESUMED[session.role]) {
        const { who, message } = RESUMED[session.role]!;
        // A missing spec format or role file must not stop the hive from starting; the session waits for Retry.
        try {
          // A turn cut off before Claude Code created its session left nothing to resume: send its message again.
          const resend = !session.existsYet && session.lastMessage;
          this.startTurn(card.id, session.id,
            resend || `Your last turn was cut off when the hive stopped. ${message}`,
            this.turnOptions(session.role));
        } catch (error) {
          this.db.updateSession(session.id, { turnRunning: false });
          this.db.updateCard(card.id, { state: "needs-you" });
          this.addError(card.id, session.lane, `The ${who} couldn't restart: ${(error as Error).message}`, ["retry"]);
        }
      } else if (session.role === LANE_ROLE.spec && card.judging) {
        // A keeper turn is hands-off: resumed, as a planner's or developer's is.
        const judging = card.judging;
        try {
          const resend = !session.existsYet && session.lastMessage;
          this.startTurn(card.id, session.id,
            resend || (judging.kind === "answers"
              ? "Your last turn was cut off when the hive stopped. Finish changing the spec to match the person's answers."
              : "Your last turn was cut off when the hive stopped. Finish judging the issues, then end with your report."),
            this.keeperOptions(judging));
        } catch (error) {
          this.db.updateSession(session.id, { turnRunning: false });
          this.db.updateCard(card.id, { state: "needs-you" });
          this.keeperFailed(card.id, `The spec keeper couldn't restart: ${(error as Error).message}`);
        }
      } else if (session.role === LANE_ROLE.spec && card.reviewApplying) {
        this.addError(card.id, "spec",
          "The review wasn't finished: the hive stopped while the spec writer was applying it. Retry sends its findings again.",
          ["retry"]);
      } else {
        this.addError(card.id, session.lane, "The last reply was cut off when the hive stopped. Send a message to carry on.", []);
      }
    }
    for (const card of this.db.listCards()) {
      // A setup the hive was still starting when it stopped has no turn to resume. It's marked failed, and a Build
      // waiting for it gets its Retry line below rather than starting by itself.
      const setup = this.db.getSessionFor(card.id, "refine", SETUP);
      if (card.setup?.status === "running" && !(setup && this.turns.has(setup.id))) {
        this.endSetup(card.id, { reason: "The hive stopped before it finished." }, { continueBuild: false });
      }
      if (card.lane === "spec" && card.specPath) this.watchSpec(card.id);
      if (card.lane === "build") this.offerBuildWayOn(this.requireCard(card.id));
      // A landing runs in this process only: a card left marked working in Ship has nothing running any more.
      if (card.lane === "ship" && card.state === "working") this.setState(card.id, "needs-you");
      if (card.lane === "ship" && card.landing) {
        void this.recoverLanding(card.id).catch((error: unknown) => this.log(`Recovering the landing of card ${card.id} failed: ${String(error)}`));
      }
      // The hive's children ended with it: a card in Try it gets its app again, unless you stopped it.
      if (card.lane === "tryit" && !card.appStopped) {
        void this.startApp(card.id).catch((error: unknown) => this.log(`Starting the app of card ${card.id} failed: ${String(error)}`));
      }
      if (card.lane === "check") this.offerCheckWayOn(card);
    }
  }

  /** A card in Check with nothing running and no line offering a way on gets one. */
  private offerCheckWayOn(card: CardRow): void {
    if (this.anyTurnRunning(card.id)) return;
    const last = this.db.lastChatItem(card.id, "check");
    if (last?.kind === "error" && last.actions.length > 0) return;
    if (card.judging) this.addError(card.id, "check", "The spec keeper hasn't finished judging.", ["retry", "move-on"]);
    else this.addError(card.id, "check", "Check hasn't started yet.", ["retry"]);
    this.setState(card.id, "needs-you");
  }

  /** A card in Build with nothing running and no error line offering Retry gets one. */
  private offerBuildWayOn(card: CardRow): void {
    if (this.anyTurnRunning(card.id)) return;
    const last = this.db.lastChatItem(card.id, "build");
    // A line with a way on already, such as a severe block's Back to Spec, stays the last line.
    if (last?.kind === "error" && last.actions.length > 0) return;
    // A spec keeper question on a blocked build: answering it is the way on, not re-running the developer.
    const open = this.db.openPendingFor(card.id);
    if (open?.item.kind === "question" && open.item.issueIds) return;
    const developer = this.db.getSessionFor(card.id, "build", LANE_ROLE.build!);
    const message = card.build
      ? "The build's checkpoint wasn't committed: the hive stopped first. Retry commits it."
      : !developer?.lastMessage
        ? "Build hasn't started yet."
        : "Build was cut off when the hive stopped. Retry carries on.";
    this.addError(card.id, "build", message, ["retry"]);
    this.setState(card.id, "needs-you");
  }

  // ---------- turns ----------

  /** What a role's turns need beyond the basics (spec: Session runner). */
  private turnOptions(roleName: string): TurnOptions {
    const turn = ROLE_TURNS[roleName] ?? {};
    return {
      ...(turn.specFormat?.length
        ? { extraInstructions: turn.specFormat.map((file) => this.formatFile(file)).join("\n\n") }
        : {}),
      ...(turn.report ? { outputFormat: turn.report } : {}),
      ...(turn.taskTools ? { taskTools: true } : {}),
      // Turn settings the session isn't told about stay here, out of ROLE_TURNS.
      ...(roleName === SPEC_REVIEWER ? { persist: false } : {}),
      ...(roleName === SETUP ? { background: true } : {}),
    };
  }

  /** The hive's own tools a role's sessions are offered, from ROLE_TURNS, bound to the card. */
  private hiveToolsFor(roleName: string, cardId: string): HiveTools | undefined {
    const names = ROLE_TURNS[roleName]?.tools ?? [];
    if (names.length === 0) return undefined;
    return {
      ...(names.includes("write_brief")
        ? { writeBrief: (brief: Brief) => Promise.resolve(this.writeBrief(cardId, brief)) }
        : {}),
      ...(names.includes("copy_local_files")
        ? { copyLocalFiles: (paths: string[]) => this.copyLocalFiles(cardId, paths) }
        : {}),
      ...(names.includes("set_mockup")
        ? { setMockup: (input: { page?: string; link?: string }) => Promise.resolve(this.setMockup(cardId, input)) }
        : {}),
    };
  }

  private startTurn(cardId: string, sessionId: string, message: string, options: TurnOptions = {}): void {
    const card = this.requireCard(cardId);
    const session = this.db.getSession(sessionId)!;
    const { background, ...turnOptions } = options;
    // The spec reviewer's report and a background setup's working are for the hive, not for the chat.
    const quiet = session.role === SPEC_REVIEWER || !!background;
    // A spec keeper turn speaks in the lane the card is in, as the keeper, not in Spec's chat as the writer.
    const keeper = session.role === LANE_ROLE.spec && !!card.judging;
    const chatLane = keeper ? card.lane : session.lane;
    const author: ChatAuthor = keeper ? "spec-keeper" : AUTHOR[session.role] ?? "hive";
    const hiveTools = this.hiveToolsFor(session.role, cardId);
    // Stored first: Retry after a turn that couldn't start sends this message again.
    this.db.updateSession(sessionId, { lastMessage: message });
    // Resolved before the turn is marked running, so a broken role file leaves no running turn behind.
    const role = this.deps.role(session.role);
    this.db.updateSession(sessionId, { turnRunning: true });
    this.withdrawn.delete(sessionId);
    if (!background) {
      this.setState(cardId, "working");
      this.deps.hub.emit({ type: "turn.started", cardId });
    }

    let turn: RunningTurn;
    try {
      turn = this.deps.runner.start(
        {
          sessionId,
          resume: session.existsYet,
          cwd: card.worktreePath!,
          role,
          message,
          ...(hiveTools ? { hiveTools } : {}),
          ...turnOptions,
        },
        {
          onTextDelta: (text) => {
            if (!quiet) this.deps.hub.emit({ type: "chat.delta", cardId, text });
          },
          onTextBlock: (text) => {
            // An interrupted turn of a card being deleted may still flush a block: there's no card to write it to.
            if (!quiet && !this.deleting.has(cardId)) this.addChat(cardId, chatLane, author, text);
          },
          onActivity: (text) => {
            if (!background) this.deps.hub.emit({ type: "chat.activity", cardId, text });
          },
          // Only the developer's list is shown (docs/specs/2026-11-28-build-lane-checklist.md).
          onChecklist: (change) => {
            if (session.role === LANE_ROLE.build && !this.deleting.has(cardId)) this.changeChecklist(cardId, change);
          },
          onSessionCreated: () => this.db.updateSession(sessionId, { existsYet: true }),
          canUseTool: (toolName, input, signal) => this.canUseTool(cardId, session, toolName, input, signal),
        },
      );
    } catch (error) {
      // The turn never started: take its mark back, the way a turn's normal end does. No error line: callers report it.
      this.db.updateSession(sessionId, { turnRunning: false });
      if (!background && !this.anyTurnRunning(cardId)) {
        this.setState(cardId, "needs-you");
        this.deps.hub.emit({ type: "turn.ended", cardId });
      }
      throw error;
    }
    this.turns.set(sessionId, turn);
    if (session.lane === "spec") this.refreshSpec(cardId);
    if (session.role === SETUP) {
      // An install prompt or a server that never returns mustn't hang setup, and Build with it.
      const timer = setTimeout(() => {
        if (this.turns.get(sessionId) !== turn) return;
        this.timedOut.add(sessionId);
        void turn.interrupt();
      }, this.deps.setupLimitMs ?? 10 * 60_000);
      timer.unref?.();
      this.setupTimers.set(sessionId, timer);
    }

    void turn.done
      .catch((error: unknown): TurnOutcome => ({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      }))
      .then(async (outcome) => {
        if (this.turns.get(sessionId) === turn) this.turns.delete(sessionId);
        // A card being deleted: nothing is written back, only this turn's bookkeeping goes.
        if (this.deleting.has(cardId)) return this.standDown(cardId, sessionId);
        const stopped = this.stopping.delete(sessionId);
        this.db.updateSession(sessionId, { turnRunning: false });
        this.dropOpenPending(cardId, sessionId);
        const withdrew = this.withdrawn.delete(sessionId);

        if (session.role === SPEC_REVIEWER) this.onReviewEnded(cardId, outcome, stopped);
        else if (session.role === LANE_ROLE.plan) this.onPlannerEnded(cardId, outcome, stopped);
        else if (session.role === LANE_ROLE.build) await this.onDeveloperEnded(cardId, session, outcome, stopped);
        else if (session.role === LANE_ROLE.check) this.onReviewerEnded(cardId, outcome, stopped);
        else if (session.role === SETUP) this.onSetupEnded(cardId, sessionId, outcome, stopped);
        else if (keeper) await this.onKeeperEnded(cardId, outcome, stopped);
        else if (session.role === LANE_ROLE.spec && this.requireCard(cardId).reviewApplying) {
          this.onWriterEnded(cardId, outcome, stopped, withdrew);
        } else if (outcome.kind === "error" && !stopped) {
          this.addError(cardId, session.lane, outcome.message, ["retry"]);
        }
        // The designer may have changed the folder's files without naming a new mockup (exports copied in beside a
        // link, pages removed), so the page's file list and Good's hints are read again once its turn ends.
        if (session.role === LANE_ROLE.mockup) this.emitMockup(cardId);

        if (!background) this.deps.hub.emit({ type: "chat.activity", cardId, text: null });
        // A handler above may have started the next turn (a review's findings go straight to the spec writer);
        // turn.ended then would tell the page nothing runs while the spec writer is applying them.
        if (!this.anyTurnRunning(cardId)) {
          this.setState(cardId, "needs-you");
          this.deps.hub.emit({ type: "turn.ended", cardId });
        }
        if (this.requireCard(cardId).specPath) this.refreshSpec(cardId);

        const next = this.followUps.get(sessionId);
        if (next) {
          this.followUps.delete(sessionId);
          try {
            this.startTurn(cardId, sessionId, next.join("\n\n"), this.turnOptions(session.role));
          } catch (error) {
            this.addError(cardId, session.lane, `Your last message couldn't be sent: ${(error as Error).message}`, []);
          }
        }
      })
      // Nothing thrown while handling a turn's end may become an unhandled rejection, which would stop the hive.
      .catch((error: unknown) => this.log(`Handling the end of a turn on card ${cardId} failed: ${String(error)}`));
  }

  /** A message for the session: it joins the running turn, or waits for it to end, or starts a new turn. */
  private deliver(cardId: string, sessionId: string, message: string): void {
    const running = this.turns.get(sessionId);
    const role = this.db.getSession(sessionId)!.role;
    if (!running) return this.startTurn(cardId, sessionId, message, this.turnOptions(role));
    if (running.push(message)) return;
    this.followUps.set(sessionId, [...(this.followUps.get(sessionId) ?? []), message]);
  }

  private async canUseTool(
    cardId: string, session: SessionRow, toolName: string, input: Record<string, unknown>, signal: AbortSignal,
  ): Promise<ToolDecision> {
    if (toolName.startsWith("mcp__hive__")) return { behavior: "allow", updatedInput: input };
    // A card being deleted has nobody to ask, and no row to hang a question on.
    if (this.deleting.has(cardId)) return { behavior: "deny", message: "The card is being deleted.", interrupt: true };
    if (session.role === SPEC_REVIEWER && toolName === "AskUserQuestion") {
      return { behavior: "deny", message: "A blind reviewer has nobody to ask. Put the question in a finding instead." };
    }
    if (session.role === SETUP && toolName === "AskUserQuestion") {
      return { behavior: "deny", message: "Setup runs in the background with nobody to ask. Decide, and say what you decided in your notes." };
    }
    // The keeper's turns are hands-off, though its session's lane is Spec (docs/specs/2026-11-28-spec-keeper.md).
    if (session.role === LANE_ROLE.spec && toolName === "AskUserQuestion" && this.db.getCard(cardId)?.judging) {
      return {
        behavior: "deny",
        message: "As the spec keeper you have nobody to ask. Put it in the judgment as changes-signoff, or report blocked.",
      };
    }

    const item: PendingItem =
      toolName === "AskUserQuestion"
        ? { id: randomUUID(), kind: "question", questions: toQuestions(input.questions) }
        : { id: randomUUID(), kind: "permission", toolName, detail: JSON.stringify(input).slice(0, 500) };
    this.db.insertPending({ item, cardId, sessionId: session.id });
    this.deps.hub.emit({ type: "pending.updated", cardId, pending: item });
    this.setState(cardId, "needs-you");

    let answer: AnswerBody;
    try {
      answer = await new Promise<AnswerBody>((resolve, reject) => {
        this.waiters.set(item.id, { resolve });
        if (signal.aborted) reject(new Error("aborted"));
        else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    } catch {
      this.waiters.delete(item.id);
      this.withdrawn.add(session.id);
      return { behavior: "deny", message: "The question was withdrawn.", interrupt: true };
    }

    if (item.kind === "question" && "answers" in answer) {
      return { behavior: "allow", updatedInput: { ...input, answers: answer.answers } };
    }
    return "allow" in answer && answer.allow
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "The person declined this action." };
  }

  /** A turn that ended with a question still open (stopped, or failed) leaves nothing waiting on it. */
  private dropOpenPending(cardId: string, sessionId: string): void {
    const open = this.db.openPendingFor(cardId);
    if (open && open.sessionId === sessionId && this.waiters.has(open.id)) {
      this.waiters.delete(open.id);
      this.withdrawn.add(sessionId);
      this.db.setPendingAnswer(open.id, { withdrawn: true });
      this.deps.hub.emit({ type: "pending.updated", cardId, pending: null });
    }
  }

  private writeBrief(cardId: string, brief: Brief): string {
    const clean: Brief = {
      title: brief.title.trim(),
      problem: brief.problem.trim(),
      whoItsFor: brief.whoItsFor.trim(),
      whatDoneLooksLike: brief.whatDoneLooksLike,
      outOfScope: brief.outOfScope,
      openPoints: brief.openPoints,
    };
    if (!clean.title || !clean.problem) return "Not saved: title and problem are required.";
    this.db.updateCard(cardId, { brief: clean, title: clean.title });
    this.db.addEvent(cardId, "brief", clean, randomUUID());
    this.deps.hub.emit({ type: "brief.updated", cardId, brief: clean });
    this.emitCard(cardId);
    return "The brief is saved and shown next to the chat.";
  }

  // ---------- the mockup (docs/specs/2026-11-28-mockup-lane-and-designer-role.md) ----------

  /**
   * set_mockup: names the card's current mockup. A page must be an existing .html file whose real path lies inside
   * the card's folder; a link must be https. Answers in text and never throws, like write_brief.
   */
  private setMockup(cardId: string, input: { page?: string; link?: string }): string {
    const card = this.db.getCard(cardId);
    if (!card || card.lane !== "mockup" || !card.mockup || !card.worktreePath) {
      return "Not saved: the card isn't in Mockup any more.";
    }
    const page = typeof input?.page === "string" && input.page.trim() ? input.page.trim() : null;
    const link = typeof input?.link === "string" && input.link.trim() ? input.link.trim() : null;
    if ((page === null) === (link === null)) return "Not saved: set exactly one of page and link.";
    const { folder } = card.mockup;
    let current: MockupRef;
    if (link !== null) {
      let url: URL;
      try {
        url = new URL(link);
      } catch {
        return `Not saved: ${link} isn't a URL.`;
      }
      if (url.protocol !== "https:") return "Not saved: a link must start with https://.";
      current = { kind: "link", url: url.href };
    } else {
      if (!page!.toLowerCase().endsWith(".html")) return `Not saved: the page must be an .html file in ${folder}/.`;
      const worktree = card.worktreePath;
      let realFolder: string;
      let realPage: string;
      try {
        realFolder = realpathSync(join(worktree, folder));
        realPage = realpathSync(resolve(worktree, page!));
      } catch {
        return `Not saved: ${page} doesn't exist. Write the page in ${folder}/ first.`;
      }
      if (!realPage.startsWith(realFolder + sep)) return `Not saved: the page must be inside ${folder}/.`;
      if (!statSync(realPage).isFile()) return `Not saved: ${page} isn't a file.`;
      // Stored as the page's path within the folder as it really is, so `..` or a symlink can't make it point elsewhere.
      current = { kind: "pages", page: `${folder}/${relative(realFolder, realPage).split(sep).join("/")}` };
    }
    this.db.updateCard(cardId, { mockup: { ...card.mockup, current } });
    this.emitMockup(cardId);
    return `The Mockup panel now opens ${current.kind === "pages" ? current.page : current.url}.`;
  }

  /** The card's mockup for the page: what's stored, with the folder's files read now. */
  private mockupInfo(card: CardRow): MockupInfo | null {
    return card.mockup ? { ...card.mockup, files: this.mockupFiles(card) } : null;
  }

  /** The mockup folder's files, relative to it: [] once the folder or the worktree is gone. */
  private mockupFiles(card: CardRow): string[] {
    if (!card.mockup || !card.worktreePath) return [];
    return listMockupFiles(join(card.worktreePath, card.mockup.folder));
  }

  private emitMockup(cardId: string): void {
    const mockup = this.mockupInfo(this.requireCard(cardId));
    if (mockup) this.deps.hub.emit({ type: "mockup.updated", cardId, mockup });
  }

  /**
   * A file of the card's mockup to serve: the folder, and the file's path within it. 404 for no card, no mockup or
   * no worktree, a dot segment, a missing file, or a real path outside the folder.
   */
  mockupFile(cardId: string, path: string): { root: string; file: string } {
    const notFound = new HttpError(404, "No such file in the mockup.");
    const card = this.db.getCard(cardId);
    if (!card?.mockup || !card.worktreePath) throw notFound;
    const segments = path.split("/");
    if (!path || segments.some((s) => s === "" || s.startsWith(".") || s.includes("\\") || s.includes("\0"))) throw notFound;
    let root: string;
    let real: string;
    try {
      root = realpathSync(join(card.worktreePath, card.mockup.folder));
      real = realpathSync(join(root, ...segments));
      if (!statSync(real).isFile()) throw notFound;
    } catch {
      throw notFound;
    }
    if (!real.startsWith(root + sep)) throw notFound;
    return { root, file: relative(root, real) };
  }

  // ---------- the spec on disk ----------

  /** A lane's chat as `you:` / `<label>:` lines, without the hive's notes, for a later role's first message. */
  private chatTranscript(cardId: string, lane: Lane, label: string): string {
    return this.db
      .chatFor(cardId, lane)
      .filter((c): c is Extract<ChatItem, { kind: "message" }> => c.kind === "message" && c.from !== "hive")
      .map((c) => `${c.from === "you" ? "you" : label}: ${c.text}`)
      .join("\n\n");
  }

  private designerFirstMessage(cardId: string): string {
    const card = this.requireCard(cardId);
    const project = this.db.getProject(card.projectId)!;
    const folder = card.mockup!.folder;
    return [
      `The idea for this card, in the project ${project.name}:`,
      "",
      `Title: ${card.ideaTitle}`,
      "",
      `The idea: ${card.ideaText}`,
      "",
      "The brief the product owner wrote with the person:",
      "",
      briefText(card.brief),
      "",
      "The Refine chat:",
      "",
      this.chatTranscript(cardId, "refine", "product owner") || "(empty)",
      "",
      `The mockup's folder is ${folder}/, relative to your working folder. It's empty, and it's the only place you ` +
        "write.",
      "",
      "Open with a first mockup: write its HTML pages in that folder, then name the page to open with set_mockup. " +
        "In your first reply, say in one line that the person can make the mockup in Claude Design instead and paste " +
        "its link here.",
    ].join("\n");
  }

  /** What the spec writer is told about the mockup, by case (Design, The spec writer's first message). */
  private mockupParagraph(card: CardRow): string {
    const mockup = card.mockup;
    if (!mockup) return "The person skipped Mockup, so there's no mockup.";
    const { folder, current, kept } = mockup;
    if (!current) return "The person went on without a mockup. Go by the chat for the look.";
    if (current.kind === "pages") {
      return kept
        ? `The mockup is HTML pages in ${folder}/, and the page the person approved is ${current.page}. They're ` +
            "committed and land with the card. Read them, and point the spec at them as the look."
        : `The mockup is HTML pages in ${folder}/, opening at ${current.page}. The person didn't keep it: read the ` +
            "pages now, but the hive deletes them at sign-off, so the spec mustn't point at them.";
    }
    return kept
      ? `The mockup is a link the person made elsewhere, such as in Claude Design: ${current.url}. You can't open it, ` +
          "since it needs the person's login. Go by the designer's summary of the look in the Mockup chat, and by the " +
          `README.md and any exported files in ${folder}/, which are committed and land with the card.`
      : `The mockup is a link the person made elsewhere, such as in Claude Design: ${current.url}. You can't open it. ` +
          "Go by the designer's summary of the look in the Mockup chat, and by any exported files in " +
          `${folder}/ until sign-off, when the hive deletes them; the spec mustn't point at them.`;
  }

  private specFirstMessage(cardId: string, specPath: string): string {
    const card = this.requireCard(cardId);
    const project = this.db.getProject(card.projectId)!;
    const mockupChat = card.mockup
      ? ["The Mockup chat:", "", this.chatTranscript(cardId, "mockup", "designer") || "(empty)", ""]
      : [];
    return [
      `The idea for this card, in the project ${project.name}:`,
      "",
      `Title: ${card.ideaTitle}`,
      "",
      `The idea: ${card.ideaText}`,
      "",
      "The brief the product owner wrote with the person:",
      "",
      briefText(card.brief),
      "",
      "The Refine chat:",
      "",
      this.chatTranscript(cardId, "refine", "product owner") || "(empty)",
      "",
      ...mockupChat,
      "The mockup:",
      "",
      this.mockupParagraph(card),
      "",
      `Write the whole spec to ${specPath}, relative to your working folder, in one go, following the spec format in ` +
        "your instructions. Then sum up in a few sentences what it proposes.",
    ].join("\n");
  }

  private watchSpec(cardId: string): void {
    const card = this.requireCard(cardId);
    if (!card.worktreePath || !card.specPath) return;
    try {
      this.watch.watch(cardId, card.worktreePath, card.specPath, () => this.refreshSpec(cardId));
    } catch (error) {
      this.log(`Can't watch the spec of card ${cardId}: ${(error as Error).message}`);
    }
  }

  /** Read the spec from disk, work out its review state, and send spec.updated if either changed. */
  private refreshSpec(cardId: string): SpecInfo | null {
    const card = this.db.getCard(cardId);
    if (!card?.specPath || !card.worktreePath) return null;
    const { text, hash } = readSpec(card.worktreePath, card.specPath);
    const writer = this.db.getSessionFor(cardId, "spec", LANE_ROLE.spec!);
    const spec: SpecInfo = {
      path: card.specPath,
      text,
      review: reviewState({
        hash,
        reviewedSpecHash: card.reviewedSpecHash,
        reviewApplying: card.reviewApplying,
        reviewerRunning: this.reviews.has(cardId),
        writerRunning: !!writer && this.turns.has(writer.id),
      }),
    };
    const key = `${hash}|${spec.review}`;
    if (this.lastSpec.get(cardId) !== key) {
      this.lastSpec.set(cardId, key);
      this.deps.hub.emit({ type: "spec.updated", cardId, spec });
    }
    return spec;
  }

  private formatFile(name: string): string {
    const path = join(this.deps.specFormatDir, name);
    try {
      return readFileSync(path, "utf8");
    } catch {
      throw new HttpError(409, `The spec format is missing: ${path}`);
    }
  }

  // ---------- helpers ----------

  private addChat(cardId: string, lane: Lane, from: ChatAuthor, text: string): void {
    const item: ChatItem = { kind: "message", id: randomUUID(), at: new Date().toISOString(), from, text };
    this.db.addEvent(cardId, "chat", { from, text, lane }, item.id, item.at);
    if (this.requireCard(cardId).lane === lane) this.deps.hub.emit({ type: "chat.message", cardId, item });
  }

  private addNote(cardId: string, lane: Lane, text: string): void {
    this.addChat(cardId, lane, "hive", text);
  }

  /**
   * An error line in a lane's chat, with the lane actions it offers. Each action must be in its lane's LANE_ACTIONS,
   * or the page would drop it: a literal lane is checked here, a variable one by errorActions.test.ts.
   */
  private addError<L extends Lane>(cardId: string, lane: L, message: string, actions: NoInfer<LaneErrorAction<L>>[]): void {
    const item: ChatItem = { kind: "error", id: randomUUID(), at: new Date().toISOString(), message, actions };
    this.db.addEvent(cardId, "error", { message, actions, lane }, item.id, item.at);
    if (this.requireCard(cardId).lane === lane) this.deps.hub.emit({ type: "chat.message", cardId, item });
  }

  private setState(cardId: string, state: CardRow["state"]): void {
    this.db.updateCard(cardId, { state });
    this.emitCard(cardId);
  }

  /** The developer changed its task list: store the list as it now stands and send it to the page. */
  private changeChecklist(cardId: string, change: ChecklistChange): void {
    const card = this.db.getCard(cardId);
    if (!card) return;
    const checklist = applyChecklistChange(card.checklist, change);
    if (!checklist) return;
    this.db.updateCard(cardId, { checklist });
    this.deps.hub.emit({ type: "checklist.updated", cardId, checklist });
  }

  private emitCard(id: string): void {
    this.deps.hub.emit({ type: "card.updated", card: cardSummary(this.requireCard(id)) });
  }

  private requireCard(id: string): CardRow {
    const card = this.db.getCard(id);
    if (!card) throw new HttpError(404, "No such card.");
    return card;
  }

  /** A move in flight (Sign off committing the spec) must not race a turn that would change what it moves. */
  private refuseWhileMoving(cardId: string): void {
    if (this.moving.has(cardId)) throw new HttpError(409, "This card is moving. Try again in a moment.");
  }

  /** Every session the card has had: the lane roles' sessions and any reviewer. */
  private cardSessions(cardId: string): SessionRow[] {
    const ids = [...Object.entries(LANE_ROLE).map(([lane, role]) => this.db.getSessionFor(cardId, lane as Lane, role!))];
    const review = this.reviews.get(cardId);
    if (review) ids.push(this.db.getSession(review.sessionId));
    // Setup runs in the background, except while Build waits for it: then it's the card's running turn, and Stop ends it.
    if (this.db.getCard(cardId)?.lane === "build") ids.push(this.db.getSessionFor(cardId, "refine", SETUP));
    return ids.filter((s): s is SessionRow => !!s);
  }

  /** A turn is running on the card, or its developer is being started (bringing in main comes first). */
  private anyTurnRunning(cardId: string): boolean {
    if (this.starting.has(cardId) || this.cardSessions(cardId).some((s) => this.turns.has(s.id))) return true;
    // Build waiting for a setup that is still listing files, before its turn starts.
    const card = this.db.getCard(cardId);
    return card?.lane === "build" && card.setup?.status === "running";
  }

  /** The session of the card's current lane's role. */
  private requireLaneSession(cardId: string): SessionRow {
    const card = this.requireCard(cardId);
    const role = LANE_ROLE[card.lane];
    const session = role ? this.db.getSessionFor(cardId, card.lane, role) : undefined;
    if (!session) throw new HttpError(409, "This card has no conversation yet. Drag it to Refine first.");
    return session;
  }
}

/** How many of a mockup folder's files the page lists. */
const MOCKUP_FILES = 200;

/**
 * A mockup folder's files, relative to it, sorted and cut at MOCKUP_FILES. Dot entries are skipped, and symlinks are
 * neither listed nor followed. [] when the folder is missing.
 */
export function listMockupFiles(folder: string): string[] {
  const files: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith(".") || files.length >= 10_000) continue;
      const path = join(dir, name);
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(path, `${prefix}${name}/`);
      else if (stat.isFile()) files.push(`${prefix}${name}`);
    }
  };
  walk(folder, "");
  return files.sort().slice(0, MOCKUP_FILES);
}

/**
 * A kept Claude Design mockup's README.md: the card's title and its link, or the link line added to a README that's
 * already there, unless the link is already in it.
 */
function writeMockupReadme(folder: string, title: string, url: string): void {
  const line = `The mockup for this card, made in Claude Design: ${url}`;
  const path = join(folder, "README.md");
  mkdirSync(folder, { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, `# ${title}\n\n${line}\n\nAny files exported from it sit beside this README.\n`);
    return;
  }
  const text = readFileSync(path, "utf8");
  if (text.includes(url)) return;
  appendFileSync(path, `${text.endsWith("\n") || text === "" ? "" : "\n"}\n${line}\n`);
}

export function cardSummary(c: CardRow): CardSummary {
  return { id: c.id, projectId: c.projectId, title: c.title, lane: c.lane, state: c.state, moveError: c.moveError };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** git's reason as a sentence, so the hive's next sentence doesn't run on from it. */
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

function toQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((q: any) => ({
    question: String(q?.question ?? ""),
    header: String(q?.header ?? ""),
    options: Array.isArray(q?.options)
      ? q.options.map((o: any) => ({ label: String(o?.label ?? ""), description: String(o?.description ?? "") }))
      : [],
    multiSelect: !!q?.multiSelect,
  }));
}

function isAnswers(body: AnswerBody): body is { answers: Record<string, string> } {
  const answers = (body as { answers?: unknown }).answers;
  return typeof answers === "object" && answers !== null && !Array.isArray(answers)
    && Object.values(answers).every((v) => typeof v === "string");
}

function summarizeAnswers(answers: Record<string, string>): string {
  return Object.values(answers).join("\n");
}

/** An answer whose turn is gone, sent as a new turn with the question and options it asked (spec: Questions). */
export function answerAsMessage(questions: Question[], answers: Record<string, string>): string {
  const parts = questions.map((q) => {
    const options = q.options.map((o) => `- ${o.label}`).join("\n");
    return `${q.question}\n${options}\nMy answer: ${answers[q.question] ?? "(no answer)"}`;
  });
  return `Earlier you asked me this, but your turn ended before I answered:\n\n${parts.join("\n\n")}`;
}
