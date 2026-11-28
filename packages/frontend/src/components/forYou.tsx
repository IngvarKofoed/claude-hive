import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ForYouItem } from "@hive/shared";
import { api } from "../api/client";
import { useHiveEvents, useStreamOpen } from "../api/events";

export interface ForYouValue {
  items: ForYouItem[];
  loaded: boolean;
  error: string | null;
  /**
   * Fetch the list again, after you pressed something that moves a card. The promise resolves once the newest load has
   * settled, even when a later load (an event's) supersedes this one, so the list is then the one For you shows. It
   * never rejects: a failed load sets `error`. Outside a provider it resolves at once and fetches nothing.
   */
  reload: () => Promise<void>;
}

const EMPTY: ForYouValue = { items: [], loaded: false, error: null, reload: async () => {} };
const ForYouContext = createContext<ForYouValue>(EMPTY);

/** Everything waiting for you, kept fresh from the event stream. Outside a provider it is empty and quiet. */
export function useForYou(): ForYouValue {
  return useContext(ForYouContext);
}

export function ForYouProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ForYouItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);
  // The newest load's promise: a load that a newer one supersedes settles with it, not on its own stale response.
  const latest = useRef<Promise<void>>(Promise.resolve());

  const load = useCallback((): Promise<void> => {
    const mine = ++counter.current;
    const run = (async (): Promise<void> => {
      try {
        const response = await api.forYou();
        if (mine !== counter.current) return latest.current;
        setItems(response.items);
        setError(null);
      } catch (err) {
        if (mine !== counter.current) return latest.current;
        setError(err instanceof Error ? err.message : "Could not load what is waiting for you.");
      } finally {
        if (mine === counter.current) setLoaded(true);
      }
    })();
    latest.current = run;
    return run;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useStreamOpen(() => void load());
  useHiveEvents((event) => {
    if (
      event.type === "card.updated" ||
      event.type === "card.deleted" ||
      event.type === "pending.updated" ||
      event.type === "spec.updated" ||
      // An error line can arrive on a card that already needs you, with no card.updated: it's the entry's new line.
      (event.type === "chat.message" && event.item.kind === "error")
    )
      void load();
  });

  const value = useMemo(() => ({ items, loaded, error, reload: load }), [items, loaded, error, load]);
  return <ForYouContext.Provider value={value}>{children}</ForYouContext.Provider>;
}
