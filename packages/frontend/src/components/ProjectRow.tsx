import { useId, useState, type DragEvent } from "react";
import { LANES, type BoardResponse, type CardSummary, type Lane, type ProjectChatSummary, type ProjectSummary } from "@hive/shared";
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
  /** The project's chats, for its heading's Chat button. */
  chats?: ProjectChatSummary[];
  /** Open a path: the Chat button's page. */
  onChat?: (path: string) => void;
  /** Board's Compact By lane: smaller tiles, and Done as a count that opens the landed cards under the row. */
  compact?: boolean;
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
  chats,
  onChat,
  compact = false,
}: Props) {
  const [landedOpen, setLandedOpen] = useState(false);
  const stripId = useId();
  const landed = cards.filter((card) => card.lane === "done");
  const showStrip = compact && landedOpen && landed.length > 0;
  const canDropOn = (lane: Lane) => lane === "refine" && dragging !== null && dragging.projectId === project.id;

  return (
    <div className={styles.row} data-compact={compact || undefined} data-landed-open={showStrip || undefined}>
      <div className={styles.project}>
        <ProjectHeading project={project} onBoard={onBoard} compact={compact} chats={chats} onChat={onChat} />
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
            {compact && lane.id === "done" ? (
              landed.length > 0 ? (
                <button
                  type="button"
                  className={styles.landedToggle}
                  aria-label={`${landed.length} landed`}
                  aria-expanded={landedOpen}
                  aria-controls={stripId}
                  onClick={() => setLandedOpen((open) => !open)}
                >
                  <span className={styles.landedCount}>{landed.length}</span>
                  <span>
                    landed <span aria-hidden="true">{landedOpen ? "▾" : "▸"}</span>
                  </span>
                </button>
              ) : null
            ) : (
              laneCards.map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  compact={compact}
                  onOpen={onOpen}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onDeleted={onDeleted}
                  onStart={onStart}
                />
              ))
            )}
            {lane.id === "ideas" ? <AddIdea project={project} /> : null}
          </div>
        );
      })}
      {showStrip ? (
        <div id={stripId} role="group" aria-label={`${project.name}, landed`} className={styles.landed}>
          {landed.map((card) => (
            <CardTile key={card.id} card={card} compact onOpen={onOpen} onDeleted={onDeleted} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
