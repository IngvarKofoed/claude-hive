import { useState } from "react";
import type { CardDetail } from "@hive/shared";
import { api } from "../api/client";
import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";
import styles from "./IdeaPanel.module.css";

interface Props {
  detail: CardDetail;
  /** The card changed (saved or started): fetch it again. */
  onChanged: () => void;
}

/** The editor for a card in Ideas: its title and text, Save, and Start (the same move as the tile's Start). */
export function IdeaPanel({ detail, onChanged }: Props) {
  const [title, setTitle] = useState(detail.ideaTitle);
  const [text, setText] = useState(detail.ideaText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filled = title.trim() !== "" && text.trim() !== "";
  const changed = title.trim() !== detail.ideaTitle || text.trim() !== detail.ideaText;

  async function save() {
    await api.updateIdea(detail.id, { title: title.trim(), text: text.trim() });
    onChanged();
  }

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    run(async () => {
      // A failed save stops here: the card doesn't move.
      if (changed) await api.updateIdea(detail.id, { title: title.trim(), text: text.trim() });
      await api.moveCard(detail.id, { lane: "refine" });
      onChanged();
    }, "Could not start the card.");

  return (
    <Panel title="Idea">
      <div className={styles.form}>
        <label className={styles.field}>
          Title
          <input
            type="text"
            className={styles.control}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          Idea
          <textarea
            className={styles.control}
            rows={8}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button disabled={busy || !changed || !filled} onClick={() => void run(save, "Could not save the idea.")}>
            Save
          </Button>
          <Button variant="primary" disabled={busy || !filled} onClick={() => void start()}>
            Start
          </Button>
        </div>
      </div>
    </Panel>
  );
}
