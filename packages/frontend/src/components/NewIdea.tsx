import { useEffect, useId, useRef, useState } from "react";
import type { ProjectSummary } from "@hive/shared";
import { api } from "../api/client";
import { Button } from "./ui/Button";
import styles from "./NewIdea.module.css";

/**
 * New idea in the header: a button and the small form under it (docs/specs/2026-11-27-board-by-project.md). The
 * projects load when the form opens; the board shows the new card through its own live events.
 */
export function NewIdea() {
  const formId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLSelectElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setProjects(null);
    setLoadError(null);
    api
      .board()
      .then((board) => {
        if (!current) return;
        setProjects(board.projects);
        setProjectId(board.projects.length === 1 ? (board.projects[0]?.id ?? "") : "");
      })
      .catch((err) => {
        if (current) setLoadError(err instanceof Error ? err.message : "Could not load the projects.");
      });
    return () => {
      current = false;
    };
  }, [open]);

  // Focus moves into the form once its fields exist.
  const count = projects?.length ?? 0;
  useEffect(() => {
    if (!open || count === 0) return;
    (count > 1 ? projectRef.current : textRef.current)?.focus();
  }, [open, count]);

  function hide() {
    setOpen(false);
    setError(null);
    wrapRef.current?.querySelector("button")?.focus();
  }

  // While an Add runs the form stays open: closing it then would let the late answer close a reopened form and wipe
  // its text, or leave an error behind for the next open.
  function close() {
    if (!adding) hide();
  }

  async function add() {
    setAdding(true);
    setError(null);
    try {
      await api.newCard({ projectId, text: text.trim() });
      setText("");
      hide();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the idea.");
    } finally {
      setAdding(false);
    }
  }

  const canAdd = projectId !== "" && text.trim() !== "" && !adding;

  return (
    <div
      ref={wrapRef}
      className={styles.wrap}
      // Escape closes the form from anywhere in it, the button included, even before the projects have loaded.
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        // Handled here only: an open Delete question listens for Escape on the window, and must stay open.
        event.stopPropagation();
        close();
      }}
    >
      <Button
        variant="primary"
        aria-expanded={open}
        aria-controls={open ? formId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        New idea
      </Button>
      {open && (
        <form
          id={formId}
          className={styles.form}
          aria-label="New idea"
          onSubmit={(event) => {
            event.preventDefault();
            if (canAdd) void add();
          }}
        >
          {loadError && (
            <p className={styles.error} role="alert">
              {loadError}
            </p>
          )}
          {!loadError && projects === null && <p className={styles.note}>Loading projects…</p>}
          {projects !== null && count === 0 && (
            <p className={styles.note}>There are no projects yet. Add one on the Board first.</p>
          )}
          {projects !== null && count > 0 && (
            <>
              <label className={styles.field}>
                Project
                <select
                  ref={projectRef}
                  className={styles.control}
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  {count > 1 && <option value="">Choose a project</option>}
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Idea
                <textarea
                  ref={textRef}
                  className={styles.control}
                  rows={3}
                  placeholder="Two sentences is enough."
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
            </>
          )}
          <div className={styles.actions}>
            {projects !== null && count > 0 && (
              <Button type="submit" variant="primary" compact disabled={!canAdd}>
                Add
              </Button>
            )}
            <Button compact disabled={adding} onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
