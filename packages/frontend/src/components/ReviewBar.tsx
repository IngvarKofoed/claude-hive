import { useState } from "react";
import type { CardDetail, ReviewState } from "@hive/shared";
import { api } from "../api/client";
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

/** Why Sign off is greyed, or null when it is enabled. */
export function signOffReason(review: ReviewState, turnRunning: boolean): string | null {
  if (review === "fresh") return turnRunning ? "Wait for the spec writer to finish" : null;
  if (review === "none") return "Run the review first";
  if (review === "stale") return "Review the changed spec again first";
  if (review === "unfinished") return "Finish the review first";
  return "Wait for the review";
}

interface Props {
  detail: CardDetail;
  /** Called after Sign off succeeds, so the page can load the card in its new lane. */
  onMoved: () => void;
}

export function ReviewBar({ detail, onMoved }: Props) {
  const [error, setError] = useState<string | null>(null);
  const spec = detail.spec;
  if (!spec) return null;

  const canReview =
    (spec.review === "none" || spec.review === "stale") && spec.text !== null && !detail.turnRunning;
  const reason = signOffReason(spec.review, detail.turnRunning);

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
        <Button compact disabled={!canReview} onClick={() => run(() => api.review(detail.id))}>
          Review
        </Button>
        <Button
          compact
          variant="primary"
          disabled={reason !== null}
          onClick={() => run(() => api.signoff(detail.id), onMoved)}
        >
          Sign off
        </Button>
        {reason ? <span className={styles.reason}>{reason}</span> : null}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
