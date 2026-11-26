import type { Plan } from "@hive/shared";
import { Chip } from "./ui/Chip";
import styles from "./PlanView.module.css";

export function PlanView({ plan }: { plan: Plan }) {
  return (
    <div className={styles.plan}>
      <section className={styles.section}>
        <h3 className={styles.heading}>Steps</h3>
        <ol className={styles.steps}>
          {plan.steps.map((step, index) => (
            <li key={index} className={styles.step}>
              <p className={styles.stepTitle}>
                {step.title} <Chip>{step.chunk}</Chip>
              </p>
              {step.detail ? <p className={styles.detail}>{step.detail}</p> : null}
              <p className={styles.check}>Checked by: {step.check}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className={styles.section}>
        <h3 className={styles.heading}>Chunks</h3>
        <ul className={styles.chunks}>
          {plan.chunks.map((chunk) => (
            <li key={chunk.name} className={styles.chunk}>
              <p className={styles.stepTitle}>
                {chunk.name} <Chip>{chunk.model}</Chip>
              </p>
              <ul className={styles.files}>
                {chunk.owns.map((file) => (
                  <li key={file}>
                    <Chip mono>{file}</Chip>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.section}>
        <h3 className={styles.heading}>Tests</h3>
        {plan.tests.length === 0 ? (
          <p className={styles.detail}>No tests listed.</p>
        ) : (
          <ul className={styles.tests}>
            {plan.tests.map((test, index) => (
              <li key={index}>{test}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
