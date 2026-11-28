import { useEffect, useState } from "react";
import type { CardDetail, LaneActionId, Landed, ShipPlan } from "@hive/shared";
import { api } from "../api/client";
import { actionOf, laneActionsFor, useLaneActionDone } from "./laneActions";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { Panel } from "./ui/Panel";
import { ShipPlanView } from "./ShipPlanView";
import styles from "./ShipPanel.module.css";

interface Props {
  detail: CardDetail;
  /** Called after Back to Try it succeeds, so the page can load the card in its new lane. */
  onMoved: () => void;
}

export function ShipPanel({ detail, onMoved }: Props) {
  const [plan, setPlan] = useState<ShipPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const laneActionDone = useLaneActionDone();

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

  async function call(id: LaneActionId, action: () => Promise<unknown>, after?: () => void) {
    setError(null);
    try {
      await action();
      after?.();
      laneActionDone(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  // `landing` comes only with a full load; the live card.updated event carries `state`, which is working while it lands.
  const landing = detail.landing || detail.state === "working";
  const actions = laneActionsFor(detail, { shipPlan: plan });
  const land = actionOf(actions, "land");
  const discard = actionOf(actions, "discard-and-land");
  const backToTryIt = actionOf(actions, "back-to-tryit");

  return (
    <Panel title="Ship">
      <div className={styles.section}>
        {plan ? (
          <ShipPlanView plan={plan} />
        ) : (
          <p className={styles.muted}>Reading what landing will do…</p>
        )}
        <div className={styles.actions}>
          <Button variant="primary" disabled={!land?.enabled} title={land?.reason ?? undefined} onClick={() => call("land", () => api.land(detail.id))}>
            {land?.label}
          </Button>
          {discard ? (
            <Button disabled={!discard.enabled} title={discard.reason ?? undefined} onClick={() => call("discard-and-land", () => api.land(detail.id, true))}>
              {discard.label}
            </Button>
          ) : null}
          <Button
            disabled={!backToTryIt?.enabled}
            title={backToTryIt?.reason ?? undefined}
            onClick={() => call("back-to-tryit", () => api.backToTryIt(detail.id), onMoved)}
          >
            {backToTryIt?.label}
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
