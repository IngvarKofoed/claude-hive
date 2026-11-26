import { LANES, type Lane } from "@hive/shared";
import styles from "./LaneSteps.module.css";

export function LaneSteps({ current }: { current: Lane }) {
  const currentIndex = LANES.findIndex((lane) => lane.id === current);
  return (
    <ol className={styles.steps} aria-label="Lanes">
      {LANES.map((lane, index) => {
        const status = index < currentIndex ? "past" : index === currentIndex ? "current" : "future";
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
