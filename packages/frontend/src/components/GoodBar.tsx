import { useState } from "react";
import type { CardDetail } from "@hive/shared";
import { api } from "../api/client";
import { Button } from "./ui/Button";
import styles from "./GoodBar.module.css";

/** Refine's way on: you say Good, and the card moves to Spec. */
export function GoodBar({ detail, onMoved }: { detail: CardDetail; onMoved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const blocked = detail.turnRunning || detail.pending !== null;

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
      <Button variant="primary" disabled={blocked} onClick={good}>
        Good
      </Button>
      <span className={styles.hint}>
        {blocked ? "Wait for the product owner to finish" : "Happy with the brief? Move on to the spec."}
      </span>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
