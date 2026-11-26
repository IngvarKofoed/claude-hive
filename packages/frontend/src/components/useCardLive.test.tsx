import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardDetail, HiveEvent } from "@hive/shared";

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
import { useCardLive } from "./useCardLive";

const detail: CardDetail = {
  id: "c1",
  projectId: "p1",
  projectName: "m",
  title: "T",
  ideaText: "i",
  lane: "refine",
  state: "working",
  moveError: null,
  branch: null,
  worktreePath: null,
  brief: null,
  spec: null,
  plan: null,
  chat: [{ kind: "message", id: "m1", at: "t", from: "you", text: "first" }],
  pending: null,
  turnRunning: true,
};

const emit = (event: HiveEvent) => listeners.forEach((l) => l(event));

beforeEach(() => {
  listeners.clear();
  openListeners.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("useCardLive", () => {
  it("subscribes before it fetches, buffers events, and skips chat items the fetch already has", async () => {
    let resolve!: (d: CardDetail) => void;
    const fetchCard = vi.spyOn(api, "card").mockImplementation(
      () =>
        new Promise<CardDetail>((r) => {
          resolve = r;
        }),
    );
    const { result } = renderHook(() => useCardLive("c1"));
    expect(listeners.size).toBe(1);
    expect(fetchCard).toHaveBeenCalledTimes(1);
    expect(result.current.live).toBeNull();

    act(() => {
      emit({ type: "chat.message", cardId: "c1", item: { kind: "message", id: "m1", at: "t", from: "you", text: "first" } });
      emit({
        type: "chat.message",
        cardId: "c1",
        item: { kind: "message", id: "m2", at: "t", from: "product-owner", text: "second" },
      });
      emit({ type: "turn.ended", cardId: "c1" });
    });
    expect(result.current.live).toBeNull();

    await act(async () => resolve(detail));
    const chat = result.current.live!.detail.chat;
    expect(chat.map((c) => c.id)).toEqual(["m1", "m2"]);
    expect(result.current.live!.detail.turnRunning).toBe(false);

    // After the load, events apply directly.
    act(() => emit({ type: "chat.delta", cardId: "c1", text: "typing" }));
    expect(result.current.live!.streaming).toBe("typing");
  });

  it("refetches when the stream reconnects and when the card changes lane", async () => {
    const fetchCard = vi.spyOn(api, "card").mockResolvedValue(detail);
    const { result } = renderHook(() => useCardLive("c1"));
    await waitFor(() => expect(result.current.live).not.toBeNull());
    expect(fetchCard).toHaveBeenCalledTimes(1);

    await act(async () => openListeners.forEach((l) => l()));
    expect(fetchCard).toHaveBeenCalledTimes(2);

    // Same lane: no refetch.
    act(() =>
      emit({
        type: "card.updated",
        card: { id: "c1", projectId: "p1", title: "T", lane: "refine", state: "needs-you", moveError: null },
      }),
    );
    expect(fetchCard).toHaveBeenCalledTimes(2);

    fetchCard.mockResolvedValue({ ...detail, lane: "spec", chat: [] });
    await act(async () =>
      emit({
        type: "card.updated",
        card: { id: "c1", projectId: "p1", title: "T", lane: "spec", state: "working", moveError: null },
      }),
    );
    expect(fetchCard).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(result.current.live!.detail.lane).toBe("spec"));
    expect(result.current.live!.detail.chat).toEqual([]);
  });

  it("reports a failed load", async () => {
    vi.spyOn(api, "card").mockRejectedValue(new Error("Card not found"));
    const { result } = renderHook(() => useCardLive("c1"));
    await waitFor(() => expect(result.current.error).toBe("Card not found"));
  });
});
