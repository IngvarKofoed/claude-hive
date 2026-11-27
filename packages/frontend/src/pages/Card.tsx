import { useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api/client";
import { laneImplemented, type CardDetail } from "@hive/shared";
import { BriefPanel } from "../components/BriefPanel";
import { BuildView } from "../components/BuildView";
import { CheckView } from "../components/CheckView";
import { Chat } from "../components/Chat";
import { GoodBar } from "../components/GoodBar";
import { Header } from "../components/Header";
import { LaneSteps } from "../components/LaneSteps";
import { TryItPanel } from "../components/TryItPanel";
import { PlanView } from "../components/PlanView";
import { ReviewBar } from "../components/ReviewBar";
import { SpecView } from "../components/SpecView";
import { useCardLive } from "../components/useCardLive";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { Panel } from "../components/ui/Panel";
import type { CardLive } from "../components/cardState";
import styles from "./Card.module.css";

function PlanPanel({ detail }: { detail: CardDetail }) {
  return (
    <Panel title="Plan">
      {detail.plan ? (
        <PlanView plan={detail.plan} />
      ) : (
        <p className={styles.muted}>
          {detail.lane === "plan" && detail.turnRunning
            ? "The planner is writing the plan…"
            : "The plan appears here once the planner has written it."}
        </p>
      )}
    </Panel>
  );
}

function BuildPanel({ detail }: { detail: CardDetail }) {
  if (!detail.build && detail.issues.length === 0 && detail.decisions.length === 0) return null;
  return (
    <Panel title="Build">
      <BuildView build={detail.build} issues={detail.issues} decisions={detail.decisions} />
    </Panel>
  );
}

function BackToTryIt({ id, onMoved }: { id: string; onMoved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={styles.stack}>
      <div>
        <Button
          compact
          onClick={async () => {
            setError(null);
            try {
              await api.backToTryIt(id);
              onMoved();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Something went wrong.");
            }
          }}
        >
          Back to Try it
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

export function LaneView({ live, onMoved }: { live: CardLive; onMoved: () => void }) {
  const { detail } = live;

  if (!laneImplemented(detail.lane)) {
    return (
      <>
        <Panel tone="warning" role="status">
          This lane isn&apos;t implemented yet
          {detail.lane === "ship" ? <BackToTryIt id={detail.id} onMoved={onMoved} /> : null}
        </Panel>
        <div className={styles.columns}>
          {detail.spec ? (
            <Panel title="Spec">
              <SpecView spec={detail.spec} brief={detail.brief} />
            </Panel>
          ) : null}
          {/* The newest work first: the build report sits above the plan, beside the spec, not under it. */}
          <div className={styles.stack}>
            {detail.check ? (
              <Panel title="Check">
                <CheckView check={detail.check} />
              </Panel>
            ) : null}
            <BuildPanel detail={detail} />
            {detail.plan ? <PlanPanel detail={detail} /> : null}
          </div>
        </div>
      </>
    );
  }

  if (detail.lane === "tryit") {
    return (
      <div className={styles.columns}>
        <TryItPanel detail={detail} onMoved={onMoved} />
        <div className={styles.stack}>
          {detail.check ? (
            <Panel title="Check">
              <CheckView check={detail.check} />
            </Panel>
          ) : null}
          <BuildPanel detail={detail} />
          <PlanPanel detail={detail} />
        </div>
      </div>
    );
  }

  if (detail.lane === "spec") {
    return (
      <div className={styles.columns}>
        <Panel title="Spec writer" className={styles.chatPanel}>
          <Chat detail={detail} streaming={live.streaming} activity={live.activity} />
        </Panel>
        <Panel title="Spec" className={styles.sidePanel}>
          <div className={styles.stack}>
            <ReviewBar detail={detail} onMoved={onMoved} />
            {detail.spec ? (
              <SpecView spec={detail.spec} brief={detail.brief} />
            ) : (
              <p className={styles.muted}>The spec writer is writing the spec…</p>
            )}
          </div>
        </Panel>
      </div>
    );
  }

  if (detail.lane === "plan") {
    return (
      <div className={styles.columns}>
        <Panel title="Planner" className={styles.chatPanel}>
          <Chat detail={detail} streaming={live.streaming} activity={live.activity} />
        </Panel>
        <div className={styles.sidePanel}>
          <PlanPanel detail={detail} />
        </div>
      </div>
    );
  }

  if (detail.lane === "build") {
    return (
      <div className={styles.columns}>
        <Panel title="Developer" className={styles.chatPanel}>
          <Chat detail={detail} streaming={live.streaming} activity={live.activity} />
        </Panel>
        <div className={`${styles.sidePanel} ${styles.stack}`}>
          {detail.check && detail.check.bugs.length > 0 ? (
            <Panel title="Check found">
              <CheckView check={detail.check} />
            </Panel>
          ) : null}
          <PlanPanel detail={detail} />
        </div>
      </div>
    );
  }

  if (detail.lane === "check") {
    return (
      <div className={styles.columns}>
        <Panel title="Reviewer" className={styles.chatPanel}>
          <Chat detail={detail} streaming={live.streaming} activity={live.activity} />
        </Panel>
        <div className={`${styles.sidePanel} ${styles.stack}`}>
          {detail.check ? (
            <Panel title="Check">
              <CheckView check={detail.check} />
            </Panel>
          ) : null}
          <BuildPanel detail={detail} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.columns}>
      <Panel title="Product owner" className={styles.chatPanel}>
        <div className={styles.stack}>
          <Chat detail={detail} streaming={live.streaming} activity={live.activity} />
          {detail.lane === "refine" ? <GoodBar detail={detail} onMoved={onMoved} /> : null}
        </div>
      </Panel>
      <Panel title="Brief" className={styles.briefPanel}>
        <BriefPanel brief={detail.brief} />
      </Panel>
    </div>
  );
}

export function Card() {
  const { id } = useParams();
  const { live, error, reload } = useCardLive(id);

  return (
    <>
      <Header />
      <main className={styles.main}>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {!live && !error ? <p className={styles.loading}>Loading the card…</p> : null}
        {live ? (
          <>
            <div className={styles.top}>
              <p className={styles.crumbs}>
                <Link to="/">Board</Link> › {live.detail.projectName}
              </p>
              <div className={styles.titleRow}>
                <h1 className={styles.title}>{live.detail.title}</h1>
                {live.detail.state === "working" ? (
                  <Badge tone="working">▶ working</Badge>
                ) : (
                  <Badge tone="needs-you">● needs you</Badge>
                )}
              </div>
              {live.detail.branch || live.detail.worktreePath ? (
                <p className={styles.where}>
                  {live.detail.branch ? <Chip mono>{live.detail.branch}</Chip> : null}{" "}
                  {live.detail.worktreePath ? <Chip mono>{live.detail.worktreePath}</Chip> : null}
                </p>
              ) : null}
              <LaneSteps current={live.detail.lane} />
            </div>
            <LaneView live={live} onMoved={() => void reload()} />
          </>
        ) : null}
      </main>
    </>
  );
}
