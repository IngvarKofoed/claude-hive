import type { DragEvent } from "react";
import { LANES, type BoardResponse, type CardSummary, type Lane, type ProjectSummary } from "@hive/shared";
import { AddIdea } from "./AddIdea";
import { CardTile } from "./CardTile";
import { ProjectHeading } from "./ProjectHeading";
import styles from "./ProjectRow.module.css";

interface Props {
  project: ProjectSummary;
  cards: CardSummary[];
  /** The card being dragged, if any. */
  dragging: CardSummary | null;
  onDragStart: (card: CardSummary, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDrop: (card: CardSummary, lane: Lane) => void;
  onOpen: (card: CardSummary) => void;
  /** Start an idea: the same move to Refine as dropping it there. */
  onStart: (card: CardSummary) => Promise<void>;
  /** A card was deleted from its tile. */
  onDeleted?: (card: CardSummary) => void;
  onBoard: (board: BoardResponse) => void;
}

/** One project's row on the Board By lane: its heading, then a cell per lane. */
export function ProjectRow({
  project,
  cards,
  dragging,
  onDragStart,
  onDragEnd,
  onDrop,
  onOpen,
  onStart,
  onBoard,
  onDeleted,
}: Props) {
  const canDropOn = (lane: Lane) => lane === "refine" && dragging !== null && dragging.projectId === project.id;

  return (
    <div className={styles.row}>
      <div className={styles.project}>
        <ProjectHeading project={project} onBoard={onBoard} />
      </div>
      {LANES.map((lane) => {
        const laneCards = cards.filter((card) => card.lane === lane.id);
        return (
          <div
            key={lane.id}
            className={styles.cell}
            data-hands-off={!lane.withYou || undefined}
            data-droppable={canDropOn(lane.id) || undefined}
            aria-label={`${project.name}, ${lane.name}`}
            role="group"
            onDragOver={(event) => {
              if (canDropOn(lane.id)) event.preventDefault();
            }}
            onDrop={(event) => {
              if (!canDropOn(lane.id) || !dragging) return;
              event.preventDefault();
              onDrop(dragging, lane.id);
            }}
          >
            {laneCards.map((card) => (
              <CardTile
                key={card.id}
                card={card}
                onOpen={onOpen}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDeleted={onDeleted}
                onStart={onStart}
              />
            ))}
            {lane.id === "ideas" ? <AddIdea project={project} /> : null}
          </div>
        );
      })}
    </div>
  );
}
