import { useState } from "react";
import type { CardDetail, LaneActionState } from "@hive/shared";
import { actionOf, LANE_ACTION_CALLS, laneActionsFor, useLaneActionDone } from "./laneActions";
import { Button } from "./ui/Button";
import styles from "./MockupBar.module.css";

export const LINK_WITHOUT_FILES_HINT =
  "The hive can't open this link. Give the designer a path to exported screens, or the spec goes by the chat alone.";

/**
 * Mockup's way on: Good, keeping the mockup's folder in the repo or not. Both buttons come from the shared lane actions,
 * so the card page and For you offer the same buttons with the same reasons.
 */
export function MockupBar({ detail, onMoved }: { detail: CardDetail; onMoved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const laneActionDone = useLaneActionDone();
  const actions = laneActionsFor(detail).filter((action) => action.id === "keep" || action.id === "dont-keep");
  const keep = actionOf(actions, "keep");
  const dontKeep = actionOf(actions, "dont-keep");
  const mockup = detail.mockup;
  const linkWithoutFiles = mockup?.current?.kind === "link" && mockup.files.length === 0;

  async function press(action: LaneActionState) {
    setError(null);
    try {
      await LANE_ACTION_CALLS[action.id as "keep" | "dont-keep"](detail.id);
      onMoved();
      laneActionDone(action.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move the card.");
    }
  }

  // Waiting for the designer greys both; otherwise Keep's own reason, then the link's gap, then the plain prompt.
  const hint = (dontKeep && !dontKeep.enabled ? dontKeep.reason : null)
    ?? (keep && !keep.enabled ? keep.reason : null)
    ?? (linkWithoutFiles ? LINK_WITHOUT_FILES_HINT : "Happy with the mockup? Keep it in the repo, or let it go.");

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
      <span className={styles.hint}>{hint}</span>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
