import type { ShipPlan } from "@hive/shared";
import { Chip } from "./ui/Chip";
import styles from "./ShipPlanView.module.css";

/** What Land on main will do: its steps, what blocks it, and the uncommitted files a discard throws away. */
export function ShipPlanView({ plan }: { plan: ShipPlan }) {
  const dirty = plan.uncommitted.length > 0;
  return (
    <div className={styles.plan}>
      <h3>Land on main will:</h3>
      <ol className={styles.steps}>
        <li>
          Squash the card onto <Chip mono>{plan.base}</Chip> as one commit, written in the repo&apos;s style.
        </li>
        <li>
          {plan.tests ? (
            <>
              Run the tests (<Chip mono>{plan.tests}</Chip>).
            </>
          ) : (
            <span className={styles.warning}>No tests will run: {plan.noTestsReason}</span>
          )}
        </li>
        <li>{plan.base === "main" ? "Move your local main to it." : "Push it to origin/main."}</li>
        <li>Bring your checkout&apos;s main up to date, if that&apos;s safe.</li>
        <li>Remove the card&apos;s worktree and branch.</li>
      </ol>
      {plan.unpushed > 0 ? (
        <p className={styles.warning}>
          Your local main has {plan.unpushed} commits that aren&apos;t on origin. Push them first.
        </p>
      ) : null}
      {plan.checkoutBlocks ? (
        <p className={styles.warning}>
          Your checkout has main checked out with uncommitted changes. Commit or stash them first.
        </p>
      ) : null}
      {plan.busy ? <p className={styles.warning}>Another card of this project is landing.</p> : null}
      {dirty ? (
        <div className={styles.warning}>
          Uncommitted work in the card&apos;s worktree won&apos;t land:
          <ul className={styles.lines}>
            {plan.uncommitted.map((line, i) => (
              <li key={`${i}:${line}`}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
