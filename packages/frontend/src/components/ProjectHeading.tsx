import { useState } from "react";
import type { BoardResponse, ProjectSummary } from "@hive/shared";
import { api } from "../api/client";
import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";
import styles from "./ProjectHeading.module.css";

interface Props {
  project: ProjectSummary;
  onBoard: (board: BoardResponse) => void;
  /** Board's Compact By lane: the path on one line, cut short, with the full path as its title. */
  compact?: boolean;
}

/** A project's name and path, and the trust warning when its folder isn't trusted. Both board layouts use it. */
export function ProjectHeading({ project, onBoard, compact = false }: Props) {
  const [checkError, setCheckError] = useState<string | null>(null);

  async function checkAgain() {
    setCheckError(null);
    try {
      onBoard(await api.checkProject(project.id));
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Could not check the folder.");
    }
  }

  return (
    <div className={styles.heading} data-compact={compact || undefined}>
      <h2 className={styles.name}>{project.name}</h2>
      <p className={styles.path} title={compact ? project.path : undefined}>{project.path}</p>
      {project.trustWarning ? (
        <Panel tone="warning" className={styles.warning} role="alert">
          <p>
            Claude Code doesn't trust this folder, so its CLAUDE.md isn't loaded. Open Claude Code in the repo once and
            accept.
          </p>
          <Button compact onClick={checkAgain}>
            Check again
          </Button>
          {checkError ? <p>{checkError}</p> : null}
        </Panel>
      ) : null}
    </div>
  );
}
