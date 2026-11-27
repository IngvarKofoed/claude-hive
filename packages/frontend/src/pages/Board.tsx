import { useCallback, useEffect, useState, type DragEvent } from "react";
import { useNavigate } from "react-router";
import { LANES, type BoardResponse, type CardSummary, type Lane, type ProjectSummary } from "@hive/shared";
import { api } from "../api/client";
import { useHiveEvents, useStreamOpen } from "../api/events";
import { boardSummary } from "../components/cardBadge";
import { Header } from "../components/Header";
import { ProjectPanel } from "../components/ProjectPanel";
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

type Layout = "lane" | "project";

/** Where this browser remembers the layout: a view preference for the one person at it. */
export const LAYOUT_KEY = "hive.boardLayout";

// Storage can be missing or refuse (a private window, blocked site data): then the board opens By lane, and the
// switch still works for the visit.
function readLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "project" ? "project" : "lane";
  } catch {
    return "lane";
  }
}

function storeLayout(layout: Layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // Remembered for this visit only.
  }
}

type BandTone = "you" | "you-plain" | "hands-off";

/**
 * The bands over By lane's headers, saying which lanes are yours and which run hands off. They're the board's wording,
 * not lane data: `withYou` can't tell Ideas' "you" from Refine to Spec's "with you". Together they cover every lane,
 * in order (checked in Board.test.tsx).
 */
export const PHASE_BANDS: { label: string; lanes: Lane[]; tone?: BandTone }[] = [
  { label: "you", lanes: ["ideas"], tone: "you-plain" },
  { label: "with you", lanes: ["refine", "mockup", "spec"], tone: "you" },
  { label: "hands off", lanes: ["plan", "build", "check"], tone: "hands-off" },
  { label: "you", lanes: ["tryit"], tone: "you" },
  { label: "hands off", lanes: ["ship"], tone: "hands-off" },
  { label: "", lanes: ["done"] },
];

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
  const [layout, setLayout] = useState<Layout>(readLayout);

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

  function chooseLayout(next: Layout) {
    setLayout(next);
    storeLayout(next);
  }

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

  // A drop on Refine and Start make the same move, so a failure shows the same way: in the error line above the
  // board, and on the tile when the backend stored a move error.
  async function moveCard(card: CardSummary, lane: Lane) {
    setDragging(null);
    setMoveError(null);
    try {
      const moved = await api.moveCard(card.id, { lane });
      if (looksLike<CardSummary>(moved)) setCards((prev) => upsert(prev, moved));
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : "Could not move the card.");
    }
  }

  const startIdea = (card: CardSummary) => moveCard(card, "refine");
  const removeCard = (card: CardSummary) => setCards((prev) => prev.filter((c) => c.id !== card.id));
  const openCard = (card: CardSummary) => navigate(`/cards/${card.id}`);

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
          <div className={styles.heading}>
            <div>
              <h1 className={styles.title}>Board</h1>
              {projects.length > 0 ? <p className={styles.summary}>{boardSummary(projects.length, cards)}</p> : null}
            </div>
            <div className={styles.switch} role="group" aria-label="Board layout">
              <Button aria-pressed={layout === "lane"} onClick={() => chooseLayout("lane")}>
                By lane
              </Button>
              <Button aria-pressed={layout === "project"} onClick={() => chooseLayout("project")}>
                By project
              </Button>
            </div>
          </div>
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

        {layout === "lane" ? (
          <div className={styles.scroll}>
            <div className={styles.grid}>
              <div className={styles.bandRow}>
                <div />
                {PHASE_BANDS.map((band) => (
                  <div key={band.lanes[0]} className={styles.bandCell} data-span={band.lanes.length}>
                    {band.label ? (
                      <span className={styles.band} data-tone={band.tone}>
                        {band.label}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
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
                  onDrop={moveCard}
                  onOpen={openCard}
                  onAddIdea={addIdea}
                  onStart={startIdea}
                  onBoard={applyBoard}
                  onDeleted={removeCard}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.panels}>
            {projects.map((project) => (
              <ProjectPanel
                key={project.id}
                project={project}
                cards={cards.filter((card) => card.projectId === project.id)}
                onOpen={openCard}
                onAddIdea={addIdea}
                onStart={startIdea}
                onBoard={applyBoard}
                onDeleted={removeCard}
              />
            ))}
          </div>
        )}
        {loaded && projects.length === 0 && !loadError ? (
          <p className={styles.empty}>No projects yet. Add a git repository by its path to start.</p>
        ) : null}
      </main>
    </>
  );
}
