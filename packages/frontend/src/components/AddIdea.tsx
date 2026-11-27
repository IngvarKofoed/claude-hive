import { useState } from "react";
import type { ProjectSummary } from "@hive/shared";
import styles from "./AddIdea.module.css";

interface Props {
  project: ProjectSummary;
  onAddIdea: (projectId: string, text: string) => Promise<void>;
}

/** The field that adds an idea to one project, in its Ideas cell or its panel. */
export function AddIdea({ project, onAddIdea }: Props) {
  const [idea, setIdea] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function add() {
    const text = idea.trim();
    // A second Enter while the first add runs would add the same idea twice.
    if (!text || adding) return;
    setAdding(true);
    setError(null);
    try {
      await onAddIdea(project.id, text);
      setIdea("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the idea.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <form
      className={styles.idea}
      onSubmit={(event) => {
        event.preventDefault();
        void add();
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
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
