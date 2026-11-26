import { useEffect, useRef, useState } from "react";
import type { CardDetail } from "@hive/shared";
import { api } from "../api/client";
import { PendingCard } from "./PendingCard";
import { Button } from "./ui/Button";
import { ChatBubble } from "./ui/ChatBubble";
import styles from "./Chat.module.css";

interface Props {
  detail: CardDetail;
  streaming: string;
  activity: string | null;
}

export function Chat({ detail, streaming, activity }: Props) {
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
              {item.retryable ? (
                <Button compact onClick={() => run(() => api.retry(detail.id))}>
                  Retry
                </Button>
              ) : null}
            </ChatBubble>
          ),
        )}
        {streaming ? (
          <ChatBubble from="product-owner" streaming>
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
      <form
        className={styles.reply}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
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
          onChange={(event) => setText(event.target.value)}
        />
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={!text.trim()}>
            Send
          </Button>
          {detail.turnRunning ? <Button onClick={() => run(() => api.stop(detail.id))}>Stop</Button> : null}
        </div>
      </form>
    </div>
  );
}
