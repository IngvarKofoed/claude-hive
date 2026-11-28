// Project chats: the tables, the turn loop, Make it an idea, and the card made from a chat
// (docs/specs/2026-11-28-chat-with-a-project-then-make-it-an-idea.md).
import Database from "better-sqlite3";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HiveEvent } from "@hive/shared";
import { ProjectChats } from "./chats";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { answerAsMessage, Hive } from "./hive";
import { IDEA_DRAFT_SCHEMA } from "./spec/reports";
import { FakeProbe, FakeRunner, makeRepo, settle, waitFor, type FakeTurn, type TempRepo } from "./testing";

const INSTRUCTIONS: Record<string, string> = {
  "project-chat": "Be the project's chat.",
  "idea-draft": "Draft one idea from this chat.",
  "product-owner": "Be a product owner.",
};
const role = (name: string) => ({ name, model: "opus", kind: "conversation", instructions: INSTRUCTIONS[name] ?? "" });

const question = {
  questions: [{
    question: "Which part should I explain?", header: "Part", multiSelect: false,
    options: [{ label: "Moves", description: "board/moves.ts" }, { label: "Sessions", description: "the runner" }],
  }],
};
const signal = () => new AbortController().signal;

describe("project chats", () => {
  let db: HiveDb;
  let hub: EventHub;
  let runner: FakeRunner;
  let chats: ProjectChats;
  let hive: Hive;
  let events: HiveEvent[];
  let repos: TempRepo[];
  let projectId: string;
  let projectPath: string;

  beforeEach(async () => {
    db = new HiveDb(":memory:");
    hub = new EventHub();
    runner = new FakeRunner();
    events = [];
    hub.subscribe((e) => events.push(e));
    chats = new ProjectChats({ db, hub, runner, role, log: () => {} });
    hive = new Hive({ db, hub, git, runner, probe: new FakeProbe(), role, log: () => {}, specFormatDir: "/nonexistent", chats });
    repos = [makeRepo()];
    await hive.addProject(repos[0]!.root);
    projectId = hive.board().projects[0]!.id;
    projectPath = realpathSync(repos[0]!.root);
  });
  afterEach(() => {
    repos.forEach((r) => r.cleanup());
    db.close();
  });

  /** A new chat whose first turn replied and ended. */
  async function chatWithReply(text = "How does a card move from Build to Check? I'm curious.", reply = "Through board/moves.ts.") {
    const { id } = chats.create(projectId, text);
    const turn = runner.last;
    turn.handlers.onSessionCreated();
    turn.handlers.onTextBlock(reply);
    await turn.end();
    return { chatId: id, turn };
  }

  /** Starts a draft turn and ends it with `report`. */
  async function drafted(chatId: string, report: unknown = { status: "done", reason: null, title: "Show the move", text: "Say why a card moved." }) {
    chats.draft(chatId);
    const turn = runner.last;
    await turn.end({ kind: "ok", report });
    return turn;
  }

  const draftOf = (chatId: string) => chats.detail(chatId).draft;
  const stateOf = (chatId: string) => chats.detail(chatId).state;

  describe("the database", () => {
    it("adds cards.chat_id and the chat tables to a database from before them", () => {
      const dir = mkdtempSync(join(tmpdir(), "hive-chats-"));
      const path = join(dir, "hive.db");
      try {
        new HiveDb(path).close();
        const raw = new Database(path);
        raw.exec("DROP TABLE chat_events; DROP TABLE chats; ALTER TABLE cards DROP COLUMN chat_id");
        raw.close();

        const reopened = new HiveDb(path);
        const columns = (reopened.db.prepare("PRAGMA table_info(cards)").all() as { name: string }[]).map((c) => c.name);
        expect(columns).toContain("chat_id");
        reopened.insertProject({ id: "p", name: "flux", path: "/flux", trustWarning: false });
        reopened.insertChat({ id: "c", projectId: "p", title: "Hi", sessionId: "s" });
        reopened.addChatEvent("c", "chat", { from: "you", text: "Hi" }, "e1");
        expect(reopened.chatItems("c")).toHaveLength(1);
        reopened.close();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("reads a chat's rows oldest first, and deletes the chat with its rows, unlinking its cards", () => {
      db.insertChat({ id: "c", projectId, title: "Hi", sessionId: "s" });
      db.addChatEvent("c", "chat", { from: "project-chat", text: "second" }, "e2", "2026-11-28T10:02:00.000Z");
      db.addChatEvent("c", "chat", { from: "you", text: "first" }, "e1", "2026-11-28T10:01:00.000Z");
      db.addChatEvent("c", "error", { message: "cut off" }, "e3", "2026-11-28T10:03:00.000Z");
      expect(db.chatItems("c")).toEqual([
        { kind: "message", id: "e1", at: "2026-11-28T10:01:00.000Z", from: "you", text: "first" },
        { kind: "message", id: "e2", at: "2026-11-28T10:02:00.000Z", from: "project-chat", text: "second" },
        { kind: "error", id: "e3", at: "2026-11-28T10:03:00.000Z", message: "cut off", actions: [] },
      ]);
      const card = hive.createCard(projectId, "Idea", "Text.", "c");
      expect(db.getCard(card.id)!.chatId).toBe("c");

      db.deleteChat("c");
      expect(db.getChat("c")).toBeUndefined();
      expect(db.chatItems("c")).toEqual([]);
      expect(db.getCard(card.id)!.chatId).toBeNull();
    });
  });

  describe("turns (Explore)", () => {
    it("titles a new chat from its first sentence and runs it in the project's own folder, with nothing extra", async () => {
      const summary = chats.create(projectId, "How does a card move from Build to Check? I'm curious.");
      expect(summary).toMatchObject({ projectId, title: "How does a card move from Build to Check?", state: "working" });
      const first = runner.last;
      expect(first.request).toMatchObject({ cwd: projectPath, resume: false, role: { name: "project-chat" } });
      expect(first.request.hiveTools).toBeUndefined();
      expect(first.request.outputFormat).toBeUndefined();
      expect(first.request.message).toBe(
        "A chat about the project repo. The person's message: How does a card move from Build to Check? I'm curious.");

      first.handlers.onSessionCreated();
      first.handlers.onTextDelta("Through");
      first.handlers.onTextBlock("Through board/moves.ts.");
      first.handlers.onActivity("reading src/board/moves.ts…");
      await first.end();
      expect(events).toContainEqual({ type: "projectChat.delta", chatId: summary.id, text: "Through" });
      expect(events).toContainEqual({ type: "projectChat.activity", chatId: summary.id, text: "reading src/board/moves.ts…" });
      const detail = chats.detail(summary.id);
      expect(detail.chat.map((c) => c.kind === "message" && [c.from, c.text])).toEqual([
        ["you", "How does a card move from Build to Check? I'm curious."],
        ["project-chat", "Through board/moves.ts."],
      ]);
      expect(detail).toMatchObject({ state: "idle", turnRunning: false, projectName: "repo" });
      expect(detail).not.toHaveProperty("ideas");

      chats.send(summary.id, "And back?");
      expect(runner.last).not.toBe(first);
      expect(runner.last.request).toMatchObject({ sessionId: first.request.sessionId, resume: true, message: "And back?" });
      expect(runner.last.request.outputFormat).toBeUndefined();
    });

    it("lists a project's chats newest first, and refuses an unknown project, chat or empty message", async () => {
      const { chatId: older } = await chatWithReply("One.");
      const { chatId: newer } = await chatWithReply("Two.");
      expect(chats.list(projectId)).toEqual({ projectName: "repo", chats: [expect.objectContaining({ id: newer }), expect.objectContaining({ id: older })] });
      await new Promise((resolve) => setTimeout(resolve, 5)); // a later millisecond than the newer chat's last row
      chats.send(older, "Back to this one.");
      expect(chats.list(projectId).chats.map((c) => c.id)).toEqual([older, newer]);

      expect(() => chats.list("nope")).toThrow(expect.objectContaining({ status: 404 }));
      expect(() => chats.create(projectId, "  ")).toThrow(expect.objectContaining({ status: 400 }));
      expect(() => chats.detail("nope")).toThrow(expect.objectContaining({ status: 404, message: "No such chat." }));
    });

    it("pushes a message sent mid-turn into it, and starts the next turn for one that missed an ending turn", async () => {
      const { id } = chats.create(projectId, "Hi.");
      const turn = runner.last;
      chats.send(id, "Also this.");
      expect(turn.pushed).toEqual(["Also this."]);

      turn.inputEnded = true;
      chats.send(id, "And this.");
      expect(runner.turns).toHaveLength(1);
      await turn.end();
      expect(runner.turns).toHaveLength(2);
      expect(runner.last.request.message).toBe("And this.");
    });

    it("cuts off a running chat at a restart without resuming it, and the next message resumes the same session", async () => {
      const { id } = chats.create(projectId, "Hi.");
      const first = runner.last;
      first.handlers.onSessionCreated();
      // The hive stops: a new ProjectChats on the same database.
      const after = new ProjectChats({ db, hub, runner, role, log: () => {} });
      after.recoverAfterRestart();
      expect(runner.turns).toHaveLength(1);
      const detail = after.detail(id);
      expect(detail.state).toBe("idle");
      expect(detail.chat.at(-1)).toMatchObject({
        kind: "error", message: "The last reply was cut off when the hive stopped. Send a message to carry on.", actions: [],
      });

      after.send(id, "Carry on.");
      expect(runner.last.request).toMatchObject({ sessionId: first.request.sessionId, resume: true, message: "Carry on." });
    });

    it("writes an error line with no actions for a turn that fails, and none for one you stopped", async () => {
      const { id } = chats.create(projectId, "Hi.");
      await runner.last.end({ kind: "error", message: "The session crashed." });
      expect(chats.detail(id).chat.at(-1)).toMatchObject({ kind: "error", message: "The session crashed.", actions: [] });

      chats.send(id, "Again.");
      await chats.stop(id);
      await settle();
      expect(chats.detail(id).chat.at(-1)).toMatchObject({ kind: "message", text: "Again." });
      expect(chats.detail(id).turnRunning).toBe(false);
    });
  });

  describe("questions (The ●)", () => {
    it("puts a question on the chat, not on For you or any card, and the answer goes back to the turn", async () => {
      const typed = hive.createCard(projectId, "A typed idea", "Some text.");
      const forYouBefore = hive.forYou();
      const { id } = chats.create(projectId, "Explain something.");
      const turn = runner.last;
      events.length = 0;

      const decision = turn.handlers.canUseTool("AskUserQuestion", question, signal());
      await settle();
      const detail = chats.detail(id);
      expect(detail.state).toBe("asking");
      expect(detail.pending).toMatchObject({ kind: "question", questions: [{ question: "Which part should I explain?" }] });
      expect(events).toContainEqual({ type: "projectChat.pending", chatId: id, pending: detail.pending });
      expect(events).toContainEqual({ type: "projectChat.updated", chat: expect.objectContaining({ id, state: "asking" }) });
      expect(events.filter((e) => !e.type.startsWith("projectChat."))).toEqual([]);
      expect(hive.forYou()).toEqual(forYouBefore);
      expect(hive.card(typed.id).pending).toBeNull();
      expect(hive.board().chats).toContainEqual(expect.objectContaining({ id, state: "asking" }));

      chats.answer(id, detail.pending!.id, { "Which part should I explain?": "Moves" });
      await expect(decision).resolves.toEqual({
        behavior: "allow", updatedInput: { ...question, answers: { "Which part should I explain?": "Moves" } },
      });
      expect(stateOf(id)).toBe("working");
      expect(chats.detail(id).pending).toBeNull();
      expect(chats.detail(id).chat.at(-1)).toMatchObject({ from: "you", text: "Moves" });
    });

    it("takes a message sent while a question waits as its answer", async () => {
      const { id } = chats.create(projectId, "Explain something.");
      const decision = runner.last.handlers.canUseTool("AskUserQuestion", question, signal());
      await settle();
      chats.send(id, "The sessions, please.");
      await expect(decision).resolves.toMatchObject({
        behavior: "allow", updatedInput: { answers: { "Which part should I explain?": "The sessions, please." } },
      });
      expect(runner.turns).toHaveLength(1);
      expect(runner.last.pushed).toEqual([]);
    });

    it("sends an answer whose turn is gone after a restart as a message, on the same session", async () => {
      const { id } = chats.create(projectId, "Explain something.");
      const first = runner.last;
      first.handlers.onSessionCreated();
      void first.handlers.canUseTool("AskUserQuestion", question, signal());
      await settle();
      const pending = chats.detail(id).pending!;

      const after = new ProjectChats({ db, hub, runner, role, log: () => {} });
      after.recoverAfterRestart();
      expect(after.detail(id).state).toBe("asking");
      after.answer(id, pending.id, { "Which part should I explain?": "Moves" });
      expect(runner.turns).toHaveLength(2);
      expect(runner.last.request).toMatchObject({
        sessionId: first.request.sessionId, resume: true,
        message: answerAsMessage((pending as { questions: any }).questions, { "Which part should I explain?": "Moves" }),
      });
      expect(after.detail(id).state).toBe("working");
    });

    it("denies a permission request: a chat changes nothing", async () => {
      chats.create(projectId, "Hi.");
      await expect(runner.last.handlers.canUseTool("Write", { file_path: "x" }, signal())).resolves.toEqual({
        behavior: "deny", message: "A project chat doesn't change anything.",
      });
    });

    it("drops a question still waiting when its turn ends", async () => {
      const { id } = chats.create(projectId, "Explain something.");
      const decision = runner.last.handlers.canUseTool("AskUserQuestion", question, signal());
      await settle();
      await runner.last.end({ kind: "error", message: "It broke." });
      await expect(decision).resolves.toMatchObject({ behavior: "deny" });
      expect(chats.detail(id)).toMatchObject({ state: "idle", pending: null });
    });
  });

  describe("Make it an idea", () => {
    it("refuses a draft with the greyed button's reasons", async () => {
      const { id } = chats.create(projectId, "Hi.");
      expect(() => chats.draft(id)).toThrow(expect.objectContaining({ status: 409, message: "Wait for Claude to finish" }));
      await runner.last.end();
      expect(() => chats.draft(id)).toThrow(expect.objectContaining({ status: 409, message: "Say something first" }));

      const { chatId } = await chatWithReply();
      chats.send(chatId, "Ask me something.");
      void runner.last.handlers.canUseTool("AskUserQuestion", question, signal());
      await settle();
      expect(() => chats.draft(chatId)).toThrow(expect.objectContaining({ status: 409, message: "Answer the question first" }));

      const other = await chatWithReply();
      await drafted(other.chatId);
      expect(() => chats.draft(other.chatId)).toThrow(expect.objectContaining({ status: 409, message: "Add or cancel the idea first" }));
    });

    it("drafts quietly in the chat's own session, with the draft instructions and the report", async () => {
      const { chatId, turn: first } = await chatWithReply();
      const before = chats.detail(chatId).chat;
      chats.draft(chatId);
      expect(draftOf(chatId)).toEqual({ status: "drafting", title: "", text: "", reason: "" });
      const turn = runner.last;
      expect(turn.request).toMatchObject({
        sessionId: first.request.sessionId, resume: true, cwd: projectPath, role: { name: "project-chat" },
      });
      expect(turn.request.outputFormat).toBe(IDEA_DRAFT_SCHEMA);
      expect(turn.request.message).toContain("Draft one idea from this chat.");
      expect(turn.request.message).toContain("Ideas already made from this chat:\n- (none)");

      events.length = 0;
      turn.handlers.onTextDelta("Here's");
      turn.handlers.onTextBlock("Here's a draft.");
      turn.handlers.onActivity("reading README.md…");
      await expect(turn.handlers.canUseTool("AskUserQuestion", question, signal())).resolves.toEqual({
        behavior: "deny", message: "Draft from what you have; leave open points in the text.",
      });
      expect(() => chats.send(chatId, "Wait!")).toThrow(expect.objectContaining({ status: 409, message: "Claude is drafting the idea" }));
      await turn.end({ kind: "ok", report: { status: "done", reason: null, title: "Show the move", text: "Say why a card moved." } });

      expect(chats.detail(chatId).chat).toEqual(before);
      expect(events.some((e) => e.type === "projectChat.delta" || e.type === "projectChat.message")).toBe(false);
      expect(events.filter((e) => e.type === "projectChat.activity")).toEqual([{ type: "projectChat.activity", chatId, text: null }]);
      expect(draftOf(chatId)).toEqual({ status: "ready", title: "Show the move", text: "Say why a card moved.", reason: "" });
      expect(events).toContainEqual({ type: "projectChat.updated", chat: expect.objectContaining({ id: chatId, state: "idle" }) });
    });

    it("fails a draft that's blocked, missing or errored, with a reason, and opens the form empty", async () => {
      const a = await chatWithReply();
      await drafted(a.chatId, { status: "blocked", reason: "There's no idea in the chat yet.", title: "", text: "" });
      expect(draftOf(a.chatId)).toEqual({ status: "failed", title: "", text: "", reason: "There's no idea in the chat yet." });

      const b = await chatWithReply();
      chats.draft(b.chatId);
      await runner.last.end({ kind: "ok" });
      expect(draftOf(b.chatId)).toMatchObject({ status: "failed", reason: "No draft came back." });

      const c = await chatWithReply();
      chats.draft(c.chatId);
      await runner.last.end({ kind: "error", message: "Overloaded." });
      expect(draftOf(c.chatId)).toMatchObject({ status: "failed", reason: "The draft failed: Overloaded." });
      expect(chats.detail(c.chatId).chat.some((item) => item.kind === "error")).toBe(false);
    });

    it("clears the draft when Cancel stops the draft turn, and closes a ready one", async () => {
      const { chatId } = await chatWithReply();
      chats.draft(chatId);
      const turn = runner.last;
      await chats.closeDraft(chatId);
      await settle();
      expect(turn.interrupted).toBe(true);
      expect(draftOf(chatId)).toBeNull();
      expect(chats.detail(chatId).turnRunning).toBe(false);

      await drafted(chatId);
      expect(draftOf(chatId)?.status).toBe("ready");
      await chats.closeDraft(chatId);
      expect(draftOf(chatId)).toBeNull();
    });

    it("lets you chat while a ready draft's form stays open", async () => {
      const { chatId } = await chatWithReply();
      await drafted(chatId);
      chats.send(chatId, "One more thing.");
      expect(runner.last.request.outputFormat).toBeUndefined();
      expect(draftOf(chatId)?.status).toBe("ready");
    });

    it("fails a draft left drafting by a restart", async () => {
      const { chatId } = await chatWithReply();
      chats.draft(chatId);
      const after = new ProjectChats({ db, hub, runner, role, log: () => {} });
      after.recoverAfterRestart();
      expect(after.detail(chatId)).toMatchObject({
        turnRunning: false,
        draft: { status: "failed", reason: "The hive stopped while drafting. Press Make it an idea again." },
      });
      expect(after.detail(chatId).chat.some((item) => item.kind === "error")).toBe(false);
    });
  });

  describe("the card made from a chat", () => {
    it("copies only your and Claude's messages into its Ideas chat, keeping their time, and closes the draft", async () => {
      const { chatId } = await chatWithReply();
      chats.send(chatId, "So it could say why?");
      await runner.last.end({ kind: "error", message: "A hiccup." });
      await drafted(chatId);
      const chatBefore = chats.detail(chatId).chat;

      const card = hive.createCard(projectId, "Say why a card moved", "Show the reason on the card.", chatId);
      expect(db.getCard(card.id)!.chatId).toBe(chatId);
      const copy = hive.card(card.id).chat;
      const messages = chatBefore.filter((c) => c.kind === "message");
      expect(copy.map((c) => c.kind === "message" && [c.from, c.text, c.at])).toEqual(
        messages.map((c) => c.kind === "message" && [c.from, c.text, c.at]));
      expect(copy.map((c) => c.id)).not.toContain(messages[0]!.id);
      expect(db.eventsOf(card.id, ["chat"]).every((e) => e.data.lane === "ideas")).toBe(true);

      const detail = chats.detail(chatId);
      expect(detail.draft).toBeNull();
      // The note links to the card (docs/specs/2026-11-28-chat-with-a-project-then-make-it-an-idea.md, Amendments).
      const note = { kind: "message", from: "hive", text: "Made an idea: Say why a card moved.", cardId: card.id };
      expect(detail.chat.at(-1)).toMatchObject(note);
      expect(events).toContainEqual({ type: "projectChat.message", chatId, item: expect.objectContaining(note) });
      expect(detail).not.toHaveProperty("ideas");
      expect(events).toContainEqual({ type: "projectChat.updated", chat: expect.objectContaining({ id: chatId }) });
      expect(hive.card(card.id).fromChat).toEqual({ id: chatId, title: detail.title });
    });

    it("shows a deleted card's note as plain text, while its row keeps the card's id", async () => {
      const { chatId } = await chatWithReply();
      const card = hive.createCard(projectId, "Say why a card moved", "Show the reason.", chatId);
      const noteOf = () => chats.detail(chatId).chat.find((item) => item.kind === "message" && item.from === "hive")!;
      expect(noteOf()).toMatchObject({ cardId: card.id });

      await hive.deleteCard(card.id);
      const note = noteOf();
      expect(note).toMatchObject({ kind: "message", from: "hive", text: "Made an idea: Say why a card moved." });
      expect(note).not.toHaveProperty("cardId");
      const row = db.db.prepare("SELECT data FROM chat_events WHERE id = ?").get(note.id) as { data: string };
      expect(JSON.parse(row.data)).toMatchObject({ cardId: card.id });
      // The card's own messages, which never carry a card id, are unchanged.
      expect(chats.detail(chatId).chat.filter((item) => item.kind === "message" && item.from !== "hive")
        .every((item) => !("cardId" in item))).toBe(true);
    });

    it("refuses an unknown chat, and a chat of another project", async () => {
      expect(() => hive.createCard(projectId, "Idea", "Text.", "nope")).toThrow(expect.objectContaining({ status: 404 }));
      const other = makeRepo();
      repos.push(other);
      await hive.addProject(other.root);
      const otherId = hive.board().projects.find((p) => p.id !== projectId)!.id;
      const { chatId } = await chatWithReply();
      expect(() => hive.createCard(otherId, "Idea", "Text.", chatId)).toThrow(
        expect.objectContaining({ status: 409, message: "That chat is about another project." }));
      expect(hive.board().cards).toEqual([]);
    });

    it("lists the ideas already made in the next draft, and the chat still answers", async () => {
      const { chatId } = await chatWithReply();
      await drafted(chatId);
      hive.createCard(projectId, "Say why a card moved", "Show the reason.", chatId);
      chats.send(chatId, "What about the For you page?");
      expect(runner.last.request.outputFormat).toBeUndefined();
      runner.last.handlers.onTextBlock("It lists what waits.");
      await runner.last.end();
      chats.draft(chatId);
      expect(runner.last.request.message).toContain("Ideas already made from this chat:\n- Say why a card moved");
    });

    it("shows the copy in Ideas, then in the look-back, and keeps it when the chat is deleted", async () => {
      const { chatId } = await chatWithReply();
      const card = hive.createCard(projectId, "Say why a card moved", "Show the reason.", chatId);
      expect(hive.card(card.id).chat).toHaveLength(2);
      expect(hive.card(card.id).fromChat).toMatchObject({ id: chatId });

      await hive.moveCard(card.id, "refine");
      await waitFor(() => hive.card(card.id).setup?.status === "done");
      const inRefine = hive.card(card.id);
      expect(inRefine.pastChats.ideas?.map((c) => c.kind === "message" && c.from)).toEqual(["you", "project-chat"]);

      chats.delete(chatId);
      const after = hive.card(card.id);
      expect(after.fromChat).toBeNull();
      expect(after.pastChats.ideas).toHaveLength(2);
      expect(db.getCard(card.id)!.chatId).toBeNull();
    });

    it("gives the product owner the chat first, and a typed idea no chat", async () => {
      const { chatId } = await chatWithReply("How does a card move from Build to Check?", "Through board/moves.ts.");
      const fromChat = hive.createCard(projectId, "Say why a card moved", "Show the reason.", chatId);
      await hive.moveCard(fromChat.id, "refine");
      await waitFor(() => hive.card(fromChat.id).setup?.status === "done");
      const message = runner.turns.find((t) => t.request.role.name === "product-owner")!.request.message;
      expect(message).toContain(
        "Before it was a card, this idea came out of a chat with the project. Read it first, and don't ask again what " +
          "it already settles. The chat may cover other ideas too: this card is only the title and idea above, and the " +
          "rest is background.");
      expect(message).toContain("you: How does a card move from Build to Check?\n\nclaude: Through board/moves.ts.");
      expect(message).not.toContain("Made an idea");

      const typed = hive.createCard(projectId, "Typed", "Typed text.");
      await hive.moveCard(typed.id, "refine");
      await waitFor(() => hive.card(typed.id).setup?.status === "done");
      const typedMessage = runner.turns.filter((t) => t.request.role.name === "product-owner").at(-1)!.request.message;
      expect(typedMessage).not.toContain("Before it was a card");
      expect(typedMessage).not.toContain("you:");
    });
  });

  describe("the board and delete", () => {
    it("reports each chat's state on the board", async () => {
      const { chatId: idle } = await chatWithReply();
      const { id: working } = chats.create(projectId, "Still thinking.");
      const { id: asking } = chats.create(projectId, "Ask me.");
      void runner.last.handlers.canUseTool("AskUserQuestion", question, signal());
      await settle();
      const states = Object.fromEntries(hive.board().chats.map((c) => [c.id, c.state]));
      expect(states).toEqual({ [idle]: "idle", [working]: "working", [asking]: "asking" });
    });

    it("deletes a chat mid-turn: its rows go, its waiter is dropped, and the turn's late end writes nothing", async () => {
      const { chatId } = await chatWithReply();
      const card = hive.createCard(projectId, "Idea", "Text.", chatId);
      chats.send(chatId, "Ask me.");
      const turn: FakeTurn = runner.last;
      const decision = turn.handlers.canUseTool("AskUserQuestion", question, signal());
      await settle();

      chats.delete(chatId);
      expect(turn.interrupted).toBe(true);
      await expect(decision).resolves.toMatchObject({ behavior: "deny", interrupt: true });
      expect(events).toContainEqual({ type: "projectChat.deleted", chatId });
      expect(db.getChat(chatId)).toBeUndefined();
      expect(db.chatItems(chatId)).toEqual([]);
      expect(db.getCard(card.id)!.chatId).toBeNull();
      expect(() => chats.detail(chatId)).toThrow(expect.objectContaining({ status: 404 }));

      turn.handlers.onTextBlock("A late block.");
      await turn.end({ kind: "error", message: "Interrupted." });
      expect(db.chatItems(chatId)).toEqual([]);
      expect(chats.isDeleting(chatId)).toBe(false);
      expect(hive.card(card.id).chat).toHaveLength(2);
    });
  });
});
