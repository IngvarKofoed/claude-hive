import type { CheckRound, ReportedIssue } from "@hive/shared";
import { Chip } from "./ui/Chip";
import { Markdown } from "./ui/Markdown";
import styles from "./CheckView.module.css";

interface Props {
  check: CheckRound;
  /** The number to show; the round's own when not given. */
  round?: number;
  /** The spec issues the reviewer reported in this round. */
  issues?: ReportedIssue[];
  /** False when a surrounding heading already names the round. */
  heading?: boolean;
}

export function CheckView({ check, round = check.round, issues = [], heading = true }: Props) {
  return (
    <div className={styles.check}>
      {heading ? <h3 className={styles.heading}>Round {round}</h3> : null}
      <Markdown>{check.summary}</Markdown>
      {check.bugs.length === 0 ? (
        <p className={styles.detail}>No bugs.</p>
      ) : (
        <ul className={styles.list}>
          {check.bugs.map((bug, index) => (
            <li key={index} className={styles.item}>
              <Chip mono>{bug.where}</Chip>
              <p>{bug.problem}</p>
            </li>
          ))}
        </ul>
      )}
      {issues.length > 0 ? (
        <>
          <h4 className={styles.subheading}>Spec issues reported</h4>
          <ul className={styles.list}>
            {issues.map((issue, index) => (
              <li key={index} className={styles.item}>
                <strong>{issue.where}</strong>
                <p>{issue.problem}</p>
                <p className={styles.detail}>Built as: {issue.guess}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
