// The hive's orchestration: projects, cards and their moves, and every session's turns, from Ideas through Refine,
// Spec, Plan, Build, Check and Try it, with each card's worktree setup (docs/specs/2026-11-26-board-refine-chat.md,
// docs/specs/2026-11-26-spec-lane-review-gate.md, docs/specs/2026-11-26-build-lane-developer.md,
// docs/specs/2026-11-27-check-lane-reviewer.md, docs/specs/2026-11-27-worktree-setup-and-try-it.md).
// Plain code decides; Claude sessions only do the work (packages/backend/CLAUDE.md, Rules).
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import type {
  AnswerBody, BoardResponse, Brief, Bug, CardDetail, CardSummary, ChatAuthor, ChatItem, CheckRound, ErrorAction,
  FeedbackBody, FileChange, ForYouItem, ForYouResponse, Landed, LandBody, Lane, PendingItem, Plan, Question,
  RoleInfo, RolesResponse, SetupReport, ShipPlan, SpecInfo, UpdateIdeaBody,
} from "@hive/shared";
import { CARD_PORTS, LANES, lanesBefore } from "@hive/shared";
import {
  CHECK_ROUNDS, canMove, laneAfter, laneAfterBuild, laneAfterCheck, laneAfterLanding, laneAfterPlan,
} from "./board/moves";
import { waitsForYou, whatItWants } from "./board/forYou";
import { HiveDb, projectSummary, type CardRow, type SessionRow } from "./db";
import type { EventHub } from "./events";
import { describeHiveTool, type HiveToolName } from "./sessions/hiveTools";
import { PLANNED_ROLES, type RoleEntry } from "./sessions/roles";
import type {
  HiveTools, Role, RunningTurn, SessionRunner, ToolDecision, TrustProbe, TurnOutcome,
} from "./sessions/types";
import { readSpec, reviewState, SpecWatch, specPathFor } from "./spec";
import {
  CHECK_SCHEMA, COMMIT_SCHEMA, DEVELOPER_SCHEMA, findingsMessage, parseCheckReport, parseCommitReport,
  parseDeveloperReport, parsePlanReport, parseReviewReport, parseSetupReport, PLAN_SCHEMA, REVIEW_SCHEMA, SETUP_SCHEMA,
} from "./spec/reports";
import type { CopyOutcome, LocalFileList, MainBase, MergeResult, PushResult, SquashResult } from "./git";
import { fakeApps, runToEnd, type AppEntry, type AppRunner } from "./preview/apps";
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
  spec: "spec-writer",
  plan: "planner",
  build: "developer",
  check: "reviewer",
};
/** The blind spec reviewer of the review gate; Check's reviewer is LANE_ROLE.check. */
const SPEC_REVIEWER = "spec-reviewer";
/** The worktree's setup session: in the background, its sessions are filed under Refine, where the worktree is made. */
const SETUP = "setup";
const CHAT_LANES: Lane[] = ["refine", "spec"];

/** What a role's sessions get beyond its file. */
interface RoleTurn {
  /** Files from the spec format's folder, appended after the role's instructions. */
  specFormat?: string[];
  /** The fixed-format report each turn must end with (`outputFormat`). */
  report?: Record<string, unknown>;
  /** The hive's own tools its sessions are offered. */
  tools?: HiveToolName[];
}

/**
 * The one table of what each role gets beyond its file. turnOptions(), startTurn(), the committer's turn and the Role
 * prompts page all read it, so the page can't drift from what sessions get
 * (docs/specs/2026-11-27-role-prompts-page.md, Key decisions).
 */
const ROLE_TURNS: Record<string, RoleTurn> = {
  "product-owner": { tools: ["write_brief"] },
  setup: { report: SETUP_SCHEMA, tools: ["copy_local_files"] },
  "spec-writer": { specFormat: ["format.md"] },
  "spec-reviewer": { report: REVIEW_SCHEMA },
  planner: { specFormat: ["format.md"], report: PLAN_SCHEMA },
  developer: { report: DEVELOPER_SCHEMA },
  reviewer: { report: CHECK_SCHEMA },
  committer: { report: COMMIT_SCHEMA },
};

const AUTHOR: Record<string, ChatAuthor> = {
  "product-owner": "product-owner",
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
    for (const c of s.start) lines.push(`- Start ${c.what}: \`${c.command}\`${c.url ? ` (${c.url})` : ""}`);
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
    const entry: AppEntry = { what: s.what, command: s.command, dir, port, url: s.url };
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
      spec: card.specPath ? this.refreshSpec(card.id) : null,
      specPath: card.specPath,
      plan: card.plan,
      build: card.build,
      check: card.check,
      setup: card.setup,
      port: card.port,
      feedback: card.feedback,
      apps: card.lane === "tryit" ? this.apps.status(card.id) : [],
      appStopped: card.appStopped,
      landed: card.landed,
      landing: this.landingProjects.get(card.projectId) === card.id,
      issues: this.db.issuesFor(card.id),
      decisions: this.db.decisionsFor(card.id),
      chat: this.db.chatFor(card.id, card.lane),
      pastChats: this.pastChats(card.id, card.lane),
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
    const empty = { model: null, kind: null, instructions: "", extras: [], report: null, tools: [] };
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
        const review = card.lane === "spec" && card.specPath ? (this.refreshSpec(card.id)?.review ?? null) : null;
        const { kind, text } = whatItWants({
          lane: card.lane, pending, lastChat: this.db.lastChatItem(card.id, card.lane), review,
        });
        return {
          card: cardSummary(card),
          projectName: projects.get(card.projectId) ?? "",
          since: card.waitingSince,
          kind,
          text,
          pending: kind === "question" || kind === "permission" ? pending : null,
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

  /** Refine → Spec when you say Good. Mockup is skipped in this slice. */
  async good(cardId: string): Promise<CardSummary> {
    const card = this.requireCard(cardId);
    const to = laneAfter(card.lane, "good");
    if (!to) throw new HttpError(409, "Good moves a card on from Refine.");
    if (this.anyTurnRunning(cardId) || this.db.openPendingFor(cardId)) {
      throw new HttpError(409, "Wait for the product owner to finish.");
    }
    const options = this.turnOptions(LANE_ROLE.spec!); // reads format.md: a missing one refuses here, before the move
    this.formatFile("review.md"); // the review gate needs it later; refuse now rather than in the middle of Spec
    return this.oneMoveAtATime(cardId, async () => {
      const role = this.deps.role(LANE_ROLE.spec!);
      const specPath = specPathFor(card.worktreePath!, card.brief?.title || card.title, (this.deps.today ?? localDate)());
      this.db.updateCard(cardId, { lane: to, specPath, reviewedSpecHash: null, reviewApplying: false });
      const sessionId = randomUUID();
      this.db.insertSession({ id: sessionId, cardId, lane: to, role: LANE_ROLE.spec!, kind: role.kind });
      this.watchSpec(cardId);
      this.startTurn(cardId, sessionId, this.specFirstMessage(cardId, specPath), options);
      return cardSummary(this.requireCard(cardId));
    });
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
      this.watch.unwatch(cardId);
      this.db.updateCard(cardId, { lane: to });
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
    if (!to) throw new HttpError(409, "Only a card in Plan or Build can go back to Spec.");
    const who = from === "build" ? "developer" : "planner";
    if (this.anyTurnRunning(cardId)) throw new HttpError(409, `Wait for the ${who} to finish.`);
    const last = this.db.lastChatItem(cardId, from);
    if (!last || last.kind !== "error" || !last.actions.includes("back-to-spec")) {
      throw new HttpError(409, `Only a blocked ${from === "build" ? "build" : "plan"} goes back to Spec.`);
    }
    const writer = this.db.getSessionFor(cardId, "spec", LANE_ROLE.spec!);
    if (!writer) throw new HttpError(409, "This card has no spec writer to go back to.");
    return this.oneMoveAtATime(cardId, async () => {
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
      // Stored Try it feedback goes with it: the developer's reason carries it to the spec writer, and after the new
      // sign-off the developer must get the new plan.
      this.db.updateCard(cardId, {
        lane: to, reviewedSpecHash: null, reviewApplying: false, feedback: null, shipAfterCheck: false,
      });
      this.watchSpec(cardId);
      this.startTurn(cardId, writer.id, [
        `The ${who} couldn't ${from === "build" ? "build" : "plan"} from the signed-off spec. What it reported:`,
        "",
        last.message,
        "",
        "Revise the spec to resolve this, then say briefly what you changed. It needs a new review and sign-off.",
      ].join("\n"), this.turnOptions(LANE_ROLE.spec!));
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
    return this.oneMoveAtATime(cardId, async () => {
      this.addNote(cardId, "check", "You moved the card on to Try it as built.");
      await this.stopCardServers(cardId, "check");
      this.db.updateCard(cardId, { lane: to, shipAfterCheck: false });
      this.emitCard(cardId);
      void this.startApp(cardId).catch((error: unknown) => this.log(`Starting the app of card ${cardId} failed: ${String(error)}`));
      return cardSummary(this.requireCard(cardId));
    });
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
    const lane = this.db.getSession(pending.sessionId)?.lane ?? this.requireCard(pending.cardId).lane;

    this.db.setPendingAnswer(itemId, body);
    this.deps.hub.emit({ type: "pending.updated", cardId: pending.cardId, pending: null });
    // Your answer stays in the chat however it was given, since the question card goes once it's answered.
    if (isAnswers(body) && !opts.alreadyInChat) {
      this.addChat(pending.cardId, lane, "you", summarizeAnswers(body.answers));
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
    this.startTurn(cardId, writer.id, findingsMessage(report.findings), options);
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
    const fail = (message: string, actions: ErrorAction[]) => this.addError(cardId, "plan", message, actions);
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
    this.endSetup(cardId, { done: report });
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
    if (!text) throw new HttpError(400, "Write what's wrong first.");
    if (body.lane !== undefined && body.lane !== "build") throw new HttpError(400, "Only Build takes feedback for now.");
    const card = this.requireCard(cardId);
    const to = laneAfter(card.lane, "feedback");
    if (!to) throw new HttpError(409, "Only a card in Try it can be sent back with feedback.");
    if (this.anyTurnRunning(cardId)) throw new HttpError(409, "Wait for the running turn to finish.");
    return this.oneMoveAtATime(cardId, async () => {
      await this.apps.clear(cardId);
      const developer = this.db.getSessionFor(cardId, "build", LANE_ROLE.build!);
      this.db.transaction(() => {
        this.db.updateCard(cardId, {
          lane: to, build: null, check: null, feedback: text, appStopped: false, shipAfterCheck: false,
        });
        if (developer) this.db.updateSession(developer.id, { lastMessage: null });
        this.db.addEvent(cardId, "feedback", { text }, randomUUID());
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
    const stop = async (message: string, actions: ErrorAction[] = ["retry"]) => {
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
        onTextDelta: () => {}, onTextBlock: () => {}, onActivity: () => {}, onSessionCreated: () => {},
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
    try {
      const entering = this.requireCard(cardId);
      const feedback = entering.feedback;
      const fromCheck = !feedback && entering.check && entering.check.bugs.length > 0 ? entering.check : null;
      if (feedback || fromCheck) {
        await this.stopCardServers(cardId, feedback ? (entering.shipAfterCheck ? "ship" : "tryit") : "check");
      }

      // A new visit starts without a report (Card.build is set only between a done report and the move to Check),
      // and without a last message: until this visit's first turn starts, Retry starts the developer afresh,
      // bringing in main again, instead of re-sending an earlier visit's message with its old plan. Cleared before
      // waiting for setup, so the setup's end sees a developer that hasn't started this visit.
      this.db.updateCard(cardId, { build: null });
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
      }
      // Said in the fix messages as well as in the role, since a session keeps the instructions of its first turn.
      const wholeBuild = "Your report replaces the card's build report, so its summary and departures describe the " +
        "whole build as it stands now. List only the issues and decisions that are new since your last report.";
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
          ]
        : feedback
        ? [
            "The person tried the card's build and found this:",
            "",
            feedback,
            "",
            "Fix it, then end with your report.",
            "",
            `Bringing in ${base.ref}: ${mergeInstruction(merge, base.ref)}`,
            "",
            "`git status` may show files left from trying the app. Remove what doesn't belong before you report.",
            "",
            wholeBuild,
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
    const fail = (message: string, actions: ErrorAction[]) => this.addError(cardId, "build", message, actions);
    if (stopped || (outcome.kind === "ok" && outcome.interrupted)) return fail("The developer was stopped.", ["retry"]);
    if (outcome.kind === "error") return fail(`The developer failed: ${outcome.message}`, ["retry"]);
    const report = parseDeveloperReport(outcome.report);
    if (!report) return fail("The developer didn't return a report.", ["retry", "back-to-spec"]);
    if (report.status === "blocked") {
      return fail(`The developer couldn't build this: ${report.reason}`, ["retry", "back-to-spec"]);
    }
    const card = this.requireCard(cardId);
    const mergeUnfinished = await this.deps.git.mergeInProgress(card.worktreePath!);
    if (laneAfterBuild("done", mergeUnfinished) !== "check") {
      return fail("The developer reported done, but the merge of main isn't finished.", ["retry", "back-to-spec"]);
    }
    // The report is stored before the checkpoint, so nothing in it is lost if git refuses the commit.
    this.db.transaction(() => {
      // Your Try it feedback is handled once the developer reports done.
      this.db.updateCard(cardId, {
        build: { summary: report.summary, departures: report.departures, files: [] }, feedback: null,
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
      list(this.db.issuesFor(card.id).map((i) => `${i.where}: ${i.problem}`)),
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
    return withRunning(card, parts).join("\n");
  }

  private onReviewerEnded(cardId: string, outcome: TurnOutcome, stopped: boolean): void {
    const fail = (message: string, actions: ErrorAction[]) => this.addError(cardId, "check", message, actions);
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
    const to = laneAfterCheck("done", check.bugs.length, check.round, card.shipAfterCheck);
    const bugs = count(check.bugs.length, "bug", "bugs");
    const developer = this.db.getSessionFor(cardId, "build", LANE_ROLE.build!);
    // The round and the move land together, so a restart can't fall between them. Going back to Build clears the
    // build report and the developer's last message, as every entry to Build does, so a restart before the developer
    // starts offers "Build hasn't started yet" and its Retry starts it with these bugs.
    this.db.transaction(() => {
      for (const issue of report.issues) this.db.addIssue(cardId, { foundIn: "check", ...issue });
      this.db.addEvent(cardId, "check", { ...check, issues: report.issues }, randomUUID());
      if (to === "tryit" || to === "ship") {
        this.addNote(cardId, "check", to === "ship" ? `Round ${check.round}: no bugs. Back to Ship.` : `Round ${check.round}: no bugs.`);
        this.db.updateCard(cardId, { check, lane: to, shipAfterCheck: false });
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
    if (to === "ship") void this.stopCardServers(cardId, "check");
    if (to === "tryit") {
      void this.stopCardServers(cardId, "check")
        .then(() => this.startApp(cardId))
        .catch((error: unknown) => this.log(`Starting the app of card ${cardId} failed: ${String(error)}`));
    }
    if (to === "build") {
      void this.startDeveloper(cardId)
        .catch((error: unknown) => this.log(`Starting the developer of card ${cardId} failed: ${String(error)}`));
    }
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
    this.addError(card.id, "check", "Check hasn't started yet.", ["retry"]);
    this.setState(card.id, "needs-you");
  }

  /** A card in Build with nothing running and no error line offering Retry gets one. */
  private offerBuildWayOn(card: CardRow): void {
    if (this.anyTurnRunning(card.id)) return;
    const last = this.db.lastChatItem(card.id, "build");
    if (last?.kind === "error" && last.actions.includes("retry")) return;
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
    };
  }

  private startTurn(cardId: string, sessionId: string, message: string, options: TurnOptions = {}): void {
    const card = this.requireCard(cardId);
    const session = this.db.getSession(sessionId)!;
    const { background, ...turnOptions } = options;
    // The spec reviewer's report and a background setup's working are for the hive, not for the chat.
    const quiet = session.role === SPEC_REVIEWER || !!background;
    const hiveTools = this.hiveToolsFor(session.role, cardId);
    this.db.updateSession(sessionId, { turnRunning: true, lastMessage: message });
    this.withdrawn.delete(sessionId);
    if (!background) {
      this.setState(cardId, "working");
      this.deps.hub.emit({ type: "turn.started", cardId });
    }

    const turn: RunningTurn = this.deps.runner.start(
      {
        sessionId,
        resume: session.existsYet,
        cwd: card.worktreePath!,
        role: this.deps.role(session.role),
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
          if (!quiet && !this.deleting.has(cardId)) this.addChat(cardId, session.lane, AUTHOR[session.role] ?? "hive", text);
        },
        onActivity: (text) => {
          if (!background) this.deps.hub.emit({ type: "chat.activity", cardId, text });
        },
        onSessionCreated: () => this.db.updateSession(sessionId, { existsYet: true }),
        canUseTool: (toolName, input, signal) => this.canUseTool(cardId, session, toolName, input, signal),
      },
    );
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
        else if (session.role === LANE_ROLE.spec && this.requireCard(cardId).reviewApplying) {
          this.onWriterEnded(cardId, outcome, stopped, withdrew);
        } else if (outcome.kind === "error" && !stopped) {
          this.addError(cardId, session.lane, outcome.message, ["retry"]);
        }

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

  // ---------- the spec on disk ----------

  private specFirstMessage(cardId: string, specPath: string): string {
    const card = this.requireCard(cardId);
    const project = this.db.getProject(card.projectId)!;
    const chat = this.db
      .chatFor(cardId, "refine")
      .filter((c): c is Extract<ChatItem, { kind: "message" }> => c.kind === "message" && c.from !== "hive")
      .map((c) => `${c.from === "you" ? "you" : "product owner"}: ${c.text}`)
      .join("\n\n");
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
      chat || "(empty)",
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

  private addError(cardId: string, lane: Lane, message: string, actions: ErrorAction[]): void {
    const item: ChatItem = { kind: "error", id: randomUUID(), at: new Date().toISOString(), message, actions };
    this.db.addEvent(cardId, "error", { message, actions, lane }, item.id, item.at);
    if (this.requireCard(cardId).lane === lane) this.deps.hub.emit({ type: "chat.message", cardId, item });
  }

  private setState(cardId: string, state: CardRow["state"]): void {
    this.db.updateCard(cardId, { state });
    this.emitCard(cardId);
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
