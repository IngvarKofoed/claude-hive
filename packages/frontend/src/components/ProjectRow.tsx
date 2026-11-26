import { useState, type DragEvent } from "react";
import { LANES, type BoardResponse, type CardSummary, type Lane, type ProjectSummary } from "@hive/shared";
import { api } from "../api/client";
import { CardTile } from "./CardTile";
import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";
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
  onAddIdea: (projectId: string, text: string) => Promise<void>;
  onBoard: (board: BoardResponse) => void;
}

export function ProjectRow({
  project,
  cards,
  dragging,
  onDragStart,
  onDragEnd,
  onDrop,
  onOpen,
  onAddIdea,
  onBoard,
}: Props) {
  const [idea, setIdea] = useState("");
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  async function addIdea() {
    const text = idea.trim();
    if (!text) return;
    setIdeaError(null);
    try {
      await onAddIdea(project.id, text);
      setIdea("");
    } catch (err) {
      setIdeaError(err instanceof Error ? err.message : "Could not add the idea.");
    }
  }

  async function checkAgain() {
    setCheckError(null);
    try {
      onBoard(await api.checkProject(project.id));
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Could not check the folder.");
    }
  }

  const canDropOn = (lane: Lane) => lane === "refine" && dragging !== null && dragging.projectId === project.id;

  return (
    <div className={styles.row}>
      <div className={styles.project}>
        <h2 className={styles.name}>{project.name}</h2>
        <p className={styles.path}>{project.path}</p>
        {project.trustWarning ? (
          <Panel tone="warning" className={styles.warning} role="alert">
            <p>
              Claude Code doesn't trust this folder, so its CLAUDE.md isn't loaded. Open Claude Code in the repo
              once and accept.
            </p>
            <Button compact onClick={checkAgain}>
              Check again
            </Button>
            {checkError ? <p>{checkError}</p> : null}
          </Panel>
        ) : null}
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
              <CardTile key={card.id} card={card} onOpen={onOpen} onDragStart={onDragStart} onDragEnd={onDragEnd} />
            ))}
            {lane.id === "ideas" ? (
              <form
                className={styles.idea}
                onSubmit={(event) => {
                  event.preventDefault();
                  void addIdea();
                }}
              >
                <input
                  className={styles.input}
                  type="text"
                  aria-label={`Add an idea to ${project.name}`}
                  placeholder="Add an idea"
                  value={idea}
                  onChange={(event) => setIdea(event.target.value)}
                />
                {ideaError ? (
                  <p className={styles.error} role="alert">
                    {ideaError}
                  </p>
                ) : null}
              </form>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
