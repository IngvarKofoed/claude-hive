import { useState } from "react";
import type { PendingItem } from "@hive/shared";
import { api } from "../api/client";
import { buildAnswers, isComplete, togglePick, type QuestionInput } from "./answers";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import styles from "./PendingCard.module.css";

type QuestionItem = Extract<PendingItem, { kind: "question" }>;
type PermissionItem = Extract<PendingItem, { kind: "permission" }>;

function QuestionCard({ item, onError }: { item: QuestionItem; onError: (message: string) => void }) {
  const [input, setInput] = useState<QuestionInput>({ picks: {}, free: {} });
  const [sending, setSending] = useState(false);
  const answers = buildAnswers(item.questions, input);
  const complete = isComplete(item.questions, answers);

  async function send() {
    setSending(true);
    try {
      await api.answer(item.id, { answers });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not send the answer.");
      setSending(false);
    }
  }

  return (
    <div className={styles.card}>
      {item.questions.map((q) => {
        const picks = input.picks[q.question] ?? [];
        return (
          <fieldset key={q.question} className={styles.question}>
            <legend className={styles.legend}>
              <Chip>{q.header}</Chip>
              <span className={styles.text}>{q.question}</span>
            </legend>
            {q.multiSelect ? <p className={styles.hint}>Pick any that apply.</p> : null}
            <div className={styles.options}>
              {q.options.map((option) => (
                <Button
                  key={option.label}
                  compact
                  aria-pressed={picks.includes(option.label)}
                  title={option.description || undefined}
                  onClick={() =>
                    setInput((prev) => ({
                      ...prev,
                      picks: {
                        ...prev.picks,
                        [q.question]: togglePick(prev.picks[q.question] ?? [], option.label, q.multiSelect),
                      },
                    }))
                  }
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {q.options.some((o) => o.description) ? (
              <ul className={styles.descriptions}>
                {q.options
                  .filter((o) => o.description)
                  .map((o) => (
                    <li key={o.label}>
                      <strong>{o.label}:</strong> {o.description}
                    </li>
                  ))}
              </ul>
            ) : null}
            <input
              className={styles.free}
              type="text"
              aria-label={`Your own words for: ${q.question}`}
              placeholder="Or answer in your own words"
              value={input.free[q.question] ?? ""}
              onChange={(event) =>
                setInput((prev) => ({ ...prev, free: { ...prev.free, [q.question]: event.target.value } }))
              }
            />
          </fieldset>
        );
      })}
      <Button variant="primary" disabled={!complete || sending} onClick={send}>
        Send
      </Button>
    </div>
  );
}

function PermissionCard({ item, onError }: { item: PermissionItem; onError: (message: string) => void }) {
  const [sending, setSending] = useState(false);

  async function decide(allow: boolean) {
    setSending(true);
    try {
      await api.answer(item.id, { allow });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not send the answer.");
      setSending(false);
    }
  }

  return (
    <div className={styles.card}>
      <p className={styles.text}>
        Allow <Chip mono>{item.toolName}</Chip>?
      </p>
      <p className={styles.detail}>{item.detail}</p>
      <div className={styles.options}>
        <Button variant="primary" disabled={sending} onClick={() => decide(true)}>
          Allow
        </Button>
        <Button disabled={sending} onClick={() => decide(false)}>
          Deny
        </Button>
      </div>
    </div>
  );
}

export function PendingCard({ item, onError }: { item: PendingItem; onError: (message: string) => void }) {
  // Keyed by id so a new item starts with fresh picks.
  return item.kind === "question" ? (
    <QuestionCard key={item.id} item={item} onError={onError} />
  ) : (
    <PermissionCard key={item.id} item={item} onError={onError} />
  );
}
