// Project chats: a Claude session per chat, with no card behind it, run in the project's own folder
// (docs/specs/2026-11-28-chat-with-a-project-then-make-it-an-idea.md). Its own small turn loop on the session runner,
// mirroring Hive.startTurn and deliver: nothing here knows about lanes, cards' sessions or For you.
import { randomUUID } from "node:crypto";
import {
  IDEA_DRAFTING, ideaDraftBlock, type ChatAuthor, type ChatItem, type IdeaDraft, type PendingItem, type ProjectChatDetail,
  type ProjectChatList, type ProjectChatSummary,
} from "@hive/shared";
import type { ChatRow, HiveDb } from "../db";
import { titleFromIdea } from "../db/titleFromIdea";
import type { EventHub } from "../events";
import { answerAsMessage, HttpError, ROLE_TURNS, summarizeAnswers, toQuestions } from "../hive";
import type { Role, RunningTurn, SessionRunner, ToolDecision, TurnOutcome } from "../sessions/types";
import { parseIdeaDraftReport } from "../spec/reports";
import { chatSummary } from "./summary";

export interface ProjectChatsDeps {
  db: HiveDb;
  hub: EventHub;
  runner: SessionRunner;
  /** Loads a role by name: "project-chat" for every turn, "idea-draft" for the instructions of a draft message. */
  role: (name: string) => Role;
  log?: (message: string) => void;
}

const CHAT_ROLE = "project-chat";
const DRAFT_ROLE = "idea-draft";

/** A chat's running turn. A draft turn is quiet: nothing it writes goes into the chat. */
interface ChatTurn {
  turn: RunningTurn;
  draft: boolean;
}

/** A live turn waiting on the chat's question. */
interface Waiter {
  itemId: string;
  resolve(answers: Record<string, string>): void;
  /** Ends the wait with a denial: the turn ended, or the chat is being deleted. */
  cancel(): void;
}

const isAnswers = (v: unknown): v is Record<string, string> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((a) => typeof a === "string");

export class ProjectChats {
  // Everything below is keyed by chat id: a chat has one session, so one turn at a time.
  private turns = new Map<string, ChatTurn>();
  private waiters = new Map<string, Waiter>();
  private stopping = new Set<string>(); // chats whose turn you stopped, or Cancel stopped while drafting
  private followUps = new Map<string, string[]>(); // messages that missed a turn already ending
  private deleting = new Set<string>(); // chats being deleted: late callbacks for them stand down

  constructor(private deps: ProjectChatsDeps) {}

  private get db() {
    return this.deps.db;
  }

  private log(message: string) {
    (this.deps.log ?? console.error)(message);
  }

  // ---------- reads ----------

  list(projectId: string): ProjectChatList {
    const project = this.db.getProject(projectId);
    if (!project) throw new HttpError(404, "No such project.");
    return {
      projectName: project.name,
      chats: this.db.listChats(projectId).filter((c) => !this.deleting.has(c.id)).map(chatSummary),
    };
  }

  detail(chatId: string): ProjectChatDetail {
    const row = this.requireChat(chatId);
    return {
      ...chatSummary(row),
      projectName: this.db.getProject(row.projectId)?.name ?? "",
      pending: row.pending,
      turnRunning: row.turnRunning,
      draft: row.draft,
      // A "Made an idea" note links to its card while the card exists; a deleted card's line comes back as plain text.
      chat: this.db.chatItems(chatId).map((item) =>
        item.kind === "message" && item.cardId && !this.db.getCard(item.cardId) ? withoutCard(item) : item),
    };
  }

  isDeleting(chatId: string): boolean {
    return this.deleting.has(chatId);
  }

  // ---------- talking ----------

  /** A new chat with its first message: the row, your message, and the first turn. */
  create(projectId: string, text: unknown): ProjectChatSummary {
    const project = this.db.getProject(projectId);
    if (!project) throw new HttpError(404, "No such project.");
    const message = typeof text === "string" ? text.trim() : "";
    if (!message) throw new HttpError(400, "Type a message first.");
    const id = randomUUID();
    this.db.insertChat({ id, projectId, title: titleFromIdea(message), sessionId: randomUUID() });
    this.addChat(id, "you", message);
    this.emitUpdated(id);
    this.begin(id, `A chat about the project ${project.name}. The person's message: ${message}`);
    return chatSummary(this.db.getChat(id)!);
  }

  /**
   * Your message: it answers a waiting question, or joins the running turn, waits for a turn that is ending, or starts
   * a new one. Refused while the quiet draft turn runs, which must not get a chat message.
   */
  send(chatId: string, text: unknown): void {
    const message = typeof text === "string" ? text.trim() : "";
    if (!message) throw new HttpError(400, "Type a message first.");
    const row = this.requireChat(chatId);
    if (row.draft?.status === "drafting") throw new HttpError(409, IDEA_DRAFTING);
    this.addChat(chatId, "you", message);
    // A message sent while a question waits answers it instead, as on a card.
    if (row.pending?.kind === "question") {
      const answers = Object.fromEntries(row.pending.questions.map((q) => [q.question, message]));
      this.answerQuestion(row, row.pending.id, answers);
      return;
    }
    this.deliver(chatId, message);
    this.emitUpdated(chatId);
  }

  /** Your answer to the chat's question. A turn that's gone (a restart) gets it as a message. */
  answer(chatId: string, itemId: unknown, answers: unknown): void {
    const row = this.requireChat(chatId);
    if (!row.pending || row.pending.id !== itemId) throw new HttpError(404, "Nothing is waiting with that id.");
    if (!isAnswers(answers)) throw new HttpError(400, "Send answers.");
    this.addChat(chatId, "you", summarizeAnswers(answers));
    this.answerQuestion(row, row.pending.id, answers);
  }

  private answerQuestion(row: ChatRow, itemId: string, answers: Record<string, string>): void {
    const chatId = row.id;
    const pending = row.pending as Extract<PendingItem, { kind: "question" }>;
    this.db.updateChat(chatId, { pending: null });
    this.deps.hub.emit({ type: "projectChat.pending", chatId, pending: null });
    const waiter = this.waiters.get(chatId);
    if (waiter && waiter.itemId === itemId) {
      this.waiters.delete(chatId);
      waiter.resolve(answers);
    } else {
      this.deliver(chatId, answerAsMessage(pending.questions, answers));
    }
    this.emitUpdated(chatId);
  }

  async stop(chatId: string): Promise<void> {
    this.requireChat(chatId);
    const running = this.turns.get(chatId);
    if (!running) return;
    this.stopping.add(chatId);
    await running.turn.interrupt();
  }

  // ---------- Make it an idea ----------

  /** Starts the quiet draft turn, refused with the greyed button's reason (docs/specs/…, Make it an idea). */
  draft(chatId: string): void {
    const row = this.requireChat(chatId);
    const reason = ideaDraftBlock({
      hasReply: this.db.chatItems(chatId).some((item) => item.kind === "message" && item.from === "project-chat"),
      turnRunning: row.turnRunning || this.turns.has(chatId),
      asking: row.pending !== null,
      draftOpen: row.draft !== null,
    });
    if (reason) throw new HttpError(409, reason);
    // Loaded before the draft is marked, so a broken role file leaves no form stuck on Drafting….
    const instructions = this.deps.role(DRAFT_ROLE).instructions;
    const made = this.db.cardsFromChat(chatId).map((card) => `- ${card.ideaTitle}`);
    const message = [
      instructions,
      "",
      "Ideas already made from this chat:",
      made.length ? made.join("\n") : "- (none)",
      "",
      "Draft the idea now, and end with your report.",
    ].join("\n");
    this.setDraft(chatId, { status: "drafting", title: "", text: "", reason: "" });
    try {
      this.startTurn(chatId, message, true);
    } catch (error) {
      this.setDraft(chatId, failed(`The draft couldn't start: ${(error as Error).message}`));
    }
  }

  /** Cancel: closes the form. While drafting, it stops the draft turn, whose end clears the draft. */
  async closeDraft(chatId: string): Promise<void> {
    const row = this.requireChat(chatId);
    const running = this.turns.get(chatId);
    if (row.draft?.status === "drafting" && running?.draft) {
      this.stopping.add(chatId);
      await running.turn.interrupt();
      return;
    }
    this.setDraft(chatId, null);
  }

  /** Hive.createCard made a card from the chat: the chat gets a note, which links to the card. */
  ideaMade(chatId: string, title: string, cardId: string): void {
    if (!this.db.getChat(chatId) || this.deleting.has(chatId)) return;
    this.addChat(chatId, "hive", `Made an idea: ${/[.!?]$/.test(title) ? title : `${title}.`}`, cardId);
    this.emitUpdated(chatId);
  }

  // ---------- delete and restart ----------

  /**
   * Deletes the chat: its turn is interrupted without waiting, its waiter dropped, and its rows deleted, with cards
   * made from it unlinked. The late end of the turn finds no row and stands down.
   */
  delete(chatId: string): void {
    this.requireChat(chatId);
    this.deleting.add(chatId);
    const running = this.turns.get(chatId);
    if (running) {
      running.turn.interrupt().catch((error: unknown) => this.log(`Interrupting chat ${chatId} failed: ${String(error)}`));
    }
    this.waiters.get(chatId)?.cancel();
    this.waiters.delete(chatId);
    this.followUps.delete(chatId);
    this.db.deleteChat(chatId);
    this.deps.hub.emit({ type: "projectChat.deleted", chatId });
    if (!running) this.deleting.delete(chatId);
  }

  /**
   * A chat left running when the hive stopped is cleared and told so; it isn't resumed, the same as a chat lane. A
   * draft left drafting fails. A waiting question stays: its answer goes to the session as a message.
   */
  recoverAfterRestart(): void {
    for (const row of this.db.listChats()) {
      const drafting = row.draft?.status === "drafting";
      if (!row.turnRunning && !drafting) continue;
      this.db.updateChat(row.id, { turnRunning: false });
      if (drafting) {
        this.db.updateChat(row.id, { draft: failed("The hive stopped while drafting. Press Make it an idea again.") });
      } else {
        this.addError(row.id, "The last reply was cut off when the hive stopped. Send a message to carry on.");
      }
    }
  }

  // ---------- turns ----------

  /** A message for the session: it joins the running turn, or waits for it to end, or starts a new turn. */
  private deliver(chatId: string, message: string): void {
    const running = this.turns.get(chatId);
    if (!running) return this.begin(chatId, message);
    if (running.turn.push(message)) return;
    this.followUps.set(chatId, [...(this.followUps.get(chatId) ?? []), message]);
  }

  /** Starts a chat turn; one that can't start becomes an error line instead of a failed request. */
  private begin(chatId: string, message: string): void {
    try {
      this.startTurn(chatId, message, false);
    } catch (error) {
      this.addError(chatId, `Your message couldn't be sent: ${(error as Error).message}`);
      this.emitUpdated(chatId);
    }
  }

  private startTurn(chatId: string, message: string, draft: boolean): void {
    const row = this.db.getChat(chatId)!;
    const project = this.db.getProject(row.projectId)!;
    this.db.updateChat(chatId, { lastMessage: message });
    // Resolved before the turn is marked running, so a broken role file leaves no running turn behind.
    const role = this.deps.role(CHAT_ROLE);
    this.db.updateChat(chatId, { turnRunning: true });
    this.emitUpdated(chatId);
    // A draft turn's output, a deleted chat's late output, and anything after the turn's end go nowhere.
    let live = true;
    const loud = () => live && !draft && !this.deleting.has(chatId);

    let turn: RunningTurn;
    try {
      turn = this.deps.runner.start(
        {
          sessionId: row.sessionId,
          resume: row.existsYet,
          cwd: project.path,
          role,
          message,
          ...(draft ? { outputFormat: ROLE_TURNS[DRAFT_ROLE]!.report! } : {}),
        },
        {
          onTextDelta: (text) => {
            if (loud()) this.deps.hub.emit({ type: "projectChat.delta", chatId, text });
          },
          onTextBlock: (text) => {
            if (loud()) this.addChat(chatId, "project-chat", text);
          },
          onActivity: (text) => {
            if (loud()) this.deps.hub.emit({ type: "projectChat.activity", chatId, text });
          },
          onChecklist: () => {},
          onSessionCreated: () => {
            if (live && !this.deleting.has(chatId)) this.db.updateChat(chatId, { existsYet: true });
          },
          canUseTool: (toolName, input, signal) => this.canUseTool(chatId, draft, toolName, input, signal),
        },
      );
    } catch (error) {
      // The turn never started: take its mark back, the way a turn's normal end does. Callers report it.
      this.db.updateChat(chatId, { turnRunning: false });
      this.emitUpdated(chatId);
      throw error;
    }
    this.turns.set(chatId, { turn, draft });

    void turn.done
      .catch((error: unknown): TurnOutcome => ({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      }))
      .then((outcome) => {
        live = false;
        this.onTurnEnded(chatId, turn, draft, outcome);
      })
      // Nothing thrown while handling a turn's end may become an unhandled rejection, which would stop the hive.
      .catch((error: unknown) => this.log(`Handling the end of a turn in chat ${chatId} failed: ${String(error)}`));
  }

  private onTurnEnded(chatId: string, turn: RunningTurn, draft: boolean, outcome: TurnOutcome): void {
    if (this.turns.get(chatId)?.turn === turn) this.turns.delete(chatId);
    const stopped = this.stopping.delete(chatId);
    // A deleted chat: nothing is written back.
    if (this.deleting.has(chatId) || !this.db.getChat(chatId)) {
      this.deleting.delete(chatId);
      this.followUps.delete(chatId);
      return;
    }
    this.db.updateChat(chatId, { turnRunning: false });
    // A question still waiting on this turn goes with it (it failed, or was stopped before it could ask).
    const waiter = this.waiters.get(chatId);
    if (waiter) {
      this.waiters.delete(chatId);
      waiter.cancel();
      this.db.updateChat(chatId, { pending: null });
      this.deps.hub.emit({ type: "projectChat.pending", chatId, pending: null });
    }

    if (draft) this.onDraftEnded(chatId, outcome, stopped);
    else if (outcome.kind === "error" && !stopped) this.addError(chatId, outcome.message);

    this.deps.hub.emit({ type: "projectChat.activity", chatId, text: null });
    this.emitUpdated(chatId);

    const next = this.followUps.get(chatId);
    if (next) {
      this.followUps.delete(chatId);
      this.begin(chatId, next.join("\n\n"));
    }
  }

  /** ready with the drafted title and text; failed with the reason; nothing when it was stopped. */
  private onDraftEnded(chatId: string, outcome: TurnOutcome, stopped: boolean): void {
    if (stopped || (outcome.kind === "ok" && outcome.interrupted)) {
      this.db.updateChat(chatId, { draft: null });
      return;
    }
    if (outcome.kind === "error") {
      this.db.updateChat(chatId, { draft: failed(`The draft failed: ${outcome.message}`) });
      return;
    }
    const result = parseIdeaDraftReport(outcome.report);
    this.db.updateChat(chatId, {
      draft: "reason" in result ? failed(result.reason) : { status: "ready", title: result.title, text: result.text, reason: "" },
    });
  }

  private async canUseTool(
    chatId: string, draft: boolean, toolName: string, input: Record<string, unknown>, signal: AbortSignal,
  ): Promise<ToolDecision> {
    if (this.deleting.has(chatId) || !this.db.getChat(chatId)) {
      return { behavior: "deny", message: "The chat is being deleted.", interrupt: true };
    }
    // Anything else that reaches here is a permission request auto mode passed on: a chat never needs to change anything.
    if (toolName !== "AskUserQuestion") return { behavior: "deny", message: "A project chat doesn't change anything." };
    if (draft) return { behavior: "deny", message: "Draft from what you have; leave open points in the text." };

    const item: PendingItem = { id: randomUUID(), kind: "question", questions: toQuestions(input.questions) };
    this.db.updateChat(chatId, { pending: item });
    this.deps.hub.emit({ type: "projectChat.pending", chatId, pending: item });
    this.emitUpdated(chatId);

    let answers: Record<string, string>;
    try {
      answers = await new Promise<Record<string, string>>((resolve, reject) => {
        this.waiters.set(chatId, { itemId: item.id, resolve, cancel: () => reject(new Error("cancelled")) });
        if (signal.aborted) reject(new Error("aborted"));
        else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    } catch {
      if (this.waiters.get(chatId)?.itemId === item.id) this.waiters.delete(chatId);
      return { behavior: "deny", message: "The question was withdrawn.", interrupt: true };
    }
    return { behavior: "allow", updatedInput: { ...input, answers } };
  }

  // ---------- helpers ----------

  /** A message row. `cardId` is set only on a "Made an idea" note, and stays in the row for good. */
  private addChat(chatId: string, from: ChatAuthor, text: string, cardId?: string): void {
    const item: ChatItem = {
      kind: "message", id: randomUUID(), at: new Date().toISOString(), from, text, ...(cardId ? { cardId } : {}),
    };
    this.db.addChatEvent(chatId, "chat", { from, text, ...(cardId ? { cardId } : {}) }, item.id, item.at);
    this.deps.hub.emit({ type: "projectChat.message", chatId, item });
  }

  /** An error line. A chat has no lane actions: you carry on by sending a message. */
  private addError(chatId: string, message: string): void {
    const item: ChatItem = { kind: "error", id: randomUUID(), at: new Date().toISOString(), message, actions: [] };
    this.db.addChatEvent(chatId, "error", { message }, item.id, item.at);
    this.deps.hub.emit({ type: "projectChat.message", chatId, item });
  }

  private setDraft(chatId: string, draft: IdeaDraft | null): void {
    this.db.updateChat(chatId, { draft });
    this.emitUpdated(chatId);
  }

  private emitUpdated(chatId: string): void {
    const row = this.db.getChat(chatId);
    if (row) this.deps.hub.emit({ type: "projectChat.updated", chat: chatSummary(row) });
  }

  private requireChat(chatId: string): ChatRow {
    const row = this.deleting.has(chatId) ? undefined : this.db.getChat(chatId);
    if (!row) throw new HttpError(404, "No such chat.");
    return row;
  }
}

const failed = (reason: string): IdeaDraft => ({ status: "failed", title: "", text: "", reason });

/** A note without its card link, for a card that no longer exists. */
function withoutCard(item: Extract<ChatItem, { kind: "message" }>): ChatItem {
  const { cardId: _gone, ...rest } = item;
  return rest;
}
