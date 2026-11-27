import { Link, useParams } from "react-router";
import { laneImplemented, type CardDetail } from "@hive/shared";
import { BriefPanel } from "../components/BriefPanel";
import { BuildView } from "../components/BuildView";
import { Chat } from "../components/Chat";
import { GoodBar } from "../components/GoodBar";
import { Header } from "../components/Header";
import { LaneSteps } from "../components/LaneSteps";
import { PlanView } from "../components/PlanView";
import { ReviewBar } from "../components/ReviewBar";
import { SpecView } from "../components/SpecView";
import { useCardLive } from "../components/useCardLive";
import { Badge } from "../components/ui/Badge";
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

function LaneView({ live, onMoved }: { live: CardLive; onMoved: () => void }) {
  const { detail } = live;

  if (!laneImplemented(detail.lane)) {
    return (
      <>
        <Panel tone="warning" role="status">
          This lane isn&apos;t implemented yet
        </Panel>
        <div className={styles.columns}>
          {detail.spec ? (
            <Panel title="Spec">
              <SpecView spec={detail.spec} brief={detail.brief} />
            </Panel>
          ) : null}
          {/* The newest work first: the build report sits above the plan, beside the spec, not under it. */}
          <div className={styles.stack}>
            {detail.build || detail.issues.length > 0 || detail.decisions.length > 0 ? (
              <Panel title="Build">
                <BuildView build={detail.build} issues={detail.issues} decisions={detail.decisions} />
              </Panel>
            ) : null}
            {detail.plan ? <PlanPanel detail={detail} /> : null}
          </div>
        </div>
      </>
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
        <div className={styles.sidePanel}>
          <PlanPanel detail={detail} />
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
