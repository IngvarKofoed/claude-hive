import { useEffect, useState } from "react";
import type { CardDetail, Landed, ShipPlan } from "@hive/shared";
import { api } from "../api/client";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { Panel } from "./ui/Panel";
import styles from "./ShipPanel.module.css";

interface Props {
  detail: CardDetail;
  /** Called after Back to Try it succeeds, so the page can load the card in its new lane. */
  onMoved: () => void;
}

export function ShipPanel({ detail, onMoved }: Props) {
  const [plan, setPlan] = useState<ShipPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api
      .shipPlan(detail.id)
      .then((next) => {
        if (current) setPlan(next);
      })
      .catch((err: unknown) => {
        if (current) setError(err instanceof Error ? err.message : "Could not read what landing will do.");
      });
    return () => {
      current = false;
    };
  }, [detail.id, detail.landing, detail.state, detail.chat.length]);

  async function call(action: () => Promise<unknown>, after?: () => void) {
    setError(null);
    try {
      await action();
      after?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  // `landing` comes only with a full load; the live card.updated event carries `state`, which is working while it lands.
  const landing = detail.landing || detail.state === "working";
  const dirty = plan ? plan.uncommitted.length > 0 : false;
  const blocked = !plan || plan.busy || plan.unpushed > 0 || plan.checkoutBlocks || dirty;

  return (
    <Panel title="Ship">
      <div className={styles.section}>
        {plan ? (
          <>
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
          </>
        ) : (
          <p className={styles.muted}>Reading what landing will do…</p>
        )}
        <div className={styles.actions}>
          <Button variant="primary" disabled={landing || blocked} onClick={() => call(() => api.land(detail.id))}>
            Land on main
          </Button>
          {dirty ? (
            <Button
              disabled={landing || !plan || plan.busy || plan.unpushed > 0 || plan.checkoutBlocks}
              onClick={() => call(() => api.land(detail.id, true))}
            >
              Discard them and land
            </Button>
          ) : null}
          <Button disabled={landing} onClick={() => call(() => api.backToTryIt(detail.id), onMoved)}>
            Back to Try it
          </Button>
          {landing ? <span className={styles.muted}>Landing…</span> : null}
        </div>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

export function DonePanel({ landed }: { landed: Landed | null }) {
  return (
    <Panel title="Done">
      {landed ? (
        <div className={styles.section}>
          <p>
            Landed on main as <Chip mono>{landed.commit.slice(0, 7)}</Chip> {landed.subject}
          </p>
          <p>{landed.remote ? "Pushed to origin/main" : "Moved your local main"}</p>
          <p>
            {landed.checkout === "updated"
              ? "Your checkout's main: up to date"
              : `Your checkout's main: ${landed.checkout}`}
          </p>
        </div>
      ) : (
        <p className={styles.muted}>No landing was recorded for this card.</p>
      )}
    </Panel>
  );
}
