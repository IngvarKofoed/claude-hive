import { useEffect, useState } from "react";
import type { ShipPlan } from "@hive/shared";
import { api } from "../api/client";
import { landActions } from "./laneActions";
import { ShipPlanView } from "./ShipPlanView";
import { Button } from "./ui/Button";
import styles from "./LandConfirm.module.css";

interface Props {
  card: { id: string; title: string };
  onClose: () => void;
  onLanded: () => void;
}

/** For you's confirm row for Land on main: what landing will do, then Land on main, or Discard them and land. */
export function LandConfirm({ card, onClose, onLanded }: Props) {
  const [plan, setPlan] = useState<ShipPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [landing, setLanding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.shipPlan(card.id).then(
      (p) => live && setPlan(p),
      (err) => live && setPlanError(err instanceof Error ? err.message : "Could not read what landing will do."),
    );
    return () => {
      live = false;
    };
  }, [card.id]);

  useEffect(() => {
    if (landing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [landing, onClose]);

  async function land(discard: boolean) {
    setLanding(true);
    setError(null);
    try {
      await (discard ? api.land(card.id, true) : api.land(card.id));
      onLanded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not land the card.");
      setLanding(false);
    }
  }

  const actions = plan ? landActions(plan) : [];
  return (
    <div className={styles.panel} role="group" aria-label={`Land ${card.title} on main`}>
      <p className={styles.heading}>
        Land <em>{card.title}</em> on main?
      </p>
      {planError ? (
        <p className={styles.error} role="alert">
          {planError}
        </p>
      ) : plan ? (
        <ShipPlanView plan={plan} />
      ) : (
        <p className={styles.muted}>Reading what landing will do…</p>
      )}
      <div className={styles.actions}>
        {actions.map((action) => (
          <Button
            key={action.id}
            compact
            variant={action.primary ? "primary" : "secondary"}
            disabled={landing || !action.enabled}
            title={action.reason ?? undefined}
            onClick={() => void land(action.id === "discard-and-land")}
          >
            {action.label}
          </Button>
        ))}
        <Button compact disabled={landing} onClick={onClose}>
          Cancel
        </Button>
      </div>
      {actions
        .filter((action) => !action.enabled && action.reason)
        .map((action) => (
          <p key={action.id} className={styles.muted}>
            {action.label}: {action.reason}
          </p>
        ))}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
