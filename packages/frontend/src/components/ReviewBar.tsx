import { useState } from "react";
import type { CardDetail, ReviewState } from "@hive/shared";
import { api } from "../api/client";
import { actionOf, laneActionsFor } from "./laneActions";
import { Button } from "./ui/Button";
import styles from "./ReviewBar.module.css";

export const REVIEW_TEXT: Record<ReviewState, string> = {
  none: "No review yet",
  running: "Review running…",
  applying: "Applying the review…",
  unfinished: "Review not finished: retry",
  fresh: "Reviewed: you can sign off",
  stale: "Changed since the review",
};

interface Props {
  detail: CardDetail;
  /** Called after Sign off succeeds, so the page can load the card in its new lane. */
  onMoved: () => void;
}

export function ReviewBar({ detail, onMoved }: Props) {
  const [error, setError] = useState<string | null>(null);
  const spec = detail.spec;
  if (!spec) return null;

  const actions = laneActionsFor(detail);
  const review = actionOf(actions, "review");
  const signoff = actionOf(actions, "signoff");

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setError(null);
    try {
      await action();
      after?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className={styles.bar}>
      <div className={styles.row}>
        <p className={styles.state} data-review={spec.review} role="status">
          {REVIEW_TEXT[spec.review]}
        </p>
        <Button
          compact
          disabled={!review?.enabled}
          title={review?.reason ?? undefined}
          onClick={() => run(() => api.review(detail.id))}
        >
          {review?.label}
        </Button>
        <Button
          compact
          variant="primary"
          disabled={!signoff?.enabled}
          title={signoff?.reason ?? undefined}
          onClick={() => run(() => api.signoff(detail.id), onMoved)}
        >
          {signoff?.label}
        </Button>
        {signoff?.reason ? <span className={styles.reason}>{signoff.reason}</span> : null}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
