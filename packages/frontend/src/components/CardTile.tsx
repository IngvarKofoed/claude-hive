import { useEffect, useState, type DragEvent } from "react";
import { LANES, type CardSummary } from "@hive/shared";
import { api } from "../api/client";
import { cardBadge } from "./cardBadge";
import { deleteQuestion } from "./deleteText";
import { LaneSteps } from "./LaneSteps";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import styles from "./CardTile.module.css";

interface Props {
  card: CardSummary;
  onOpen?: (card: CardSummary) => void;
  /** Given only where an idea can be dropped on Refine (By lane): without it, no tile is draggable. */
  onDragStart?: (card: CardSummary, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  /** The card was deleted from this tile. */
  onDeleted?: (card: CardSummary) => void;
  /** Show the lane's name and strip, where no column names the lane (By project). */
  showLane?: boolean;
  /** Start an idea: the same move to Refine as the drag. Shown on ideas only. */
  onStart?: (card: CardSummary) => Promise<void>;
}

export function CardTile({ card, onOpen, onDragStart, onDragEnd, onDeleted, showLane = false, onStart }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const draggable = card.lane === "ideas" && !confirming && onDragStart !== undefined;
  const openable = card.lane !== "ideas";
  const startable = card.lane === "ideas" && onStart !== undefined;
  const badge = cardBadge(card);
  const laneName = LANES.find((lane) => lane.id === card.lane)?.name ?? card.lane;

  async function start() {
    if (!onStart) return;
    setStarting(true);
    try {
      await onStart(card);
    } finally {
      setStarting(false);
    }
  }

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
      {showLane ? (
        <div className={styles.lane}>
          <span className={styles.laneName}>{laneName}</span>
          <LaneSteps current={card.lane} compact />
        </div>
      ) : null}
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
          {/* Start sits at the left and Delete at the far right, so aiming for one doesn't hit the other. */}
          {startable ? (
            <Button compact variant="primary" disabled={starting} onClick={() => void start()}>
              Start
            </Button>
          ) : null}
          {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
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
