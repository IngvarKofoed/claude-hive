// The hive's orchestration for this slice: projects, cards, the Ideas → Refine move, and the product owner's
// turns. Plain code decides; Claude sessions only do the work (packages/backend/CLAUDE.md, Rules).
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  AnswerBody, BoardResponse, Brief, CardDetail, CardSummary, ChatItem, Lane, PendingItem, Question,
} from "@hive/shared";
import { canMove } from "./board/moves";
import { HiveDb, projectSummary, type CardRow, type SessionRow } from "./db";
import type { EventHub } from "./events";
import type { Role, RunningTurn, SessionRunner, ToolDecision, TrustProbe } from "./sessions/types";

/** The git service's API (packages/backend/src/git). */
export interface GitService {
  resolveRepoRoot(path: string): Promise<string>;
  hasBranch(root: string, branch: string): Promise<boolean>;
  ensureWorktreesExcluded(root: string): Promise<void>;
  createCardWorktree(root: string, slug: string): Promise<{ worktreePath: string; branch: string }>;
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
  log?: (message: string) => void;
}

const REFINE_ROLE = "product-owner";

/** The idea's first sentence, cut to 60 characters (spec: Board and moves). */
export function titleFromIdea(text: string): string {
  const first = text.trim().split(/(?<=[.!?])\s|\n/)[0]!.trim();
  return first.length > 60 ? `${first.slice(0, 59).trimEnd()}…` : first;
}

function firstTurnMessage(projectName: string, idea: string): string {
  return [
    `A new idea for the project ${projectName}:`,
    "",
    idea,
    "",
    "Read the repo, then open with a draft brief through write_brief, and ask what you need to know with AskUserQuestion.",
  ].join("\n");
}

/** A question waiting for an answer that a live turn is blocked on. */
interface Waiter {
  resolve(answer: AnswerBody): void;
}

export class Hive {
  private turns = new Map<string, RunningTurn>(); // session id → running turn
  private waiters = new Map<string, Waiter>(); // pending item id → live turn waiting on it
  private stopping = new Set<string>(); // session ids being stopped by you
  private followUps = new Map<string, string[]>(); // session id → messages that missed a turn already ending
  private moving = new Set<string>(); // card ids with a move in flight

  constructor(private deps: HiveDeps) {}

  private get db() {
    return this.deps.db;
  }

  private log(message: string) {
    (this.deps.log ?? console.error)(message);
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
    const session = this.db.getSessionFor(card.id, "refine");
    return {
      ...cardSummary(card),
      projectName: project.name,
      ideaText: card.ideaText,
      branch: card.branch,
      worktreePath: card.worktreePath,
      brief: card.brief,
      chat: this.db.chatFor(card.id),
      pending: this.db.openPendingFor(card.id)?.item ?? null,
      turnRunning: session?.turnRunning ?? false,
    };
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

  // ---------- cards ----------

  createCard(projectId: string, text: string): CardSummary {
    if (!this.db.getProject(projectId)) throw new HttpError(404, "No such project.");
    if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "Type an idea first.");
    const card: CardRow = {
      id: randomUUID(), projectId, title: titleFromIdea(text), ideaText: text.trim(), lane: "ideas",
      state: "needs-you", branch: null, worktreePath: null, brief: null, moveError: null,
    };
    this.db.insertCard(card);
    this.emitCard(card.id);
    return cardSummary(card);
  }

  async moveCard(id: string, lane: Lane): Promise<CardSummary> {
    const card = this.requireCard(id);
    if (!canMove(card.lane, lane)) throw new HttpError(409, `A card can't move from ${card.lane} to ${lane} yet.`);
    // A second drop while the first is still making the worktree would fail on the branch the first just made.
    if (this.moving.has(id)) throw new HttpError(409, "This card is already moving.");
    this.moving.add(id);
    try {
      return await this.enterRefine(card, lane);
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
      worktree = await this.deps.git.createCardWorktree(project.path, this.deps.git.cardSlug(card.title, card.id));
    } catch (error) {
      this.db.updateCard(id, { moveError: (error as Error).message });
      this.emitCard(id);
      throw new HttpError(409, (error as Error).message);
    }
    // Load the role before the lane changes, so a broken role file leaves the card in Ideas instead of in Refine
    // with no session to talk to.
    let role: Role;
    try {
      role = this.deps.role(REFINE_ROLE);
    } catch (error) {
      this.db.updateCard(id, { moveError: (error as Error).message });
      this.emitCard(id);
      throw new HttpError(500, (error as Error).message);
    }
    this.db.updateCard(id, { lane, branch: worktree.branch, worktreePath: worktree.worktreePath, moveError: null });

    const sessionId = randomUUID();
    this.db.insertSession({ id: sessionId, cardId: id, lane, role: REFINE_ROLE, kind: role.kind });
    this.startTurn(id, sessionId, firstTurnMessage(project.name, card.ideaText));
    return cardSummary(this.requireCard(id));
  }

  // ---------- chat ----------

  sendMessage(cardId: string, text: string): void {
    if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "Type a message first.");
    const session = this.requireRefineSession(cardId);
    this.addChat(cardId, { from: "you", text: text.trim() });

    // A message sent while a question waits answers it instead of joining the turn (spec: Questions).
    const open = this.db.openPendingFor(cardId);
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

    this.db.setPendingAnswer(itemId, body);
    this.deps.hub.emit({ type: "pending.updated", cardId: pending.cardId, pending: null });
    // Your answer stays in the chat however it was given, since the question card goes once it's answered.
    if (isAnswers(body) && !opts.alreadyInChat) {
      this.addChat(pending.cardId, { from: "you", text: summarizeAnswers(body.answers) });
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
    const session = this.requireRefineSession(cardId);
    const running = this.turns.get(session.id);
    if (!running) return;
    this.stopping.add(session.id);
    await running.interrupt();
  }

  retry(cardId: string): void {
    const session = this.requireRefineSession(cardId);
    if (this.turns.has(session.id)) throw new HttpError(409, "A turn is already running.");
    const last = this.db.lastChatItem(cardId);
    if (!last || last.kind !== "error" || !last.retryable || !session.lastMessage) {
      throw new HttpError(409, "There is no failed turn to retry.");
    }
    this.startTurn(cardId, session.id, session.lastMessage);
  }

  // ---------- startup ----------

  /** After a restart: a turn that was cut off is not resumed in a chat lane; it waits for you (spec: Questions). */
  recoverAfterRestart(): void {
    for (const session of this.db.listRunningSessions()) {
      this.db.updateSession(session.id, { turnRunning: false });
      this.db.updateCard(session.cardId, { state: "needs-you" });
      this.addError(session.cardId, "The last reply was cut off when the hive stopped. Send a message to carry on.", false);
    }
  }

  // ---------- turns ----------

  private startTurn(cardId: string, sessionId: string, message: string): void {
    const card = this.requireCard(cardId);
    const session = this.db.getSession(sessionId)!;
    this.db.updateSession(sessionId, { turnRunning: true, lastMessage: message });
    this.setState(cardId, "working");
    this.deps.hub.emit({ type: "turn.started", cardId });

    const turn: RunningTurn = this.deps.runner.start(
      {
        sessionId,
        resume: session.existsYet,
        cwd: card.worktreePath!,
        role: this.deps.role(session.role),
        message,
        hiveTools: { writeBrief: (brief) => Promise.resolve(this.writeBrief(cardId, brief)) },
      },
      {
        onTextDelta: (text) => this.deps.hub.emit({ type: "chat.delta", cardId, text }),
        onTextBlock: (text) => this.addChat(cardId, { from: "product-owner", text }),
        onActivity: (text) => this.deps.hub.emit({ type: "chat.activity", cardId, text }),
        onSessionCreated: () => this.db.updateSession(sessionId, { existsYet: true }),
        canUseTool: (toolName, input, signal) => this.canUseTool(cardId, sessionId, toolName, input, signal),
      },
    );
    this.turns.set(sessionId, turn);

    void turn.done
      .catch((error: unknown): { kind: "error"; message: string } => ({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      }))
      .then((outcome) => {
        if (this.turns.get(sessionId) === turn) this.turns.delete(sessionId);
        const stopped = this.stopping.delete(sessionId);
        this.db.updateSession(sessionId, { turnRunning: false });
        this.dropOpenPending(cardId, sessionId);
        if (outcome.kind === "error" && !stopped) this.addError(cardId, outcome.message, true);
        this.deps.hub.emit({ type: "chat.activity", cardId, text: null });
        this.setState(cardId, "needs-you");
        this.deps.hub.emit({ type: "turn.ended", cardId });

        const next = this.followUps.get(sessionId);
        if (next) {
          this.followUps.delete(sessionId);
          this.startTurn(cardId, sessionId, next.join("\n\n"));
        }
      });
  }

  /** A message for the session: it joins the running turn, or waits for it to end, or starts a new turn. */
  private deliver(cardId: string, sessionId: string, message: string): void {
    const running = this.turns.get(sessionId);
    if (!running) return this.startTurn(cardId, sessionId, message);
    if (running.push(message)) return;
    this.followUps.set(sessionId, [...(this.followUps.get(sessionId) ?? []), message]);
  }

  private async canUseTool(
    cardId: string, sessionId: string, toolName: string, input: Record<string, unknown>, signal: AbortSignal,
  ): Promise<ToolDecision> {
    if (toolName.startsWith("mcp__hive__")) return { behavior: "allow", updatedInput: input };

    const item: PendingItem =
      toolName === "AskUserQuestion"
        ? { id: randomUUID(), kind: "question", questions: toQuestions(input.questions) }
        : { id: randomUUID(), kind: "permission", toolName, detail: JSON.stringify(input).slice(0, 500) };
    this.db.insertPending({ item, cardId, sessionId });
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

  // ---------- helpers ----------

  private addChat(cardId: string, message: { from: "you" | "product-owner"; text: string }): void {
    const item: ChatItem = { kind: "message", id: randomUUID(), at: new Date().toISOString(), ...message };
    this.db.addEvent(cardId, "chat", message, item.id, item.at);
    this.deps.hub.emit({ type: "chat.message", cardId, item });
  }

  private addError(cardId: string, message: string, retryable: boolean): void {
    const item: ChatItem = { kind: "error", id: randomUUID(), at: new Date().toISOString(), message, retryable };
    this.db.addEvent(cardId, "error", { message, retryable }, item.id, item.at);
    this.deps.hub.emit({ type: "chat.message", cardId, item });
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

  private requireRefineSession(cardId: string): SessionRow {
    const card = this.requireCard(cardId);
    const session = card.lane === "refine" ? this.db.getSessionFor(cardId, "refine") : undefined;
    if (!session) throw new HttpError(409, "This card has no conversation yet. Drag it to Refine first.");
    return session;
  }
}

export function cardSummary(c: CardRow): CardSummary {
  return { id: c.id, projectId: c.projectId, title: c.title, lane: c.lane, state: c.state, moveError: c.moveError };
}

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
