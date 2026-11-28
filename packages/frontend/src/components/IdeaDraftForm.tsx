import { useEffect, useState } from "react";
import type { IdeaDraft } from "@hive/shared";
import { api } from "../api/client";
import { Button } from "./ui/Button";
import styles from "./IdeaDraftForm.module.css";

/** The draft form, in the chat column under the log: Title, Idea, Add and Cancel. Its text is local; a ready draft fills it, a failed one leaves it empty. */
export function IdeaDraftForm({ projectId, chatId, draft, onChanged }: { projectId: string; chatId: string; draft: IdeaDraft; onChanged: () => void }) {
  const [title, setTitle] = useState(draft.status === "ready" ? draft.title : "");
  const [text, setText] = useState(draft.status === "ready" ? draft.text : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drafting = draft.status === "drafting";

  // The draft turn finished: its words fill the fields. A refetch with the same words leaves your edits alone.
  useEffect(() => {
    setTitle(draft.status === "ready" ? draft.title : "");
    setText(draft.status === "ready" ? draft.text : "");
  }, [draft.status, draft.title, draft.text]);

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  const filled = title.trim() !== "" && text.trim() !== "";

  return (
    <div className={styles.form}>
      {drafting ? <p className={styles.drafting}>Drafting…</p> : null}
      {draft.status === "failed" ? (
        <p className={styles.error} role="alert">
          {draft.reason}
        </p>
      ) : null}
      <label className={styles.field}>
        Title
        <input type="text" className={styles.control} value={title} disabled={drafting} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className={`${styles.field} ${styles.grow}`}>
        Idea
        <textarea className={styles.control} rows={4} value={text} disabled={drafting} onChange={(e) => setText(e.target.value)} />
      </label>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={busy || drafting || !filled}
          onClick={() =>
            void run(() => api.newCard({ projectId, title: title.trim(), text: text.trim(), chatId }), "Could not add the idea.")
          }
        >
          Add
        </Button>
        <Button disabled={busy} onClick={() => void run(() => api.closeDraft(chatId), "Could not close the form.")}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
