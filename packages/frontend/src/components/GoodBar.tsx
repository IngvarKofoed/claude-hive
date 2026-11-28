import { useState } from "react";
import type { CardDetail } from "@hive/shared";
import { api } from "../api/client";
import { actionOf, laneActionsFor } from "./laneActions";
import { Button } from "./ui/Button";
import styles from "./GoodBar.module.css";

/** Refine's way on: you say Good, and the card moves to Spec. */
export function GoodBar({ detail, onMoved }: { detail: CardDetail; onMoved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const action = actionOf(laneActionsFor(detail), "good");

  async function good() {
    setError(null);
    try {
      await api.good(detail.id);
      onMoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move the card.");
    }
  }

  return (
    <div className={styles.bar}>
      <Button variant="primary" disabled={!action?.enabled} title={action?.reason ?? undefined} onClick={good}>
        {action?.label}
      </Button>
      <span className={styles.hint}>{action?.reason ?? "Happy with the brief? Move on to the spec."}</span>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
