import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CardDetail, ChatAuthor, ChatItem, Lane, LaneActionState } from "@hive/shared";
import { api } from "../api/client";
import { LANE_ACTION_CALLS, actionOf, laneActionsFor, type LaneActionCall } from "./laneActions";
import { PendingCard } from "./PendingCard";
import { Button } from "./ui/Button";
import { ChatBubble } from "./ui/ChatBubble";
import styles from "./Chat.module.css";

const LANE_AUTHOR: Partial<Record<Lane, ChatAuthor>> = {
  refine: "product-owner",
  spec: "spec-writer",
  plan: "planner",
  build: "developer",
  check: "reviewer",
};

/** Why the reply box is closed right now, or null when you can write. Plan, Build and Check have no reply box at all (see Chat). */
export function replyHint(detail: CardDetail): string | null {
  if (detail.lane !== "spec" || !detail.spec) return null;
  if (detail.spec.review === "running") return "Wait for the review";
  if (detail.spec.review === "applying" && !detail.pending) return "The spec writer is applying the review";
  return null;
}

interface Props {
  detail: CardDetail;
  streaming: string;
  activity: string | null;
  /** The five chat lanes: the log scrolls on its own between the panel's title and the footer. */
  framed?: boolean;
  /** Put at the right end of the Send row (Refine's Good). */
  sendRowEnd?: ReactNode;
}

/** The log's line while a turn runs and nothing else shows (docs/specs/2026-11-28-instant-feedback-on-message.md). */
const WORKING = "thinking…";

/** How far short of the bottom still counts as the bottom, in pixels. */
const BOTTOM_SLACK = 8;

/** Whether a scrolling box is at its bottom, give or take a few pixels. */
export function isAtBottom(box: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= BOTTOM_SLACK;
}

/**
 * The lane actions the last chat line offers: those it carries, when it's an error, among the ones on offer. An older
 * error line offers none: the server only acts on the lane's last line.
 */
function errorLineActions(chat: ChatItem[], actions: LaneActionState[]): LaneActionState[] {
  const last = chat.at(-1);
  if (last?.kind !== "error") return [];
  return actions.filter((action) => last.actions.some((id) => id === action.id));
}

/** A chat's messages and error lines. Only the last line gets `lastActions` as its buttons. */
function ChatItems({
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
        {item.text}
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

/**
 * A finished lane's chat, looked back at: only what was said, with nothing to type into or press
 * (docs/specs/2026-11-27-card-lane-artifacts.md).
 */
export function PastChat({ items }: { items: ChatItem[] }) {
  if (items.length === 0) return <p className={styles.empty}>No chat in this lane.</p>;
  return (
    <div className={styles.log}>
      <ChatItems items={items} />
    </div>
  );
}

export function Chat({ detail, streaming, activity, framed, sendRowEnd }: Props) {
  const actions = laneActionsFor(detail);
  const stop = actionOf(actions, "stop");
  const readOnly = detail.lane === "plan" || detail.lane === "build" || detail.lane === "check" || detail.lane === "ship";
  const hint = replyHint(detail);
  const closed = hint !== null;
  // A tool's line wins; otherwise a running turn with no text streaming and no question waiting is thinking.
  const line = activity ?? (detail.turnRunning && !streaming && !detail.pending ? WORKING : null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
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
    const pending = detail.pending?.id;
    const before = seenRef.current;
    seenRef.current = { chat: detail.chat.length, streaming, pending };
    if (before === null || followRef.current) {
      followRef.current = true;
      toBottom();
      return;
    }
    const added =
      detail.chat.length > before.chat ||
      (streaming !== "" && streaming !== before.streaming) ||
      (pending !== undefined && pending !== before.pending);
    if (added) setUnseen(true);
  }, [detail.chat.length, streaming, detail.pending?.id, line]);

  // The log's own box changes size when the window does, or when the footer grows (a hint, Stop, an error line, a
  // taller reply box). No scroll event says so, so keep the log at its bottom here if it was there.
  useEffect(() => {
    const log = logRef.current;
    if (!log || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (followRef.current) toBottom();
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

  async function send() {
    const body = text.trim();
    if (!body) return;
    setError(null);
    try {
      await api.sendMessage(detail.id, { text: body });
      setText("");
      jumpToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the message.");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!closed) void send();
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className={styles.chat} data-framed={framed || undefined}>
      <div className={styles.logBox}>
        <div className={styles.log} role="log" aria-live="polite" ref={logRef} onScroll={onLogScroll}>
          <ChatItems
            items={detail.chat}
            lastActions={errorLineActions(detail.chat, actions)}
            // An error line only carries error actions, and each has its call.
            onAction={(action) => void run(() => LANE_ACTION_CALLS[action.id as LaneActionCall](detail.id))}
          />
          {streaming ? (
            <ChatBubble from={LANE_AUTHOR[detail.lane] ?? "product-owner"} streaming>
              {streaming}
            </ChatBubble>
          ) : null}
          {line ? <p className={styles.activity}>{line}</p> : null}
          {detail.pending ? <PendingCard item={detail.pending} onError={setError} /> : null}
        </div>
        {unseen ? (
          <Button compact className={styles.newMessages} onClick={jumpToBottom}>
            ↓ New messages
          </Button>
        ) : null}
      </div>
      <div className={styles.footer}>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {readOnly ? (
          stop ? (
            <div className={styles.actions}>
              <Button onClick={() => run(() => LANE_ACTION_CALLS.stop(detail.id))}>{stop.label}</Button>
            </div>
          ) : null
        ) : (
          <form
            className={styles.reply}
            onSubmit={(event) => {
              event.preventDefault();
              if (!closed) void send();
            }}
          >
            <label className={styles.label} htmlFor="reply">
              Your reply
            </label>
            <textarea
              id="reply"
              className={styles.input}
              rows={3}
              value={text}
              disabled={closed}
              onKeyDown={onKeyDown}
              onChange={(event) => setText(event.target.value)}
            />
            {hint ? <p className={styles.hint}>{hint}</p> : null}
            <div className={styles.actions}>
              <Button type="submit" variant="primary" disabled={closed || !text.trim()}>
                Send
              </Button>
              {stop ? <Button onClick={() => run(() => LANE_ACTION_CALLS.stop(detail.id))}>{stop.label}</Button> : null}
              {sendRowEnd ? <div className={styles.sendRowEnd}>{sendRowEnd}</div> : null}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
