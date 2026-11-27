import { useState } from "react";
import { LANES, type BoardResponse, type CardSummary, type ProjectSummary } from "@hive/shared";
import { AddIdea } from "./AddIdea";
import { CardTile } from "./CardTile";
import { inProgress } from "./cardBadge";
import { ProjectHeading } from "./ProjectHeading";
import { Panel } from "./ui/Panel";
import styles from "./ProjectPanel.module.css";

interface Props {
  project: ProjectSummary;
  cards: CardSummary[];
  onOpen: (card: CardSummary) => void;
  /** Start an idea: the move to Refine. There's no Refine column to drop it on here. */
  onStart: (card: CardSummary) => Promise<void>;
  /** A card was deleted from its tile. */
  onDeleted?: (card: CardSummary) => void;
  onBoard: (board: BoardResponse) => void;
}

const laneIndex = (card: CardSummary) => LANES.findIndex((lane) => lane.id === card.lane);

/**
 * One project on the Board By project (docs/specs/2026-11-27-board-by-project.md): the cards in progress in lane order,
 * never by state, so a card moves only when it changes lane; then the ideas; then the landed cards, folded.
 */
export function ProjectPanel({ project, cards, onOpen, onStart, onDeleted, onBoard }: Props) {
  const [landedOpen, setLandedOpen] = useState(false);
  // Array.prototype.sort is stable, so cards in one lane keep the board's order: oldest first.
  const going = cards.filter(inProgress).sort((a, b) => laneIndex(a) - laneIndex(b));
  const ideas = cards.filter((card) => card.lane === "ideas");
  const landed = cards.filter((card) => card.lane === "done");

  return (
    <Panel className={styles.panel} aria-label={project.name}>
      <ProjectHeading project={project} onBoard={onBoard} />

      {going.length > 0 ? (
        <div className={styles.cards}>
          {going.map((card) => (
            <CardTile key={card.id} card={card} showLane onOpen={onOpen} onDeleted={onDeleted} />
          ))}
        </div>
      ) : null}

      <div className={styles.section}>
        <h3 className={styles.sectionName}>Ideas</h3>
        <AddIdea project={project} />
        {ideas.length > 0 ? (
          <div className={styles.cards}>
            {ideas.map((card) => (
              <CardTile key={card.id} card={card} onOpen={onOpen} onStart={onStart} onDeleted={onDeleted} />
            ))}
          </div>
        ) : null}
      </div>

      {landed.length > 0 ? (
        <div className={styles.landed}>
          <button
            type="button"
            className={styles.landedToggle}
            aria-expanded={landedOpen}
            onClick={() => setLandedOpen((open) => !open)}
          >
            {landed.length} landed <span aria-hidden="true">{landedOpen ? "▾" : "▸"}</span>
          </button>
          {landedOpen ? (
            <div className={styles.cards}>
              {landed.map((card) => (
                <CardTile key={card.id} card={card} onOpen={onOpen} onDeleted={onDeleted} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
