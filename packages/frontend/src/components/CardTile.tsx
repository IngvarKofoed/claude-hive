import { useEffect, useState, type DragEvent } from "react";
import { laneImplemented, type CardSummary } from "@hive/shared";
import { api } from "../api/client";
import { deleteQuestion } from "./deleteText";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import styles from "./CardTile.module.css";

interface Props {
  card: CardSummary;
  onOpen?: (card: CardSummary) => void;
  onDragStart?: (card: CardSummary, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  /** The card was deleted from this tile. */
  onDeleted?: (card: CardSummary) => void;
}

export function CardTile({ card, onOpen, onDragStart, onDragEnd, onDeleted }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const draggable = card.lane === "ideas" && !confirming;
  const openable = card.lane !== "ideas";
  // A landed card needs nothing from you.
  const badge = card.lane === "done" ? null : !laneImplemented(card.lane) ? (
    <Badge tone="neutral">Not implemented yet</Badge>
  ) : card.state === "working" ? (
      <Badge tone="working">▶ working</Badge>
    ) : (
      <Badge tone="needs-you">● needs you</Badge>
    );

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteCard(card.id);
      onDeleted?.(card);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete the card.");
      setDeleting(false);
    }
  }

  // Escape closes the question with nothing done, wherever the focus is.
  useEffect(() => {
    if (!confirming || deleting) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setConfirming(false);
      setDeleteError(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, deleting]);

  return (
    <article
      className={styles.tile}
      data-openable={openable || undefined}
      data-draggable={draggable || undefined}
      draggable={draggable}
      onDragStart={draggable ? (event) => onDragStart?.(card, event) : undefined}
      onDragEnd={draggable ? () => onDragEnd?.() : undefined}
    >
      {openable ? (
        <button type="button" className={styles.title} onClick={() => onOpen?.(card)}>
          {card.title}
        </button>
      ) : (
        <p className={styles.title}>{card.title}</p>
      )}
      {confirming ? (
        <div className={styles.confirm} role="group" aria-label="Delete this card">
          <p className={styles.question}>{deleteQuestion(card, "tile")}</p>
          <div className={styles.actions}>
            <Button compact variant="primary" disabled={deleting} onClick={() => void remove()}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
            <Button compact disabled={deleting} onClick={() => { setConfirming(false); setDeleteError(null); }}>
              Cancel
            </Button>
          </div>
          {deleteError ? (
            <p className={styles.error} role="alert">
              {deleteError}
            </p>
          ) : null}
        </div>
      ) : (
        <div className={styles.meta}>
          {badge}
          <button type="button" className={styles.delete} onClick={() => setConfirming(true)}>
            Delete
          </button>
        </div>
      )}
      {card.moveError ? (
        <p className={styles.error} role="alert">
          {card.moveError}
        </p>
      ) : null}
    </article>
  );
}
