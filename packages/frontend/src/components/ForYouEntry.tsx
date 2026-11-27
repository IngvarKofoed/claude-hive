import { useState } from "react";
import { Link } from "react-router";
import { LANES, type ForYouItem, type ForYouKind } from "@hive/shared";
import { ago } from "./ago";
import { PendingCard } from "./PendingCard";
import styles from "./ForYouEntry.module.css";

const KIND_LABEL: Partial<Record<ForYouKind, string>> = {
  question: "question",
  permission: "permission",
  stuck: "stuck",
  "your-turn": "your turn",
  "sign-off": "sign off",
  "review-again": "review again",
  land: "land on main",
};

export function tagText(item: ForYouItem): string {
  const lane = LANES.find((l) => l.id === item.card.lane)?.name ?? item.card.lane;
  const label = KIND_LABEL[item.kind];
  return label ? `${lane} · ${label}` : lane;
}

function linkLabel(kind: ForYouKind): string {
  if (kind === "your-turn" || kind === "sign-off" || kind === "review-again") return "Open the chat";
  if (kind === "try-it") return "Try it";
  return "Open the card";
}

export function ForYouEntry({ item, nowMs }: { item: ForYouItem; nowMs: number }) {
  // The entry is keyed by card, so it outlives one question: an error counts only for the item it was about.
  const about = item.pending?.id ?? item.kind;
  const [failed, setFailed] = useState<{ about: string; message: string } | null>(null);
  const error = failed?.about === about ? failed.message : null;
  const setError = (message: string) => setFailed({ about, message });
  const answered = item.kind === "question" || item.kind === "permission";
  return (
    <article className={styles.entry} data-kind={item.kind}>
      <div className={styles.top}>
        <span className={styles.tag}>{tagText(item)}</span>
        <span className={styles.title}>
          {item.projectName} · {item.card.title}
        </span>
        <span className={styles.ago}>{ago(item.since, nowMs)}</span>
      </div>
      {/* The form asks the question itself, so the line would only repeat it. */}
      {answered && item.pending ? (
        <PendingCard item={item.pending} onError={setError} />
      ) : (
        <p className={styles.text}>{item.text}</p>
      )}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Link to={`/cards/${item.card.id}`} className={styles.link} data-secondary={answered || undefined}>
          {linkLabel(item.kind)}
        </Link>
      </div>
    </article>
  );
}
