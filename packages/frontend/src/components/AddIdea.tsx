import { useState } from "react";
import type { ProjectSummary } from "@hive/shared";
import { useNewIdea } from "./newIdeaContext";
import styles from "./AddIdea.module.css";

/**
 * The one-line field in a project's Ideas cell or panel. Enter opens New idea with this project chosen and what you
 * typed as the title: there is one form, one Add and one place where an idea can fail.
 */
export function AddIdea({ project }: { project: ProjectSummary }) {
  const { openNewIdea } = useNewIdea();
  const [idea, setIdea] = useState("");

  return (
    <form
      className={styles.idea}
      onSubmit={(event) => {
        event.preventDefault();
        openNewIdea({ projectId: project.id, title: idea.trim() });
        setIdea("");
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
    </form>
  );
}
