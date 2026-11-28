import { useState } from "react";
import { Link } from "react-router";
import { LANES, type ForYouItem, type ForYouKind, type LaneActionState } from "@hive/shared";
import { ago } from "./ago";
import { Button } from "./ui/Button";
import { useForYou } from "./forYou";
import { FROM_FOR_YOU } from "./fromForYou";
import { LANE_ACTION_CALLS, type LaneActionCall } from "./laneActions";
import { LandConfirm } from "./LandConfirm";
import { PendingCard } from "./PendingCard";
import styles from "./ForYouEntry.module.css";

const KIND_LABEL: Partial<Record<ForYouKind, string>> = {
  question: "question",
  permission: "permission",
  stuck: "stuck",
  "your-turn": "your turn",
  "sign-off": "sign off",
  "review-again": "review again",
  land: "land on main",
};

export function tagText(item: ForYouItem): string {
  const lane = LANES.find((l) => l.id === item.card.lane)?.name ?? item.card.lane;
  const label = KIND_LABEL[item.kind];
  return label ? `${lane} · ${label}` : lane;
}

function linkLabel(kind: ForYouKind): string {
  if (kind === "your-turn" || kind === "sign-off" || kind === "review-again") return "Open the chat";
  if (kind === "try-it") return "Try it";
  return "Open the card";
}

export function ForYouEntry({ item, nowMs }: { item: ForYouItem; nowMs: number }) {
  // The entry is keyed by card, so it outlives one question: an error counts only for the item it was about.
  const about = item.pending?.id ?? item.kind;
  const [failed, setFailed] = useState<{ about: string; message: string } | null>(null);
  const error = failed?.about === about ? failed.message : null;
  const setError = (message: string) => setFailed({ about, message });
  const { reload } = useForYou();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const actions = item.actions;

  async function press(action: LaneActionState) {
    if (action.id === "land") {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      await LANE_ACTION_CALLS[action.id as LaneActionCall](item.card.id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action.label.toLowerCase()}.`);
    } finally {
      setBusy(false);
    }
  }

  const answered = item.kind === "question" || item.kind === "permission";
  return (
    <article className={styles.entry} data-kind={item.kind}>
      <div className={styles.top}>
        <span className={styles.tag}>{tagText(item)}</span>
        <span className={styles.title}>
          {item.projectName} · {item.card.title}
        </span>
        <span className={styles.ago}>{ago(item.since, nowMs)}</span>
      </div>
      {/* The form asks the question itself, so the line would only repeat it. */}
      {answered && item.pending ? (
        <PendingCard item={item.pending} onError={setError} />
      ) : (
        <p className={styles.text}>{item.text}</p>
      )}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {confirming ? (
        <LandConfirm
          card={item.card}
          onClose={() => setConfirming(false)}
          onLanded={() => {
            setConfirming(false);
            reload();
          }}
        />
      ) : (
        <>
          <div className={styles.actions}>
            {actions.map((action) => (
              <Button
                key={action.id}
                compact
                variant={action.primary ? "primary" : "secondary"}
                disabled={busy || !action.enabled}
                title={action.reason ?? undefined}
                onClick={() => void press(action)}
              >
                {action.label}
              </Button>
            ))}
            <Link
              to={`/cards/${item.card.id}`}
              // The card page reads this, and takes you back here after a lane action.
              state={FROM_FOR_YOU}
              className={styles.link}
              data-secondary={answered || actions.length > 0 || undefined}
            >
              {linkLabel(item.kind)}
            </Link>
          </div>
          {actions
            .filter((action) => !action.enabled && action.reason)
            .map((action) => (
              <p key={action.id} className={styles.reason}>
                {action.label}: {action.reason}
              </p>
            ))}
        </>
      )}
    </article>
  );
}
