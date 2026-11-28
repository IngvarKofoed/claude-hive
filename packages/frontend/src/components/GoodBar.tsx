import { useState } from "react";
import type { CardDetail, LaneActionState } from "@hive/shared";
import { LANE_ACTION_CALLS, laneActionsFor } from "./laneActions";
import { Button } from "./ui/Button";
import styles from "./GoodBar.module.css";

/**
 * Refine's way on: Good · on to Mockup, or Good · skip to Spec when there's nothing to show. Both come from the shared
 * lane actions, so the card page and For you offer the same buttons with the same reasons.
 */
export function GoodBar({ detail, onMoved }: { detail: CardDetail; onMoved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const actions = laneActionsFor(detail).filter((action) => action.id === "good" || action.id === "skip-mockup");
  const blocked = actions.find((action) => !action.enabled)?.reason ?? null;

  async function press(action: LaneActionState) {
    setError(null);
    try {
      await LANE_ACTION_CALLS[action.id as "good" | "skip-mockup"](detail.id);
      onMoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move the card.");
    }
  }

  return (
    <div className={styles.bar}>
      {actions.map((action) => (
        <Button
          key={action.id}
          variant={action.primary ? "primary" : undefined}
          disabled={!action.enabled}
          title={action.reason ?? undefined}
          onClick={() => void press(action)}
        >
          {action.label}
        </Button>
      ))}
      <span className={styles.hint}>
        {blocked ?? "Happy with the brief? Mock up the look, or skip to the spec when there's nothing to show."}
      </span>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
