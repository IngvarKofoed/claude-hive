import type { BuildReport, Decision, FileChange, SpecIssue } from "@hive/shared";
import { Chip } from "./ui/Chip";
import { Markdown } from "./ui/Markdown";
import styles from "./BuildView.module.css";

interface Props {
  build: BuildReport | null;
  issues: SpecIssue[];
  decisions: Decision[];
}

function counts(file: FileChange): string {
  if (file.added === null || file.removed === null) return "binary";
  return `+${file.added} −${file.removed}`;
}

function None() {
  return <p className={styles.detail}>None.</p>;
}

export function BuildView({ build, issues, decisions }: Props) {
  return (
    <div className={styles.build}>
      <section className={styles.section}>
        <h3 className={styles.heading}>What was built</h3>
        {build ? (
          <>
            <Markdown>{build.summary}</Markdown>
            <h4 className={styles.subheading}>Departures from the plan</h4>
            {build.departures.length === 0 ? (
              <None />
            ) : (
              <ul className={styles.list}>
                {build.departures.map((departure, index) => (
                  <li key={index} className={styles.item}>
                    <p className={styles.title}>{departure.step}</p>
                    <p>{departure.what}</p>
                    <p className={styles.detail}>Why: {departure.why}</p>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <None />
        )}
      </section>
      <section className={styles.section}>
        <h3 className={styles.heading}>Files changed</h3>
        {build && build.files.length > 0 ? (
          <ul className={styles.files}>
            {build.files.map((file) => (
              <li key={file.path} className={styles.file}>
                <Chip mono>{file.path}</Chip>
                <span className={styles.counts}>{counts(file)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <None />
        )}
      </section>
      <section className={styles.section}>
        <h3 className={styles.heading}>Spec issues, waiting for the spec keeper</h3>
        {issues.length === 0 ? (
          <None />
        ) : (
          <ul className={styles.list}>
            {issues.map((issue) => (
              <li key={issue.id} className={styles.item}>
                <p className={styles.title}>{issue.where}</p>
                <p>{issue.problem}</p>
                <p className={styles.detail}>Built as: {issue.guess}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.section}>
        <h3 className={styles.heading}>Decided without you</h3>
        {decisions.length === 0 ? (
          <None />
        ) : (
          <ul className={styles.list}>
            {decisions.map((decision) => (
              <li key={decision.id} className={styles.item}>
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
