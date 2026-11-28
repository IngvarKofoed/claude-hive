import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ForYouItem } from "@hive/shared";
import { api } from "../api/client";
import { useHiveEvents, useStreamOpen } from "../api/events";

export interface ForYouValue {
  items: ForYouItem[];
  loaded: boolean;
  error: string | null;
  /** Fetch the list again, after you pressed something that moves a card. */
  reload: () => void;
}

const EMPTY: ForYouValue = { items: [], loaded: false, error: null, reload: () => {} };
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

  const load = useCallback(async () => {
    const mine = ++counter.current;
    try {
      const response = await api.forYou();
      if (mine !== counter.current) return;
      setItems(response.items);
      setError(null);
    } catch (err) {
      if (mine !== counter.current) return;
      setError(err instanceof Error ? err.message : "Could not load what is waiting for you.");
    } finally {
      if (mine === counter.current) setLoaded(true);
    }
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

  const value = useMemo(() => ({ items, loaded, error, reload: () => void load() }), [items, loaded, error, load]);
  return <ForYouContext.Provider value={value}>{children}</ForYouContext.Provider>;
}
