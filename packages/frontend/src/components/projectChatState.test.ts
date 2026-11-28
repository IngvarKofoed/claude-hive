import { describe, expect, it } from "vitest";
import type { ProjectChatDetail } from "@hive/shared";
import { applyProjectChatEvent, type ProjectChatLive } from "./projectChatState";

const detail: ProjectChatDetail = {
  id: "c1", projectId: "p1", title: "How do cards move?", state: "working", updatedAt: "2026-11-28T10:00:00.000Z",
  projectName: "flux", chat: [], pending: null, turnRunning: true, draft: null,
};
const live: ProjectChatLive = { detail, streaming: "Through mov", activity: "reading moves.ts…" };

describe("applyProjectChatEvent", () => {
  it("clears a cut-off block and the activity line once the chat is idle", () => {
    const next = applyProjectChatEvent(live, { type: "projectChat.updated", chat: { ...detail, state: "idle" } });
    expect(next).toMatchObject({ streaming: "", activity: null, detail: { state: "idle", turnRunning: false } });
  });

  it("keeps the block being written while the chat works or asks", () => {
    const working = applyProjectChatEvent(live, { type: "projectChat.updated", chat: { ...detail, updatedAt: "later" } });
    expect(working).toMatchObject({ streaming: "Through mov", detail: { updatedAt: "later", turnRunning: true } });
    const asking = applyProjectChatEvent(live, { type: "projectChat.updated", chat: { ...detail, state: "asking" } });
    expect(asking).toMatchObject({ streaming: "Through mov", activity: "reading moves.ts…", detail: { state: "asking" } });
  });

  it("ignores another chat's events", () => {
    expect(applyProjectChatEvent(live, { type: "projectChat.updated", chat: { ...detail, id: "c2", state: "idle" } })).toBe(live);
    expect(applyProjectChatEvent(live, { type: "projectChat.delta", chatId: "c2", text: "x" })).toBe(live);
  });

  it("strips a deleted card's id from the notes that link to it, and nothing else", () => {
    const note = (id: string, cardId?: string) => ({ kind: "message" as const, id, at: "t", from: "hive" as const, text: id, ...(cardId ? { cardId } : {}) });
    const withNotes: ProjectChatLive = { ...live, detail: { ...detail, chat: [note("a", "k1"), note("b", "k2"), note("c")] } };
    const next = applyProjectChatEvent(withNotes, { type: "card.deleted", cardId: "k1" });
    expect(next.detail.chat).toEqual([note("a"), note("b", "k2"), note("c")]);
    expect("cardId" in (next.detail.chat[0] ?? {})).toBe(false);
    expect(next.streaming).toBe(live.streaming);
    expect(applyProjectChatEvent(withNotes, { type: "card.deleted", cardId: "k9" })).toBe(withNotes);
  });
});
