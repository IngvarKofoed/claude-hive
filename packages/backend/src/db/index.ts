// SQLite through better-sqlite3. This slice creates only the tables it uses (spec: Data).
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Brief, CardState, ChatItem, Lane, PendingItem, ProjectSummary } from "@hive/shared";

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
`;

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
  ideaText: string;
  lane: Lane;
  state: CardState;
  branch: string | null;
  worktreePath: string | null;
  brief: Brief | null;
  moveError: string | null;
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

  insertCard(c: CardRow): void {
    this.db
      .prepare(
        `INSERT INTO cards (id, project_id, title, idea_text, lane, state, branch, worktree_path, brief, move_error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.id, c.projectId, c.title, c.ideaText, c.lane, c.state, c.branch, c.worktreePath,
        c.brief ? JSON.stringify(c.brief) : null, c.moveError, now());
  }

  updateCard(id: string, patch: Partial<Omit<CardRow, "id" | "projectId">>): void {
    const cols: Record<string, string> = {
      title: "title", ideaText: "idea_text", lane: "lane", state: "state", branch: "branch",
      worktreePath: "worktree_path", brief: "brief", moveError: "move_error",
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const col = cols[key];
      if (!col) continue;
      sets.push(`${col} = ?`);
      values.push(key === "brief" ? (value ? JSON.stringify(value) : null) : value);
    }
    if (sets.length === 0) return;
    this.db.prepare(`UPDATE cards SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }

  // ---------- sessions ----------

  insertSession(s: { id: string; cardId: string; lane: Lane; role: string; kind: string }): void {
    this.db
      .prepare("INSERT INTO sessions (id, card_id, lane, role, kind, started_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(s.id, s.cardId, s.lane, s.role, s.kind, now());
  }

  /** The card's session in a lane (one per card per lane). */
  getSessionFor(cardId: string, lane: Lane): SessionRow | undefined {
    const r = this.db
      .prepare("SELECT * FROM sessions WHERE card_id = ? AND lane = ? ORDER BY started_at DESC LIMIT 1")
      .get(cardId, lane);
    return r ? toSession(r) : undefined;
  }

  getSession(id: string): SessionRow | undefined {
    const r = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    return r ? toSession(r) : undefined;
  }

  listRunningSessions(): SessionRow[] {
    return (this.db.prepare("SELECT * FROM sessions WHERE turn_running = 1").all() as any[]).map(toSession);
  }

  updateSession(id: string, patch: { turnRunning?: boolean; existsYet?: boolean; lastMessage?: string }): void {
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

  /** The chat as stored: your messages, the product owner's text blocks and error lines, oldest first. */
  chatFor(cardId: string): ChatItem[] {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE card_id = ? AND type IN ('chat', 'error') ORDER BY at, rowid")
      .all(cardId) as any[];
    return rows.map((r) => {
      const d = JSON.parse(r.data);
      return r.type === "chat"
        ? { kind: "message", id: r.id, at: r.at, from: d.from, text: d.text }
        : { kind: "error", id: r.id, at: r.at, message: d.message, retryable: !!d.retryable };
    });
  }

  /** The newest error line on the card, if it's the last thing in the chat. */
  lastChatItem(cardId: string): ChatItem | undefined {
    return this.chatFor(cardId).at(-1);
  }
}

function toProject(r: any): ProjectRow {
  return { id: r.id, name: r.name, path: r.path, trustWarning: !!r.trust_warning };
}

function toCard(r: any): CardRow {
  return {
    id: r.id, projectId: r.project_id, title: r.title, ideaText: r.idea_text, lane: r.lane, state: r.state,
    branch: r.branch, worktreePath: r.worktree_path, brief: r.brief ? JSON.parse(r.brief) : null,
    moveError: r.move_error,
  };
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
