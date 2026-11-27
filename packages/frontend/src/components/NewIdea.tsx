import { useEffect, useId, useRef, useState } from "react";
import type { ProjectSummary } from "@hive/shared";
import { api } from "../api/client";
import { useNewIdea } from "./newIdeaContext";
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
  const titleRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const { open, preset, openNewIdea, closeNewIdea } = useNewIdea();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presetRef = useRef(preset);
  presetRef.current = preset;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  // What the board's field passes in replaces the form's project and title. An empty title is no title, so a field
  // pressed with nothing typed doesn't wipe one already typed here. Typed text is never touched. Only a preset made
  // while this form is mounted counts: one from before was for the previous page's form, and can still be there when
  // this one mounts, before that form's close has rendered.
  const appliedNonce = useRef(preset.nonce);
  useEffect(() => {
    if (preset.nonce === appliedNonce.current) return;
    appliedNonce.current = preset.nonce;
    if (preset.projectId) setProjectId(preset.projectId);
    if (preset.title) setTitle(preset.title);
  }, [preset]);

  // Every page has its own header, so leaving a page closes the form, as it did before the provider held it open.
  useEffect(() => closeNewIdea, [closeNewIdea]);

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
        // A project passed in (or chosen before) stays; the only project is chosen when none was.
        setProjectId((chosen) =>
          chosen !== "" && board.projects.some((p) => p.id === chosen)
            ? chosen
            : board.projects.length === 1
              ? (board.projects[0]?.id ?? "")
              : "",
        );
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
    // The preset's project counts as chosen: its setProjectId hasn't rendered yet when this runs in the same commit.
    const chosen = !!presetRef.current.projectId || projectIdRef.current !== "" || count === 1;
    const target = !chosen ? projectRef.current : presetRef.current.title ? textRef.current : titleRef.current;
    target?.focus();
  }, [open, count, preset]);

  function hide() {
    closeNewIdea();
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
      await api.newCard({ projectId, title: title.trim(), text: text.trim() });
      setTitle("");
      setText("");
      hide();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the idea.");
    } finally {
      setAdding(false);
    }
  }

  const canAdd = projectId !== "" && title.trim() !== "" && text.trim() !== "" && !adding;

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
        onClick={() => (open ? close() : openNewIdea())}
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
                Title
                <input
                  ref={titleRef}
                  type="text"
                  className={styles.control}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
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
