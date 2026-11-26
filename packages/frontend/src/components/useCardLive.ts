import { useCallback, useEffect, useRef, useState } from "react";
import type { CardDetail, HiveEvent } from "@hive/shared";
import { api } from "../api/client";
import { onStreamOpen, subscribe } from "../api/events";
import { applyCardEvent, type CardLive } from "./cardState";

/**
 * The card page's live state. It subscribes to the event stream before it fetches the card and holds whatever
 * arrives meanwhile, then applies it on top of the fetched card (chat items the fetch already has are skipped by
 * id). It refetches when the stream (re)connects and when the card changes lane, because the chat and the panels
 * belong to the lane.
 */
export function useCardLive(id: string | undefined) {
  const [live, setLive] = useState<CardLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const liveRef = useRef<CardLive | null>(null);
  const bufferRef = useRef<HiveEvent[] | null>(null);
  const latestLoad = useRef(0);

  const load = useCallback(async () => {
    if (!id) return;
    const mine = ++latestLoad.current;
    const buffer: HiveEvent[] = [];
    bufferRef.current = buffer;
    try {
      const detail: CardDetail = await api.card(id);
      if (mine !== latestLoad.current) return;
      let next: CardLive = { detail, streaming: "", activity: null };
      for (const event of buffer) next = applyCardEvent(next, event);
      bufferRef.current = null;
      liveRef.current = next;
      setLive(next);
      setError(null);
    } catch (err) {
      if (mine !== latestLoad.current) return;
      bufferRef.current = null;
      setError(err instanceof Error ? err.message : "Could not load the card.");
    }
  }, [id]);

  useEffect(() => {
    liveRef.current = null;
    setLive(null);
    setError(null);
    const unsubscribe = subscribe((event) => {
      if (bufferRef.current) {
        bufferRef.current.push(event);
        return;
      }
      const prev = liveRef.current;
      if (!prev) return;
      const next = applyCardEvent(prev, event);
      liveRef.current = next;
      setLive(next);
      if (event.type === "card.updated" && event.card.id === prev.detail.id && event.card.lane !== prev.detail.lane) {
        void load();
      }
    });
    // Whatever happened while the stream was down (a hive restart, a slow connect) is in the card itself.
    const unsubscribeOpen = onStreamOpen(() => void load());
    void load();
    return () => {
      unsubscribe();
      unsubscribeOpen();
      latestLoad.current++;
      bufferRef.current = null;
    };
  }, [id, load]);

  return { live, error, reload: load };
}
