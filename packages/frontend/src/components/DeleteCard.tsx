import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { CardDetail } from "@hive/shared";
import { api } from "../api/client";
import { deleteQuestion } from "./deleteText";
import { Button } from "./ui/Button";
import styles from "./DeleteCard.module.css";

interface Props {
  detail: CardDetail;
  /** The card was deleted, here or in another tab. */
  gone: boolean;
}

/**
 * Delete card on the card page: a quiet button, then a confirm row naming what goes. A clean delete goes back to the
 * board; one that left something in git says what (docs/specs/2026-11-27-delete-a-card.md).
 */
export function DeleteCard({ detail, gone }: Props) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [left, setLeft] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Deleted elsewhere: back to the board. This tab's own delete decides for itself once its answer is in, since the
  // card.deleted event usually arrives before the answer that lists what was left behind.
  useEffect(() => {
    if (gone && left === null && !deleting) navigate("/");
  }, [gone, left, deleting, navigate]);

  function close() {
    setConfirming(false);
    setError(null);
  }

  useEffect(() => {
    if (!confirming || deleting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, deleting]);

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const result = await api.deleteCard(detail.id);
      if (result.left.length > 0) setLeft(result.left);
      else navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the card.");
      setDeleting(false);
    }
  }

  if (left) {
    return (
      <div className={styles.panel} role="status">
        <p>Deleted. Left behind, to clean up by hand:</p>
        <ul className={styles.left}>
          {left.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Link to="/">Back to the board</Link>
      </div>
    );
  }

  if (!confirming) {
    return (
      <Button compact variant="ghost" className={styles.open} onClick={() => setConfirming(true)}>
        Delete card
      </Button>
    );
  }

  return (
    <div className={styles.panel} role="group" aria-label="Delete this card">
      <p>{deleteQuestion(detail, "page")}</p>
      <div className={styles.actions}>
        <Button compact variant="primary" disabled={deleting} onClick={() => void remove()}>
          {deleting ? "Deleting…" : "Delete"}
        </Button>
        <Button compact disabled={deleting} onClick={close}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
