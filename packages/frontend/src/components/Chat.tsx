import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { CardDetail, ChatAuthor, ErrorAction, Lane } from "@hive/shared";
import { api } from "../api/client";
import { PendingCard } from "./PendingCard";
import { Button } from "./ui/Button";
import { ChatBubble } from "./ui/ChatBubble";
import styles from "./Chat.module.css";

const ERROR_ACTION_LABEL: Record<ErrorAction, string> = {
  retry: "Retry",
  review: "Review again",
  "back-to-spec": "Back to Spec",
  "back-to-build": "Back to Build",
  "move-on": "Move on",
};

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
}

export function Chat({ detail, streaming, activity }: Props) {
  const readOnly = detail.lane === "plan" || detail.lane === "build" || detail.lane === "check";
  const hint = replyHint(detail);
  const closed = hint !== null;
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [detail.chat.length, streaming, detail.pending?.id]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setError(null);
    try {
      await api.sendMessage(detail.id, { text: body });
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the message.");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!closed) void send();
  }

  const errorActions: Record<ErrorAction, () => Promise<unknown>> = {
    retry: () => api.retry(detail.id),
    review: () => api.review(detail.id),
    "back-to-spec": () => api.backToSpec(detail.id),
    "back-to-build": () => api.backToBuild(detail.id),
    "move-on": () => api.moveOn(detail.id),
  };

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className={styles.chat}>
      <div className={styles.log} role="log" aria-live="polite">
        {detail.chat.map((item) =>
          item.kind === "message" ? (
            <ChatBubble key={item.id} from={item.from}>
              {item.text}
            </ChatBubble>
          ) : (
            <ChatBubble key={item.id} from="error">
              <p>{item.message}</p>
              {item.actions.length > 0 ? (
                <div className={styles.actions}>
                  {item.actions.map((action) => (
                    <Button key={action} compact onClick={() => run(errorActions[action])}>
                      {ERROR_ACTION_LABEL[action]}
                    </Button>
                  ))}
                </div>
              ) : null}
            </ChatBubble>
          ),
        )}
        {streaming ? (
          <ChatBubble from={LANE_AUTHOR[detail.lane] ?? "product-owner"} streaming>
            {streaming}
          </ChatBubble>
        ) : null}
        {activity ? <p className={styles.activity}>{activity}</p> : null}
        {detail.pending ? <PendingCard item={detail.pending} onError={setError} /> : null}
        <div ref={endRef} />
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {readOnly ? (
        detail.turnRunning ? (
          <div className={styles.actions}>
            <Button onClick={() => run(() => api.stop(detail.id))}>Stop</Button>
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
            {detail.turnRunning ? <Button onClick={() => run(() => api.stop(detail.id))}>Stop</Button> : null}
          </div>
        </form>
      )}
    </div>
  );
}
