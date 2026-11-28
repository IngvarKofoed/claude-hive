import type { BuildRound, FileChange } from "@hive/shared";
import { Chip } from "./ui/Chip";
import { Markdown } from "./ui/Markdown";
import styles from "./BuildView.module.css";

function counts(file: FileChange): string {
  if (file.added === null || file.removed === null) return "binary";
  return `+${file.added} −${file.removed}`;
}

function None() {
  return <p className={styles.detail}>None.</p>;
}

/** A finished Build round from the card's history. Only the newest round is given `files`. */
export function BuildRoundView({ round, files }: { round: BuildRound; files?: FileChange[] }) {
  return (
    <div className={styles.build}>
      <section className={styles.section}>
        <Markdown>{round.summary}</Markdown>
        <h4 className={styles.subheading}>Departures from the plan</h4>
        {round.departures.length === 0 ? (
          <None />
        ) : (
          <ul className={styles.list}>
            {round.departures.map((departure, index) => (
              <li key={index} className={styles.item}>
                <p className={styles.title}>{departure.step}</p>
                <p>{departure.what}</p>
                <p className={styles.detail}>Why: {departure.why}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {files ? (
        <section className={styles.section}>
          <h4 className={styles.subheading}>Files changed</h4>
          {files.length === 0 ? (
            <None />
          ) : (
            <ul className={styles.files}>
              {files.map((file) => (
                <li key={file.path} className={styles.file}>
                  <Chip mono>{file.path}</Chip>
                  <span className={styles.counts}>{counts(file)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      <section className={styles.section}>
        <h4 className={styles.subheading}>Spec issues reported</h4>
        {round.issues.length === 0 ? (
          <None />
        ) : (
          <ul className={styles.list}>
            {round.issues.map((issue, index) => (
              <li key={index} className={styles.item}>
                <p className={styles.title}>{issue.where}</p>
                <p>{issue.problem}</p>
                <p className={styles.detail}>Built as: {issue.guess}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.section}>
        <h4 className={styles.subheading}>Decided without you</h4>
        {round.decisions.length === 0 ? (
          <None />
        ) : (
          <ul className={styles.list}>
            {round.decisions.map((decision, index) => (
              <li key={index} className={styles.item}>
                <p>{decision.what}</p>
                <p className={styles.detail}>Instead of: {decision.alternative}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
