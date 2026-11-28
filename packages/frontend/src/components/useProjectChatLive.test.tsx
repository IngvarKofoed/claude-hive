import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HiveEvent, ProjectChatDetail } from "@hive/shared";

const listeners = new Set<(event: HiveEvent) => void>();
const openListeners = new Set<() => void>();
vi.mock("../api/events", () => ({
  subscribe: (l: (event: HiveEvent) => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  onStreamOpen: (l: () => void) => {
    openListeners.add(l);
    return () => openListeners.delete(l);
  },
}));

import { api } from "../api/client";
import { useProjectChatLive } from "./useProjectChatLive";

const detail: ProjectChatDetail = {
  id: "ch1",
  projectId: "p1",
  title: "How does the market work",
  state: "working",
  updatedAt: "2026-11-28T10:00:00Z",
  projectName: "flux",
  chat: [{ kind: "message", id: "m1", at: "t", from: "you", text: "first" }],
  pending: null,
  turnRunning: true,
  draft: null,
};

const emit = (event: HiveEvent) => listeners.forEach((l) => l(event));
const reply = (id: string, text: string): HiveEvent => ({
  type: "projectChat.message",
  chatId: "ch1",
  item: { kind: "message", id, at: "t", from: "project-chat", text },
});

beforeEach(() => {
  listeners.clear();
  openListeners.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("useProjectChatLive", () => {
  it("subscribes before it fetches, buffers events, and skips chat items the fetch already has", async () => {
    let resolve!: (d: ProjectChatDetail) => void;
    const fetchChat = vi.spyOn(api, "projectChat").mockImplementation(
      () =>
        new Promise<ProjectChatDetail>((r) => {
          resolve = r;
        }),
    );
    const { result } = renderHook(() => useProjectChatLive("ch1"));
    expect(listeners.size).toBe(1);
    expect(fetchChat).toHaveBeenCalledTimes(1);
    expect(result.current.live).toBeNull();

    act(() => {
      emit({ type: "projectChat.message", chatId: "ch1", item: detail.chat[0]! });
      emit(reply("m2", "second"));
      emit({ type: "projectChat.activity", chatId: "ch1", text: "reading src/market.ts…" });
    });
    expect(result.current.live).toBeNull();

    await act(async () => resolve(detail));
    expect(result.current.live!.detail.chat.map((c) => c.id)).toEqual(["m1", "m2"]);
    expect(result.current.live!.activity).toBe("reading src/market.ts…");

    // After the load, events apply directly.
    act(() => emit({ type: "projectChat.delta", chatId: "ch1", text: "typing" }));
    expect(result.current.live!.streaming).toBe("typing");
  });

  it("refetches when the stream opens and on an update to this chat, but not for another chat", async () => {
    const fetchChat = vi.spyOn(api, "projectChat").mockResolvedValue(detail);
    const { result } = renderHook(() => useProjectChatLive("ch1"));
    await waitFor(() => expect(result.current.live).not.toBeNull());
    expect(fetchChat).toHaveBeenCalledTimes(1);

    await act(async () => openListeners.forEach((l) => l()));
    expect(fetchChat).toHaveBeenCalledTimes(2);

    const summary = { id: "ch2", projectId: "p1", title: "Other", state: "idle", updatedAt: "t" } as const;
    act(() => emit({ type: "projectChat.updated", chat: summary }));
    expect(fetchChat).toHaveBeenCalledTimes(2);

    fetchChat.mockResolvedValue({ ...detail, state: "idle", turnRunning: false });
    await act(async () => emit({ type: "projectChat.updated", chat: { ...summary, id: "ch1", state: "idle" } }));
    expect(fetchChat).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(result.current.live!.detail.turnRunning).toBe(false));
  });

  it("keeps the streaming text and the activity line across a refetch", async () => {
    const fetchChat = vi.spyOn(api, "projectChat").mockResolvedValue(detail);
    const { result } = renderHook(() => useProjectChatLive("ch1"));
    await waitFor(() => expect(result.current.live).not.toBeNull());
    act(() => {
      emit({ type: "projectChat.delta", chatId: "ch1", text: "half a sent" });
      emit({ type: "projectChat.activity", chatId: "ch1", text: "reading…" });
    });
    await act(async () => openListeners.forEach((l) => l()));
    expect(fetchChat).toHaveBeenCalledTimes(2);
    expect(result.current.live!.streaming).toBe("half a sent");
    expect(result.current.live!.activity).toBe("reading…");
  });

  it("keeps your own message from ending the block being written, and a reply replaces it", async () => {
    vi.spyOn(api, "projectChat").mockResolvedValue(detail);
    const { result } = renderHook(() => useProjectChatLive("ch1"));
    await waitFor(() => expect(result.current.live).not.toBeNull());
    act(() => emit({ type: "projectChat.delta", chatId: "ch1", text: "typing" }));
    act(() =>
      emit({ type: "projectChat.message", chatId: "ch1", item: { kind: "message", id: "m9", at: "t", from: "you", text: "hm" } }),
    );
    expect(result.current.live!.streaming).toBe("typing");
    act(() => emit(reply("m10", "typing done")));
    expect(result.current.live!.streaming).toBe("");
  });

  it("applies a pending question, and says when the chat was deleted", async () => {
    vi.spyOn(api, "projectChat").mockResolvedValue(detail);
    const { result } = renderHook(() => useProjectChatLive("ch1"));
    await waitFor(() => expect(result.current.live).not.toBeNull());
    const pending = {
      id: "q1",
      kind: "question",
      questions: [],
    } as unknown as NonNullable<ProjectChatDetail["pending"]>;
    act(() => emit({ type: "projectChat.pending", chatId: "ch1", pending }));
    expect(result.current.live!.detail.pending?.id).toBe("q1");

    act(() => emit({ type: "projectChat.deleted", chatId: "ch2" }));
    expect(result.current.gone).toBe(false);
    act(() => emit({ type: "projectChat.deleted", chatId: "ch1" }));
    expect(result.current.gone).toBe(true);
  });

  it("reports a failed load", async () => {
    vi.spyOn(api, "projectChat").mockRejectedValue(new Error("No such chat."));
    const { result } = renderHook(() => useProjectChatLive("ch1"));
    await waitFor(() => expect(result.current.error).toBe("No such chat."));
  });
});
