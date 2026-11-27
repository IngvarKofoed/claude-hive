import type { CheckRound } from "@hive/shared";
import { Chip } from "./ui/Chip";
import { Markdown } from "./ui/Markdown";
import styles from "./CheckView.module.css";

export function CheckView({ check }: { check: CheckRound }) {
  return (
    <div className={styles.check}>
      <h3 className={styles.heading}>Round {check.round}</h3>
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
    </div>
  );
}
