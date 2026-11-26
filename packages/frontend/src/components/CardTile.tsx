import type { DragEvent } from "react";
import { laneImplemented, type CardSummary } from "@hive/shared";
import { Badge } from "./ui/Badge";
import styles from "./CardTile.module.css";

interface Props {
  card: CardSummary;
  onOpen?: (card: CardSummary) => void;
  onDragStart?: (card: CardSummary, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
}

export function CardTile({ card, onOpen, onDragStart, onDragEnd }: Props) {
  const draggable = card.lane === "ideas";
  const openable = card.lane !== "ideas";
  const badge = !laneImplemented(card.lane) ? (
    <Badge tone="neutral">Not implemented yet</Badge>
  ) : card.state === "working" ? (
      <Badge tone="working">▶ working</Badge>
    ) : (
      <Badge tone="needs-you">● needs you</Badge>
    );

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
      <div className={styles.meta}>{badge}</div>
      {card.moveError ? (
        <p className={styles.error} role="alert">
          {card.moveError}
        </p>
      ) : null}
    </article>
  );
}
