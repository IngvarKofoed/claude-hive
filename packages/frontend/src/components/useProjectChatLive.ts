import { useCallback, useEffect, useRef, useState } from "react";
import type { HiveEvent, ProjectChatDetail } from "@hive/shared";
import { api } from "../api/client";
import { onStreamOpen, subscribe } from "../api/events";
import { applyProjectChatEvent, type ProjectChatLive } from "./projectChatState";

/**
 * A project chat page's live state, built like `useCardLive`: it subscribes before it fetches and holds whatever
 * arrives meanwhile, then applies it on top of the fetched chat. It refetches when the stream (re)connects and when the
 * chat changes (its state, its draft, its ideas). A refetch keeps the text being written and the activity line, which
 * the server never stores; only the first load starts them empty.
 */
export function useProjectChatLive(id: string | undefined) {
  const [live, setLive] = useState<ProjectChatLive | null>(null);
  /** The chat was deleted, here or elsewhere. */
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const liveRef = useRef<ProjectChatLive | null>(null);
  const bufferRef = useRef<HiveEvent[] | null>(null);
  const latestLoad = useRef(0);

  const load = useCallback(async () => {
    if (!id) return;
    const mine = ++latestLoad.current;
    const buffer: HiveEvent[] = [];
    bufferRef.current = buffer;
    try {
      const detail: ProjectChatDetail = await api.projectChat(id);
      if (mine !== latestLoad.current) return;
      const before = liveRef.current;
      let next: ProjectChatLive = { detail, streaming: before?.streaming ?? "", activity: before?.activity ?? null };
      for (const event of buffer) next = applyProjectChatEvent(next, event);
      bufferRef.current = null;
      liveRef.current = next;
      setLive(next);
      setError(null);
    } catch (err) {
      if (mine !== latestLoad.current) return;
      bufferRef.current = null;
      setError(err instanceof Error ? err.message : "Could not load the chat.");
    }
  }, [id]);

  useEffect(() => {
    liveRef.current = null;
    setLive(null);
    setError(null);
    setGone(false);
    const unsubscribe = subscribe((event) => {
      // Checked before buffering, as in useCardLive: a delete during a load mustn't be dropped with the buffer.
      if (event.type === "projectChat.deleted" && event.chatId === id) {
        setGone(true);
        return;
      }
      if (bufferRef.current) {
        bufferRef.current.push(event);
        return;
      }
      const prev = liveRef.current;
      if (!prev) return;
      const next = applyProjectChatEvent(prev, event);
      liveRef.current = next;
      setLive(next);
      if (event.type === "projectChat.updated" && event.chat.id === prev.detail.id) void load();
    });
    // Whatever happened while the stream was down (a hive restart, a slow connect) is in the chat itself.
    const unsubscribeOpen = onStreamOpen(() => void load());
    void load();
    return () => {
      unsubscribe();
      unsubscribeOpen();
      latestLoad.current++;
      bufferRef.current = null;
    };
  }, [id, load]);

  return { live, error, reload: load, gone };
}
