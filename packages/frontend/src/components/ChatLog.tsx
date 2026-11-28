import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { ChatAuthor, ChatItem, LaneActionState, PendingItem } from "@hive/shared";
import { PendingCard, type AnswerFn } from "./PendingCard";
import { Button } from "./ui/Button";
import { ChatBubble } from "./ui/ChatBubble";
import styles from "./ChatLog.module.css";

/** The log's line while a turn runs and nothing else shows (docs/specs/2026-11-28-instant-feedback-on-message.md). */
const WORKING = "thinking…";

/** How far short of the bottom still counts as the bottom, in pixels. */
const BOTTOM_SLACK = 8;

/** Whether a scrolling box is at its bottom, give or take a few pixels. */
export function isAtBottom(box: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= BOTTOM_SLACK;
}

/** A chat's messages and error lines. A message with a `cardId` links to that card. Only the last line gets `lastActions` as its buttons. */
export function ChatItems({
  items,
  lastActions = [],
  onAction,
}: {
  items: ChatItem[];
  lastActions?: LaneActionState[];
  onAction?: (action: LaneActionState) => void;
}) {
  return items.map((item, index) =>
    item.kind === "message" ? (
      <ChatBubble key={item.id} from={item.from}>
        {item.cardId ? <Link to={`/cards/${item.cardId}`}>{item.text}</Link> : item.text}
      </ChatBubble>
    ) : (
      <ChatBubble key={item.id} from="error">
        <p>{item.message}</p>
        {onAction && index === items.length - 1 && lastActions.length > 0 ? (
          <div className={styles.actions}>
            {lastActions.map((action) => (
              <Button
                key={action.id}
                compact
                disabled={!action.enabled}
                title={action.reason ?? undefined}
                onClick={() => onAction(action)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </ChatBubble>
    ),
  );
}

interface Props {
  items: ChatItem[];
  /** Text of the block being written. */
  streaming: string;
  /** Who the streaming bubble is from. */
  streamingFrom: ChatAuthor;
  activity: string | null;
  turnRunning: boolean;
  pending: PendingItem | null;
  /** A question's answer failed to send. */
  onError: (message: string) => void;
  /** Where a pending item's answer goes; the card's own endpoint when left out. */
  answer?: AnswerFn;
  /** The buttons the last chat line offers, when it's an error line. */
  lastActions?: LaneActionState[];
  onAction?: (action: LaneActionState) => void;
  /** Framed: the log scrolls on its own inside the panel, and its box keeps a floor. */
  framed?: boolean;
  /** What the log says while it has nothing in it. */
  emptyText?: string;
}

export interface ChatLogHandle {
  /** Follow the bottom again, as after you send a message. */
  jumpToBottom: () => void;
}

/**
 * A chat's log: its bubbles, the streaming one, the activity line and a waiting question. It follows the bottom while
 * you're there, and flags what arrived while you were scrolled up.
 */
export const ChatLog = forwardRef<ChatLogHandle, Props>(function ChatLog(
  { items, streaming, streamingFrom, activity, turnRunning, pending, onError, answer, lastActions, onAction, framed, emptyText },
  ref,
) {
  // A tool's line wins; otherwise a running turn with no text streaming and no question waiting is thinking.
  const line = activity ?? (turnRunning && !streaming && !pending ? WORKING : null);
  const [unseen, setUnseen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  // Whether the log was at its bottom before the latest content arrived; kept by the scroll listener.
  const followRef = useRef(true);
  const seenRef = useRef<{ chat: number; streaming: string; pending: string | undefined } | null>(null);

  function toBottom() {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }

  // After a render that changed what the log shows: follow it from the bottom, or flag what arrived while scrolled up.
  useLayoutEffect(() => {
    const pendingId = pending?.id;
    const before = seenRef.current;
    seenRef.current = { chat: items.length, streaming, pending: pendingId };
    if (before === null || followRef.current) {
      followRef.current = true;
      toBottom();
      return;
    }
    const added =
      items.length > before.chat ||
      (streaming !== "" && streaming !== before.streaming) ||
      (pendingId !== undefined && pendingId !== before.pending);
    if (added) setUnseen(true);
  }, [items.length, streaming, pending?.id, line]);

  // The log's own box changes size when the window does, or when something below it grows (a hint, Stop, an error
  // line, a taller reply box, a project chat's draft form). Keep the log at its bottom here if it was there before the
  // change: a shrink can fire a scroll event first, which finds the log short of its bottom by the shrink and stops
  // following, so judge by where it was before the box got smaller.
  useEffect(() => {
    const log = logRef.current;
    if (!log || typeof ResizeObserver === "undefined") return;
    let height = log.clientHeight;
    const observer = new ResizeObserver(() => {
      const shrunk = Math.max(0, height - log.clientHeight);
      height = log.clientHeight;
      if (followRef.current || log.scrollHeight - log.scrollTop - log.clientHeight - shrunk <= BOTTOM_SLACK) {
        followRef.current = true;
        toBottom();
      }
    });
    observer.observe(log);
    return () => observer.disconnect();
  }, []);

  function onLogScroll() {
    const log = logRef.current;
    if (!log) return;
    followRef.current = isAtBottom(log);
    if (followRef.current) setUnseen(false);
  }

  function jumpToBottom() {
    followRef.current = true;
    setUnseen(false);
    toBottom();
  }

  useImperativeHandle(ref, () => ({ jumpToBottom }));

  const empty = items.length === 0 && !streaming && !line && !pending;

  return (
    <div className={styles.logBox} data-framed={framed || undefined}>
      <div className={styles.log} role="log" aria-live="polite" ref={logRef} onScroll={onLogScroll}>
        <ChatItems items={items} lastActions={lastActions} onAction={onAction} />
        {streaming ? (
          <ChatBubble from={streamingFrom} streaming>
            {streaming}
          </ChatBubble>
        ) : null}
        {line ? <p className={styles.activity}>{line}</p> : null}
        {pending ? <PendingCard item={pending} onError={onError} answer={answer} /> : null}
        {empty && emptyText ? <p className={styles.empty}>{emptyText}</p> : null}
      </div>
      {unseen ? (
        <Button compact className={styles.newMessages} onClick={jumpToBottom}>
          ↓ New messages
        </Button>
      ) : null}
    </div>
  );
});
