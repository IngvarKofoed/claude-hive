import { useEffect, useId, useRef, useState } from "react";
import styles from "./CardTitle.module.css";

interface Props {
  title: string;
  projectName: string;
  branch: string | null;
  worktreePath: string | null;
}

const COPY = "Click to copy the path";
const RESET_MS = 2000;

/**
 * The card page's title. Its project, branch and worktree path sit in a hover card that also opens on keyboard focus,
 * and with a worktree the title itself copies the path (docs/specs/2026-11-28-more-room-for-the-card-page-s-columns.md).
 */
export function CardTitle({ title, projectName, branch, worktreePath }: Props) {
  const id = useId();
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    if (worktreePath === null) return;
    let next: "copied" | "failed" = "copied";
    try {
      await navigator.clipboard.writeText(worktreePath);
    } catch {
      next = "failed";
    }
    setResult(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult(null), RESET_MS);
  }

  const status = result === "copied" ? "Copied" : result === "failed" ? "Couldn't copy the path" : COPY;

  return (
    <div className={styles.wrap}>
      {worktreePath !== null ? (
        <h1 className={styles.title}>
          <button type="button" className={styles.button} aria-describedby={id} onClick={() => void copy()}>
            {title}
          </button>
        </h1>
      ) : (
        <h1 className={styles.title} aria-describedby={id}>
          {title}
        </h1>
      )}
      <div className={styles.box} role="tooltip" id={id} data-copied={result !== null ? "" : undefined}>
        <div className={styles.card}>
          <p>{projectName}</p>
          {branch !== null ? <p className={styles.mono}>{branch}</p> : null}
          {worktreePath !== null ? <p className={`${styles.mono} ${styles.path}`}>{worktreePath}</p> : null}
          {worktreePath !== null ? (
            <p className={styles.status} role="status">
              {status}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
