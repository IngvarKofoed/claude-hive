import { Link } from "react-router";
import { LANES, type Lane } from "@hive/shared";
import styles from "./LaneSteps.module.css";

type Status = "past" | "current" | "future" | "skipped";

const MARKER: Record<Status, string> = { past: "✓ ", current: "● ", future: "", skipped: "– " };

interface Props {
  current: Lane;
  /** A thin strip without names, for a tile on the Board By project. */
  compact?: boolean;
  /**
   * On the card page: finished lanes link to themselves, and the lane being looked back at is `viewing`
   * (docs/specs/2026-11-27-card-lane-artifacts.md). Without it, the strip only shows where the card is.
   */
  viewing?: Lane | null;
  navigable?: boolean;
  /** Lanes the card passed without entering (see skippedLanes): drawn as "– Mockup", never a link. */
  skipped?: Lane[];
}

/**
 * The lanes, with the card's own marked. A past lane in `skipped` is drawn as skipped.
 * `compact` draws the lanes as a thin strip without names; the lane's name sits beside it there, so screen readers
 * skip the strip.
 */
export function LaneSteps({ current, compact = false, viewing = null, navigable = false, skipped = [] }: Props) {
  const currentIndex = LANES.findIndex((lane) => lane.id === current);
  const statusOf = (index: number): Status =>
    index < currentIndex
      ? skipped.includes(LANES[index]!.id)
        ? "skipped"
        : "past"
      : index === currentIndex
        ? "current"
        : "future";

  if (compact) {
    return (
      <ol className={styles.strip} aria-hidden="true">
        {LANES.map((lane, index) => {
          // The thin strip stays as it was: a skipped lane is drawn as a passed one.
          const status = statusOf(index);
          return <li key={lane.id} className={styles.segment} data-status={status === "skipped" ? "past" : status} />;
        })}
      </ol>
    );
  }

  return (
    <ol className={styles.steps} aria-label="Lanes">
      {LANES.map((lane, index) => {
        const status = statusOf(index);
        const label = `${MARKER[status]}${lane.name}`;
        const isViewing = viewing === lane.id;
        // Past lanes always link; the current lane links only as the way back from a past one.
        const target =
          !navigable || isViewing
            ? null
            : status === "past"
              ? { search: `?lane=${lane.id}` }
              : status === "current" && viewing !== null
                ? { search: "" }
                : null;
        return (
          <li
            key={lane.id}
            className={styles.step}
            data-status={status}
            data-viewing={isViewing || undefined}
            aria-current={status === "current" ? "step" : undefined}
          >
            {target ? (
              <Link className={styles.link} to={target}>
                {label}
              </Link>
            ) : isViewing ? (
              <span aria-current="page">{label}</span>
            ) : (
              label
            )}
          </li>
        );
      })}
    </ol>
  );
}
