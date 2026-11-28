// SQLite through better-sqlite3. This slice creates only the tables it uses (spec: Data).
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { titleFromIdea } from "./titleFromIdea";
import type {
  Brief, BuildReport, CardState, ChatItem, ChecklistItem, CheckRound, Decision, IssueAnswer, IssueJudgment, IssueStatus,
  Landed, SetupReport, ErrorAction, Lane, PendingItem, Plan, ProjectSummary, SpecIssue,
} from "@hive/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  trust_warning INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  idea_text TEXT NOT NULL,
  lane TEXT NOT NULL,
  state TEXT NOT NULL,
  branch TEXT,
  worktree_path TEXT,
  brief TEXT,
  move_error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id),
  lane TEXT NOT NULL,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  started_at TEXT NOT NULL,
  turn_running INTEGER NOT NULL DEFAULT 0,
  exists_yet INTEGER NOT NULL DEFAULT 0,
  last_message TEXT
);
CREATE TABLE IF NOT EXISTS pending_items (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  answer TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id),
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_card ON events(card_id, at);
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id),
  found_in TEXT NOT NULL,
  spec_section TEXT NOT NULL,
  problem TEXT NOT NULL,
  guess TEXT NOT NULL,
  verdict TEXT,
  level TEXT,
  reason TEXT,
  flips INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id),
  lane TEXT NOT NULL,
  what TEXT NOT NULL,
  alternative TEXT NOT NULL,
  session_id TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

/** Columns added after the first slice; added to an existing database on open. */
const ADDED_COLUMNS: { table: string; column: string; type: string }[] = [
  { table: "cards", column: "idea_title", type: "TEXT" },
  { table: "cards", column: "spec_path", type: "TEXT" },
  { table: "cards", column: "reviewed_spec_hash", type: "TEXT" },
  { table: "cards", column: "review_applying", type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "cards", column: "plan", type: "TEXT" },
  { table: "cards", column: "build", type: "TEXT" },
  { table: "cards", column: "check_round", type: "TEXT" },
  { table: "cards", column: "setup", type: "TEXT" },
  { table: "cards", column: "port", type: "INTEGER" },
  { table: "cards", column: "feedback", type: "TEXT" },
  { table: "cards", column: "app_stopped", type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "cards", column: "landing", type: "TEXT" },
  { table: "cards", column: "landed", type: "TEXT" },
  { table: "cards", column: "ship_after_check", type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "cards", column: "waiting_since", type: "TEXT" },
  { table: "cards", column: "checklist", type: "TEXT" },
  { table: "cards", column: "judging", type: "TEXT" },
  { table: "cards", column: "keeper_fixes", type: "TEXT" },
  { table: "cards", column: "keeper_rounds", type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "cards", column: "block_judged", type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "issues", column: "status", type: "TEXT NOT NULL DEFAULT 'open'" },
  { table: "issues", column: "recommendation", type: "TEXT" },
  { table: "issues", column: "repeats", type: "TEXT" },
  { table: "issues", column: "answer", type: "TEXT" },
];

/**
 * The spec keeper's turn under way, kept until it succeeds so Retry and a restart can tell what it was judging
 * (docs/specs/2026-11-28-spec-keeper.md, The batch). `answers` changes the spec after your answers; the others judge.
 */
export interface KeeperJudging {
  kind: "batch" | "as-built" | "blocking" | "answers";
  /** The issues the turn is about. */
  issueIds: string[];
}

/** Issues going to the developer as code fixes, and the lane they come from; cleared on its next `done` report. */
export interface KeeperFixes {
  from: Lane;
  ids: string[];
}

/** A landing under way: stored before the push, so a hive restart can finish it or undo it. */
export interface Landing {
  base: string;
  commit: string;
  pushed: boolean;
}

export interface ProjectRow {
  id: string;
  name: string;
  path: string;
  trustWarning: boolean;
}

export interface CardRow {
  id: string;
  projectId: string;
  title: string;
  /** The idea's title as you typed it; `title` starts as this and the brief's title replaces it. */
  ideaTitle: string;
  ideaText: string;
  lane: Lane;
  state: CardState;
  branch: string | null;
  worktreePath: string | null;
  brief: Brief | null;
  moveError: string | null;
  /** Relative to the worktree; set when the card enters Spec. */
  specPath: string | null;
  /** The hash of the text the last finished review produced; Sign off needs the file to match it. */
  reviewedSpecHash: string | null;
  /** A review's findings were sent to the spec writer and haven't been applied in full yet. */
  reviewApplying: boolean;
  plan: Plan | null;
  /** The developer's last `done` report. */
  build: BuildReport | null;
  /** Check's last finished round since the last plan. */
  check: CheckRound | null;
  /** The worktree's setup, once one has started. */
  setup: SetupReport | null;
  /** The first of the card's ports, once it has them. */
  port: number | null;
  /** Your Try it feedback, while the developer works on it. */
  feedback: string | null;
  /** You stopped the card's app in Try it, so a hive restart or a finished setup leaves it stopped. */
  appStopped: boolean;
  /** A landing under way (docs/specs/2026-11-27-ship-lane.md). */
  landing: Landing | null;
  /** Where the card landed. */
  landed: Landed | null;
  /** Ship sent the card back to Build: after Check it returns to Ship, not Try it. */
  shipAfterCheck: boolean;
  /**
   * The developer session's own task list, null until it starts one; emptied only when a new developer session
   * starts (docs/specs/2026-11-28-build-lane-checklist.md).
   */
  checklist: ChecklistItem[] | null;
  /** The spec keeper's turn under way, or one that failed and waits for Retry. */
  judging: KeeperJudging | null;
  /** Code fixes the developer is to make, from the spec keeper or your held answers. */
  keeperFixes: KeeperFixes | null;
  /** Keeper fix rounds since sign-off; capped by KEEPER_FIX_ROUNDS. */
  keeperRounds: number;
  /** This Build visit has had its keeper turn for a blocked report. */
  blockJudged: boolean;
  /**
   * When the card started waiting for you: set by the database whenever the card becomes `needs-you` or changes lane
   * while it is (docs/specs/2026-11-27-for-you.md). Meaningless while the card is working.
   */
  waitingSince: string;
}

export interface SessionRow {
  id: string;
  cardId: string;
  lane: Lane;
  role: string;
  kind: string;
  turnRunning: boolean;
  existsYet: boolean;
  lastMessage: string | null;
}

export interface PendingRow {
  id: string;
  cardId: string;
  sessionId: string;
  item: PendingItem;
  answered: boolean;
}

const now = () => new Date().toISOString();

export class HiveDb {
  readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    for (const { table, column, type } of ADDED_COLUMNS) {
      const has = (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
        (c) => c.name === column,
      );
      if (has) continue;
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      // Cards already there when the column arrives take their newest history row as the start of their wait.
      if (column === "waiting_since") {
        this.db.exec(`UPDATE cards SET waiting_since = COALESCE(
          (SELECT MAX(at) FROM events WHERE events.card_id = cards.id), created_at)`);
      }
    }
    // Every card has an idea title: older ones take the first sentence of their text.
    const untitled = this.db.prepare("SELECT id, idea_text FROM cards WHERE idea_title IS NULL").all() as
      { id: string; idea_text: string }[];
    const fill = this.db.prepare("UPDATE cards SET idea_title = ? WHERE id = ?");
    for (const row of untitled) fill.run(titleFromIdea(row.idea_text), row.id);
  }

  close(): void {
    this.db.close();
  }

  // ---------- projects ----------

  listProjects(): ProjectRow[] {
    return (this.db.prepare("SELECT * FROM projects ORDER BY created_at").all() as any[]).map(toProject);
  }

  getProject(id: string): ProjectRow | undefined {
    const r = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return r ? toProject(r) : undefined;
  }

  getProjectByPath(path: string): ProjectRow | undefined {
    const r = this.db.prepare("SELECT * FROM projects WHERE path = ?").get(path);
    return r ? toProject(r) : undefined;
  }

  insertProject(p: ProjectRow): void {
    this.db
      .prepare("INSERT INTO projects (id, name, path, trust_warning, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(p.id, p.name, p.path, p.trustWarning ? 1 : 0, now());
  }

  setTrustWarning(id: string, warning: boolean): void {
    this.db.prepare("UPDATE projects SET trust_warning = ? WHERE id = ?").run(warning ? 1 : 0, id);
  }

  // ---------- cards ----------

  listCards(): CardRow[] {
    return (this.db.prepare("SELECT * FROM cards ORDER BY created_at").all() as any[]).map(toCard);
  }

  getCard(id: string): CardRow | undefined {
    const r = this.db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
    return r ? toCard(r) : undefined;
  }

  /** A new card has no checklist: only a developer session gives it one. */
  insertCard(
    c: Omit<CardRow, "waitingSince" | "checklist" | "judging" | "keeperFixes" | "keeperRounds" | "blockJudged">,
  ): void {
    const at = now();
    this.db
      .prepare(
        `INSERT INTO cards (id, project_id, title, idea_title, idea_text, lane, state, branch, worktree_path, brief, move_error,
           spec_path, reviewed_spec_hash, review_applying, plan, build, check_round, setup, port, feedback, app_stopped,
           landing, landed, ship_after_check, waiting_since, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.id, c.projectId, c.title, c.ideaTitle, c.ideaText, c.lane, c.state, c.branch, c.worktreePath,
        c.brief ? JSON.stringify(c.brief) : null, c.moveError, c.specPath, c.reviewedSpecHash,
        c.reviewApplying ? 1 : 0, c.plan ? JSON.stringify(c.plan) : null, c.build ? JSON.stringify(c.build) : null,
        c.check ? JSON.stringify(c.check) : null, c.setup ? JSON.stringify(c.setup) : null, c.port, c.feedback,
        c.appStopped ? 1 : 0, c.landing ? JSON.stringify(c.landing) : null, c.landed ? JSON.stringify(c.landed) : null,
        c.shipAfterCheck ? 1 : 0, at, at);
  }

  /**
   * Writes the patch. A patch that leaves the card `needs-you` after it was working, or in another lane than before,
   * also restarts `waiting_since`: every state change goes through here, restart recovery included, so none can miss it.
   */
  updateCard(id: string, patch: Partial<Omit<CardRow, "id" | "projectId" | "waitingSince">>): void {
    const cols: Record<string, string> = {
      title: "title", ideaTitle: "idea_title", ideaText: "idea_text", lane: "lane", state: "state", branch: "branch",
      worktreePath: "worktree_path", brief: "brief", moveError: "move_error", specPath: "spec_path",
      reviewedSpecHash: "reviewed_spec_hash", reviewApplying: "review_applying", plan: "plan", build: "build",
      check: "check_round", setup: "setup", port: "port", feedback: "feedback", appStopped: "app_stopped",
      landing: "landing", landed: "landed", shipAfterCheck: "ship_after_check", checklist: "checklist",
      judging: "judging", keeperFixes: "keeper_fixes", keeperRounds: "keeper_rounds", blockJudged: "block_judged",
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const col = cols[key];
      if (!col) continue;
      sets.push(`${col} = ?`);
      if (["brief", "plan", "build", "check", "setup", "landing", "landed", "checklist", "judging", "keeperFixes"].includes(key)) {
        values.push(value ? JSON.stringify(value) : null);
      }
      else if (["reviewApplying", "appStopped", "shipAfterCheck", "blockJudged"].includes(key)) values.push(value ? 1 : 0);
      else values.push(value);
    }
    if (sets.length === 0) return;
    if (patch.state !== undefined || patch.lane !== undefined) {
      const before = this.db.prepare("SELECT state, lane FROM cards WHERE id = ?").get(id) as
        { state: CardState; lane: Lane } | undefined;
      const state = patch.state ?? before?.state;
      const lane = patch.lane ?? before?.lane;
      if (before && state === "needs-you" && (before.state !== "needs-you" || before.lane !== lane)) {
        sets.push("waiting_since = ?");
        values.push(now());
      }
    }
    this.db.prepare(`UPDATE cards SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }

  /**
   * Deletes a card and every row that belongs to it, in one transaction and children first, since they reference the
   * card (docs/specs/2026-11-27-delete-a-card.md).
   */
  deleteCard(id: string): void {
    this.transaction(() => {
      for (const table of ["pending_items", "events", "issues", "decisions", "sessions"]) {
        this.db.prepare(`DELETE FROM ${table} WHERE card_id = ?`).run(id);
      }
      this.db.prepare("DELETE FROM cards WHERE id = ?").run(id);
    });
  }

  // ---------- sessions ----------

  insertSession(s: { id: string; cardId: string; lane: Lane; role: string; kind: string }): void {
    this.db
      .prepare("INSERT INTO sessions (id, card_id, lane, role, kind, started_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(s.id, s.cardId, s.lane, s.role, s.kind, now());
  }

  /** Every session of a card. */
  sessionsFor(cardId: string): SessionRow[] {
    return (this.db.prepare("SELECT * FROM sessions WHERE card_id = ?").all(cardId) as any[]).map(toSession);
  }

  /** The card's session in a lane with a role (one per card per lane and role), the newest if there are several. */
  getSessionFor(cardId: string, lane: Lane, role: string): SessionRow | undefined {
    const r = this.db
      .prepare(
        "SELECT * FROM sessions WHERE card_id = ? AND lane = ? AND role = ? ORDER BY started_at DESC, rowid DESC LIMIT 1",
      )
      .get(cardId, lane, role);
    return r ? toSession(r) : undefined;
  }

  getSession(id: string): SessionRow | undefined {
    const r = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    return r ? toSession(r) : undefined;
  }

  listRunningSessions(): SessionRow[] {
    return (this.db.prepare("SELECT * FROM sessions WHERE turn_running = 1").all() as any[]).map(toSession);
  }

  updateSession(
    id: string, patch: { turnRunning?: boolean; existsYet?: boolean; lastMessage?: string | null },
  ): void {
    if (patch.turnRunning !== undefined)
      this.db.prepare("UPDATE sessions SET turn_running = ? WHERE id = ?").run(patch.turnRunning ? 1 : 0, id);
    if (patch.existsYet !== undefined)
      this.db.prepare("UPDATE sessions SET exists_yet = ? WHERE id = ?").run(patch.existsYet ? 1 : 0, id);
    if (patch.lastMessage !== undefined)
      this.db.prepare("UPDATE sessions SET last_message = ? WHERE id = ?").run(patch.lastMessage, id);
  }

  // ---------- pending items ----------

  insertPending(p: { item: PendingItem; cardId: string; sessionId: string }): void {
    const { id, kind, ...payload } = p.item;
    this.db
      .prepare("INSERT INTO pending_items (id, card_id, session_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, p.cardId, p.sessionId, kind, JSON.stringify(payload), now());
  }

  getPending(id: string): PendingRow | undefined {
    const r = this.db.prepare("SELECT * FROM pending_items WHERE id = ?").get(id);
    return r ? toPending(r) : undefined;
  }

  /** The card's unanswered item, if any. */
  openPendingFor(cardId: string): PendingRow | undefined {
    const r = this.db
      .prepare("SELECT * FROM pending_items WHERE card_id = ? AND answer IS NULL ORDER BY created_at DESC LIMIT 1")
      .get(cardId);
    return r ? toPending(r) : undefined;
  }

  setPendingAnswer(id: string, answer: unknown): void {
    this.db.prepare("UPDATE pending_items SET answer = ? WHERE id = ?").run(JSON.stringify(answer), id);
  }

  // ---------- events ----------

  addEvent(cardId: string, type: string, data: unknown, id: string, at: string = now()): void {
    this.db
      .prepare("INSERT INTO events (id, card_id, at, type, data) VALUES (?, ?, ?, ?, ?)")
      .run(id, cardId, at, type, JSON.stringify(data));
  }

  /**
   * One lane's chat as stored: messages, the hive's notes and error lines, oldest first. Rows the first slice wrote
   * carry no lane and count as Refine's.
   */
  chatFor(cardId: string, lane: Lane): ChatItem[] {
    return this.chatsByLane(cardId, [lane])[lane] ?? [];
  }

  /** The chat of each of `lanes` that has any, read in one pass over the card's history. */
  chatsByLane(cardId: string, lanes: Lane[]): Partial<Record<Lane, ChatItem[]>> {
    const wanted = new Set<Lane>(lanes);
    const rows = this.db
      .prepare("SELECT * FROM events WHERE card_id = ? AND type IN ('chat', 'error') ORDER BY at, rowid")
      .all(cardId) as any[];
    const chats: Partial<Record<Lane, ChatItem[]>> = {};
    for (const r of rows) {
      const d = JSON.parse(r.data);
      const lane: Lane = d.lane ?? "refine";
      if (!wanted.has(lane)) continue;
      const item: ChatItem =
        r.type === "chat"
          ? { kind: "message", id: r.id, at: r.at, from: d.from, text: d.text }
          : { kind: "error", id: r.id, at: r.at, message: d.message, actions: errorActions(d) };
      (chats[lane] ??= []).push(item);
    }
    return chats;
  }

  /** A card's events of the given types, oldest first, with their data parsed. */
  eventsOf(cardId: string, types: string[]): { type: string; at: string; data: any }[] {
    if (types.length === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT type, at, data FROM events WHERE card_id = ? AND type IN (${types.map(() => "?").join(", ")}) ` +
          "ORDER BY at, rowid",
      )
      .all(cardId, ...types) as { type: string; at: string; data: string }[];
    return rows.map((r) => ({ type: r.type, at: r.at, data: JSON.parse(r.data) }));
  }

  /** The last item in a lane's chat. */
  lastChatItem(cardId: string, lane: Lane): ChatItem | undefined {
    return this.chatFor(cardId, lane).at(-1);
  }

  // ---------- spec issues and decisions ----------

  /** Runs `fn` in one SQLite transaction: all of its writes land, or none do. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** A new issue, open for the spec keeper; returns its id. */
  addIssue(cardId: string, issue: Pick<SpecIssue, "foundIn" | "where" | "problem" | "guess">): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO issues (id, card_id, found_in, spec_section, problem, guess, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(id, cardId, issue.foundIn, issue.where, issue.problem, issue.guess, now());
    return id;
  }

  issuesFor(cardId: string): SpecIssue[] {
    return (
      this.db.prepare("SELECT * FROM issues WHERE card_id = ? ORDER BY created_at, rowid").all(cardId) as any[]
    ).map(toIssue);
  }

  /** The keeper's judgment of an issue, the status it leads to, and how many repeats its chain has had. */
  judgeIssue(id: string, judgment: IssueJudgment, status: IssueStatus, flips: number): void {
    this.db
      .prepare(
        `UPDATE issues SET verdict = ?, level = ?, reason = ?, recommendation = ?, repeats = ?, status = ?, flips = ?
         WHERE id = ?`,
      )
      .run(judgment.verdict, judgment.level, judgment.reason, judgment.recommendation, judgment.repeats, status, flips, id);
  }

  setIssueStatus(ids: string[], status: IssueStatus): void {
    const set = this.db.prepare("UPDATE issues SET status = ? WHERE id = ?");
    for (const id of ids) set.run(status, id);
  }

  answerIssue(id: string, answer: IssueAnswer, status: IssueStatus): void {
    this.db.prepare("UPDATE issues SET answer = ?, status = ? WHERE id = ?").run(JSON.stringify(answer), status, id);
  }

  /** How many repeats the chain an issue belongs to has had: 0 for an issue that repeats nothing. */
  flipsOf(id: string): number {
    const r = this.db.prepare("SELECT flips FROM issues WHERE id = ?").get(id) as { flips: number } | undefined;
    return r?.flips ?? 0;
  }

  addDecision(cardId: string, decision: Omit<Decision, "id">, sessionId: string | null): void {
    this.db
      .prepare(
        `INSERT INTO decisions (id, card_id, lane, what, alternative, session_id, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), cardId, decision.lane, decision.what, decision.alternative, sessionId, decision.source, now());
  }

  decisionsFor(cardId: string): Decision[] {
    return (
      this.db.prepare("SELECT * FROM decisions WHERE card_id = ? ORDER BY created_at, rowid").all(cardId) as any[]
    ).map((r) => ({ id: r.id, lane: r.lane, what: r.what, alternative: r.alternative, source: r.source }));
  }
}

function toProject(r: any): ProjectRow {
  return { id: r.id, name: r.name, path: r.path, trustWarning: !!r.trust_warning };
}

function toIssue(r: any): SpecIssue {
  return {
    id: r.id, foundIn: r.found_in, where: r.spec_section, problem: r.problem, guess: r.guess,
    status: r.status ?? "open",
    judgment: r.verdict
      ? { verdict: r.verdict, level: r.level, reason: r.reason ?? "", recommendation: r.recommendation ?? "", repeats: r.repeats ?? null }
      : null,
    answer: r.answer ? JSON.parse(r.answer) : null,
  };
}

function toCard(r: any): CardRow {
  return {
    id: r.id, projectId: r.project_id, title: r.title, ideaTitle: r.idea_title, ideaText: r.idea_text, lane: r.lane, state: r.state,
    branch: r.branch, worktreePath: r.worktree_path, brief: r.brief ? JSON.parse(r.brief) : null,
    moveError: r.move_error, specPath: r.spec_path ?? null, reviewedSpecHash: r.reviewed_spec_hash ?? null,
    reviewApplying: !!r.review_applying, plan: r.plan ? JSON.parse(r.plan) : null,
    build: r.build ? JSON.parse(r.build) : null, check: r.check_round ? JSON.parse(r.check_round) : null,
    setup: r.setup ? JSON.parse(r.setup) : null, port: r.port ?? null, feedback: r.feedback ?? null,
    appStopped: !!r.app_stopped, landing: r.landing ? JSON.parse(r.landing) : null,
    landed: r.landed ? JSON.parse(r.landed) : null, shipAfterCheck: !!r.ship_after_check,
    checklist: r.checklist ? JSON.parse(r.checklist) : null,
    judging: r.judging ? JSON.parse(r.judging) : null, keeperFixes: r.keeper_fixes ? JSON.parse(r.keeper_fixes) : null,
    keeperRounds: r.keeper_rounds ?? 0, blockJudged: !!r.block_judged,
    waitingSince: r.waiting_since ?? r.created_at,
  };
}

/** Error rows the first slice wrote have `retryable`; later ones list their actions. */
function errorActions(d: { actions?: ErrorAction[]; retryable?: boolean }): ErrorAction[] {
  if (Array.isArray(d.actions)) return d.actions;
  return d.retryable ? ["retry"] : [];
}

function toSession(r: any): SessionRow {
  return {
    id: r.id, cardId: r.card_id, lane: r.lane, role: r.role, kind: r.kind,
    turnRunning: !!r.turn_running, existsYet: !!r.exists_yet, lastMessage: r.last_message,
  };
}

function toPending(r: any): PendingRow {
  return {
    id: r.id, cardId: r.card_id, sessionId: r.session_id,
    item: { id: r.id, kind: r.kind, ...JSON.parse(r.payload) } as PendingItem,
    answered: r.answer !== null,
  };
}

export function projectSummary(p: ProjectRow): ProjectSummary {
  return { id: p.id, name: p.name, path: p.path, trustWarning: p.trustWarning };
}
