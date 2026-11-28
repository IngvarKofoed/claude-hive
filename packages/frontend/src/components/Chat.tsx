import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CardDetail, ChatAuthor, ChatItem, Lane, LaneActionId, LaneActionState } from "@hive/shared";
import { api } from "../api/client";
import { LANE_ACTION_CALLS, actionOf, laneActionsFor, useLaneActionDone, type LaneActionCall } from "./laneActions";
import { ChatItems, ChatLog, isAtBottom, type ChatLogHandle } from "./ChatLog";
import { Button } from "./ui/Button";
import styles from "./Chat.module.css";

const LANE_AUTHOR: Partial<Record<Lane, ChatAuthor>> = {
  refine: "product-owner",
  mockup: "designer",
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

/**
 * The lane actions the last chat line offers: those it carries, when it's an error, among the ones on offer. An older
 * error line offers none: the server only acts on the lane's last line.
 */
function errorLineActions(chat: ChatItem[], actions: LaneActionState[]): LaneActionState[] {
  const last = chat.at(-1);
  if (last?.kind !== "error") return [];
  return actions.filter((action) => last.actions.some((id) => id === action.id));
}

/**
 * A finished lane's chat, looked back at: only what was said, with nothing to type into or press
 * (docs/specs/2026-11-27-card-lane-artifacts.md).
 */
export function PastChat({ items }: { items: ChatItem[] }) {
  if (items.length === 0) return <p className={styles.empty}>No chat in this lane.</p>;
  return (
    <div className={styles.past}>
      <ChatItems items={items} />
    </div>
  );
}

export { isAtBottom };

export function Chat({ detail, streaming, activity, framed, sendRowEnd }: Props) {
  const actions = laneActionsFor(detail);
  const stop = actionOf(actions, "stop");
  const laneActionDone = useLaneActionDone();
  const readOnly = detail.lane === "plan" || detail.lane === "build" || detail.lane === "check" || detail.lane === "ship";
  const hint = replyHint(detail);
  const closed = hint !== null;
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<ChatLogHandle>(null);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setError(null);
    try {
      await api.sendMessage(detail.id, { text: body });
      setText("");
      logRef.current?.jumpToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the message.");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!closed) void send();
  }

  /** Run a call; a lane action's `id` is reported once the call succeeds. */
  async function run(action: () => Promise<unknown>, id?: LaneActionId) {
    setError(null);
    try {
      await action();
      if (id) laneActionDone(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className={styles.chat} data-framed={framed || undefined}>
      <ChatLog
        ref={logRef}
        framed={framed}
        items={detail.chat}
        streaming={streaming}
        streamingFrom={LANE_AUTHOR[detail.lane] ?? "product-owner"}
        activity={activity}
        turnRunning={detail.turnRunning}
        pending={detail.pending}
        onError={setError}
        lastActions={errorLineActions(detail.chat, actions)}
        // An error line only carries error actions, and each has its call.
        onAction={(action) => void run(() => LANE_ACTION_CALLS[action.id as LaneActionCall](detail.id), action.id)}
      />
      <div className={styles.footer}>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {readOnly ? (
          stop ? (
            <div className={styles.actions}>
              <Button onClick={() => run(() => LANE_ACTION_CALLS.stop(detail.id), "stop")}>{stop.label}</Button>
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
              {stop ? <Button onClick={() => run(() => LANE_ACTION_CALLS.stop(detail.id), "stop")}>{stop.label}</Button> : null}
              {sendRowEnd ? <div className={styles.sendRowEnd}>{sendRowEnd}</div> : null}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
