import { LANES, type Lane } from "@hive/shared";
import styles from "./LaneSteps.module.css";

type Status = "past" | "current" | "future";

/**
 * The lanes, with the card's own marked. `compact` draws them as a thin strip without names, for a tile on the Board
 * By project; the lane's name sits beside it there, so screen readers skip the strip.
 */
export function LaneSteps({ current, compact = false }: { current: Lane; compact?: boolean }) {
  const currentIndex = LANES.findIndex((lane) => lane.id === current);
  const statusOf = (index: number): Status =>
    index < currentIndex ? "past" : index === currentIndex ? "current" : "future";

  if (compact) {
    return (
      <ol className={styles.strip} aria-hidden="true">
        {LANES.map((lane, index) => (
          <li key={lane.id} className={styles.segment} data-status={statusOf(index)} />
        ))}
      </ol>
    );
  }

  return (
    <ol className={styles.steps} aria-label="Lanes">
      {LANES.map((lane, index) => {
        const status = statusOf(index);
        return (
          <li
            key={lane.id}
            className={styles.step}
            data-status={status}
            aria-current={status === "current" ? "step" : undefined}
          >
            {status === "past" ? "✓ " : status === "current" ? "● " : ""}
            {lane.name}
          </li>
        );
      })}
    </ol>
  );
}
