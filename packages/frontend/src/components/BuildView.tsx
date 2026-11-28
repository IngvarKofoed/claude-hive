import type { BuildReport, Decision, FileChange, IssueStatus, Lane, SpecIssue } from "@hive/shared";
import { Badge, type BadgeTone } from "./ui/Badge";
import { Chip } from "./ui/Chip";
import { Markdown } from "./ui/Markdown";
import styles from "./BuildView.module.css";

interface Props {
  build: BuildReport | null;
  issues: SpecIssue[];
  decisions: Decision[];
  /** The card's lane: an issue still open on a card that has moved on past Check reads "Not judged". */
  lane: Lane;
}

const STATUS_LABEL: Record<IssueStatus, string> = {
  open: "Waiting for the spec keeper",
  "spec-fixed": "Spec fixed",
  "no-change": "No change",
  sent: "Sent to the developer",
  fixed: "Code fixed",
  judged: "Judged",
  severe: "Severe",
  waiting: "Waits for you",
  held: "You: Change the code",
  kept: "You: Keep it as built",
  settled: "Settled in Spec",
};

const STATUS_TONE: Record<IssueStatus, BadgeTone> = {
  open: "working",
  "spec-fixed": "done",
  "no-change": "neutral",
  sent: "working",
  fixed: "done",
  judged: "neutral",
  severe: "stopped",
  waiting: "needs-you",
  held: "needs-you",
  kept: "done",
  settled: "neutral",
};

/** Whether an open issue will not be judged any more: the card has moved on past a failed keeper turn. */
const movedOn = (lane: Lane) => lane === "tryit" || lane === "ship" || lane === "done";

function counts(file: FileChange): string {
  if (file.added === null || file.removed === null) return "binary";
  return `+${file.added} −${file.removed}`;
}

function None() {
  return <p className={styles.detail}>None.</p>;
}

export function BuildView({ build, issues, decisions, lane }: Props) {
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
        <h3 className={styles.heading}>Spec issues</h3>
        {issues.length === 0 ? (
          <None />
        ) : (
          <ul className={styles.list}>
            {issues.map((issue) => (
              <li key={issue.id} className={styles.item}>
                <p className={styles.title}>{issue.where}</p>
                <p>{issue.problem}</p>
                <p className={styles.detail}>Built as: {issue.guess}</p>
                <div>
                  {issue.status === "open" && movedOn(lane) ? (
                    <Badge>Not judged</Badge>
                  ) : (
                    <Badge tone={STATUS_TONE[issue.status]}>{STATUS_LABEL[issue.status]}</Badge>
                  )}
                </div>
                {issue.judgment ? (
                  <>
                    <p className={styles.detail}>Spec keeper: {issue.judgment.reason}</p>
                    {issue.judgment.recommendation ? (
                      <p className={styles.detail}>Recommends: {issue.judgment.recommendation}</p>
                    ) : null}
                  </>
                ) : null}
                {issue.answer?.words ? <p className={styles.detail}>You said: {issue.answer.words}</p> : null}
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
