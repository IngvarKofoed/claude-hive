import { useEffect, useRef } from "react";
import type { HiveEvent } from "@hive/shared";

type Listener = (event: HiveEvent) => void;

const listeners = new Set<Listener>();
const openListeners = new Set<() => void>();
let source: EventSource | null = null;

// One EventSource for the page's whole life. Closing and reopening it on every route change (twice under
// StrictMode) lost events in practice, so it stays open and reconnects on its own if the hive restarts.
function ensureSource() {
  if (source || typeof EventSource === "undefined") return;
  source = new EventSource("/api/events");
  source.onopen = () => {
    for (const listener of openListeners) listener();
  };
  source.onmessage = (message) => {
    let event: HiveEvent;
    try {
      event = JSON.parse(message.data) as HiveEvent;
    } catch {
      return;
    }
    for (const listener of listeners) listener(event);
  };
}

/** Subscribe to the one shared event stream. Returns the unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  ensureSource();
  return () => {
    listeners.delete(listener);
  };
}

/** Called each time the stream (re)connects, so a page can refetch what it may have missed. */
export function onStreamOpen(listener: () => void): () => void {
  openListeners.add(listener);
  ensureSource();
  return () => {
    openListeners.delete(listener);
  };
}

/** Call `handler` for every event; the handler may change between renders. */
export function useHiveEvents(handler: Listener) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe((event) => ref.current(event)), []);
}

/** Call `handler` each time the event stream (re)connects. */
export function useStreamOpen(handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => onStreamOpen(() => ref.current()), []);
}
