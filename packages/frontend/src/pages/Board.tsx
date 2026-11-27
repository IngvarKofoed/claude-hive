import { useCallback, useEffect, useState, type DragEvent } from "react";
import { useNavigate } from "react-router";
import { LANES, type BoardResponse, type CardSummary, type Lane, type ProjectSummary } from "@hive/shared";
import { api } from "../api/client";
import { useHiveEvents, useStreamOpen } from "../api/events";
import { Header } from "../components/Header";
import { ProjectRow } from "../components/ProjectRow";
import { Button } from "../components/ui/Button";
import styles from "./Board.module.css";

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((x) => x.id === item.id);
  if (index === -1) return [...list, item];
  const next = list.slice();
  next[index] = item;
  return next;
}

function looksLike<T extends { id: string }>(value: unknown): value is T {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

export function Board() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<CardSummary | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [projectError, setProjectError] = useState<string | null>(null);

  const applyBoard = useCallback((board: BoardResponse) => {
    setProjects(board.projects);
    setCards(board.cards);
  }, []);

  const load = useCallback(async () => {
    try {
      applyBoard(await api.board());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load the board.");
    } finally {
      setLoaded(true);
    }
  }, [applyBoard]);

  useEffect(() => {
    void load();
  }, [load]);

  useHiveEvents((event) => {
    if (event.type === "project.updated") setProjects((prev) => upsert(prev, event.project));
    else if (event.type === "card.updated") setCards((prev) => upsert(prev, event.card));
    else if (event.type === "card.deleted") setCards((prev) => prev.filter((card) => card.id !== event.cardId));
  });

  // Refetch whatever changed while the stream was down.
  useStreamOpen(() => void load());

  async function addProject() {
    const value = path.trim();
    if (!value) return;
    setProjectError(null);
    try {
      applyBoard(await api.addProject({ path: value }));
      setPath("");
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : "Could not add the project.");
    }
  }

  async function addIdea(projectId: string, text: string) {
    const card = await api.newCard({ projectId, text });
    if (looksLike<CardSummary>(card)) setCards((prev) => upsert(prev, card));
  }

  async function dropCard(card: CardSummary, lane: Lane) {
    setDragging(null);
    setMoveError(null);
    try {
      const moved = await api.moveCard(card.id, { lane });
      if (looksLike<CardSummary>(moved)) setCards((prev) => upsert(prev, moved));
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : "Could not move the card.");
    }
  }

  function startDrag(card: CardSummary, event: DragEvent<HTMLElement>) {
    event.dataTransfer.setData("text/plain", card.id);
    event.dataTransfer.effectAllowed = "move";
    setDragging(card);
  }

  return (
    <>
      <Header />
      <main className={styles.main}>
        <div className={styles.toolbar}>
          <h1 className={styles.title}>Board</h1>
          <form
            className={styles.addProject}
            onSubmit={(event) => {
              event.preventDefault();
              void addProject();
            }}
          >
            <label className={styles.label} htmlFor="project-path">
              Project path
            </label>
            <input
              id="project-path"
              className={styles.input}
              type="text"
              placeholder="/path/to/your/repo"
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
            <Button type="submit" variant="primary" disabled={!path.trim()}>
              Add project
            </Button>
          </form>
        </div>
        {projectError ? (
          <p className={styles.error} role="alert">
            {projectError}
          </p>
        ) : null}
        {moveError ? (
          <p className={styles.error} role="alert">
            {moveError}
          </p>
        ) : null}
        {loadError ? (
          <p className={styles.error} role="alert">
            {loadError}
          </p>
        ) : null}

        <div className={styles.scroll}>
          <div className={styles.grid}>
            <div className={styles.headRow}>
              <div className={styles.headCell}>Projects</div>
              {LANES.map((lane) => (
                <div key={lane.id} className={styles.headCell} data-hands-off={!lane.withYou || undefined}>
                  <span className={styles.laneName}>{lane.name}</span>
                  {lane.who ? <span className={styles.who}>{lane.who}</span> : null}
                  {lane.limit !== null ? <span className={styles.limit}>limit {lane.limit}</span> : null}
                </div>
              ))}
            </div>
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                cards={cards.filter((card) => card.projectId === project.id)}
                dragging={dragging}
                onDragStart={startDrag}
                onDragEnd={() => setDragging(null)}
                onDrop={dropCard}
                onOpen={(card) => navigate(`/cards/${card.id}`)}
                onAddIdea={addIdea}
                onBoard={applyBoard}
                onDeleted={(card) => setCards((prev) => prev.filter((c) => c.id !== card.id))}
              />
            ))}
          </div>
        </div>
        {loaded && projects.length === 0 && !loadError ? (
          <p className={styles.empty}>No projects yet. Add a git repository by its path to start.</p>
        ) : null}
      </main>
    </>
  );
}
