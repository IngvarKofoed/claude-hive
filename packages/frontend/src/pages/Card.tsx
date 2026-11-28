import { Link, useParams, useSearchParams } from "react-router";
import { api } from "../api/client";
import { LANES, laneImplemented, lanesBefore, type CardDetail, type Lane } from "@hive/shared";
import { BriefPanel } from "../components/BriefPanel";
import { BuildView } from "../components/BuildView";
import { BuildRoundView } from "../components/BuildRoundView";
import { Rounds, roundNumber } from "../components/Rounds";
import { CheckView } from "../components/CheckView";
import { ChecklistView } from "../components/ChecklistView";
import { CardTitle } from "../components/CardTitle";
import { DeleteCard } from "../components/DeleteCard";
import { Chat, PastChat } from "../components/Chat";
import { GoodBar } from "../components/GoodBar";
import { Header } from "../components/Header";
import { IdeaPanel } from "../components/IdeaPanel";
import { IdeaView } from "../components/IdeaView";
import { LaneSteps } from "../components/LaneSteps";
import { DonePanel, ShipPanel } from "../components/ShipPanel";
import { TryItPanel } from "../components/TryItPanel";
import { PlanView } from "../components/PlanView";
import { ReviewBar } from "../components/ReviewBar";
import { SpecView } from "../components/SpecView";
import { useCardLive } from "../components/useCardLive";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
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
      <BuildView build={detail.build} issues={detail.issues} decisions={detail.decisions} lane={detail.lane} />
    </Panel>
  );
}

const laneName = (lane: Lane) => LANES.find((l) => l.id === lane)?.name ?? lane;

/**
 * The lanes a card can be looked back at: the ones before its own, except a lane that isn't built, which it skipped
 * (docs/specs/2026-11-27-card-lane-artifacts.md).
 */
export function lookBackLanes(current: Lane): Lane[] {
  return lanesBefore(current).filter(laneImplemented);
}

/** Who a finished lane's chat was with, as the left panel's title. */
const PAST_CHAT_TITLE: Partial<Record<Lane, string>> = {
  refine: "Product owner",
  spec: "Spec writer",
  plan: "Planner",
  build: "Developer",
  check: "Reviewer",
  tryit: "Try it",
  ship: "Landing",
};

/** What a finished lane produced, for the right-hand column. */
function PastArtifact({ detail, lane }: { detail: CardDetail; lane: Lane }) {
  const none = (text: string) => <p className={styles.muted}>{text}</p>;
  const history = detail.history;
  switch (lane) {
    case "ideas":
      return (
        <Panel title="Idea">
          <IdeaView title={detail.ideaTitle} text={detail.ideaText} />
        </Panel>
      );
    case "refine":
      return (
        <Panel title="Brief">
          <BriefPanel brief={detail.brief} />
        </Panel>
      );
    case "spec":
      return (
        <Panel title="Spec">
          {detail.spec?.text != null
            ? <SpecView spec={detail.spec} />
            : none(
                // Only a landed card's spec is on main; any other card's should be in its worktree, but isn't.
                detail.specPath && detail.landed
                  ? `The spec can't be shown here: it's on main at ${detail.specPath}.`
                  : "The spec can't be shown here.",
              )}
        </Panel>
      );
    case "plan":
      if (history.plans.length > 0) {
        return (
          <Panel title="Plan">
            <Rounds
              rounds={history.plans.map((plan, i) => ({
                heading: `Plan ${roundNumber(history.plans.length, i)}`,
                content: <PlanView plan={plan} />,
              }))}
            />
          </Panel>
        );
      }
      return <Panel title="Plan">{detail.plan ? <PlanView plan={detail.plan} /> : none("No plan is kept.")}</Panel>;
    case "build":
      if (history.builds.length > 0) {
        return (
          <Panel title="Build">
            <Rounds
              rounds={history.builds.map((round, i) => ({
                heading: `Round ${roundNumber(history.builds.length, i)}`,
                content: <BuildRoundView round={round} files={i === 0 ? detail.build?.files : undefined} />,
              }))}
            />
          </Panel>
        );
      }
      return (
        <Panel title="Build">
          {detail.build || detail.issues.length > 0 || detail.decisions.length > 0
            ? <BuildView build={detail.build} issues={detail.issues} decisions={detail.decisions} lane={detail.lane} />
            : none("No build report is kept.")}
        </Panel>
      );
    case "check":
      if (history.checks.length > 0) {
        return (
          <Panel title="Check">
            <Rounds
              rounds={history.checks.map((record, i) => {
                const n = roundNumber(history.checks.length, i);
                return {
                  heading: `Round ${n}`,
                  content: <CheckView check={record} round={n} issues={record.issues} heading={false} />,
                };
              })}
            />
          </Panel>
        );
      }
      return <Panel title="Check">{detail.check ? <CheckView check={detail.check} /> : none("No Check round is kept.")}</Panel>;
    case "tryit": {
      if (history.tryit.length > 0) {
        const accepted = history.tryit[0]?.kind === "accepted";
        const feedback = history.tryit.flatMap((round) => (round.kind === "feedback" ? [round.text] : []));
        const rounds = feedback.map((text, i) => ({
          heading: `Feedback ${roundNumber(feedback.length, i)}`,
          content: <p className={styles.feedbackText}>{text}</p>,
        }));
        return (
          <Panel title="Feedback">
            <div className={styles.stack}>
              {accepted ? <p>Accepted</p> : null}
              {rounds.length > 0 ? <Rounds rounds={rounds} /> : null}
            </div>
          </Panel>
        );
      }
      return <Panel title="Feedback">{none("No feedback or acceptance is kept.")}</Panel>;
    }
    case "ship":
      return <DonePanel landed={detail.landed} />;
    default:
      return null;
  }
}

/**
 * A finished lane, looked back at: its chat on the left and what it produced on the right. It is built only from
 * display components, never the live lane's bars and panels, so there is nothing here to press
 * (docs/specs/2026-11-27-card-lane-artifacts.md).
 */
export function PastLaneView({ detail, lane }: { detail: CardDetail; lane: Lane }) {
  return (
    <div className={styles.columns}>
      <Panel title={PAST_CHAT_TITLE[lane] ?? laneName(lane)}>
        <PastChat items={detail.pastChats[lane] ?? []} />
      </Panel>
      <PastArtifact detail={detail} lane={lane} />
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
        </Panel>
        <div className={styles.columns}>
          {detail.spec ? (
            <Panel title="Spec">
              <SpecView spec={detail.spec} />
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

  // The idea is the lane's artifact, so it sits on the right like every lane's. The left stays empty: Refine's chat
  // starts there.
  if (detail.lane === "ideas") {
    return (
      <div className={styles.columns}>
        <div className={styles.right}>
          <IdeaPanel detail={detail} onChanged={onMoved} />
        </div>
      </div>
    );
  }

  if (detail.lane === "ship") {
    return (
      <div className={styles.columns}>
        <div className={styles.stack}>
          <ShipPanel detail={detail} onMoved={onMoved} />
          <Panel title="Landing">
            <Chat key={detail.lane} detail={detail} streaming={live.streaming} activity={live.activity} />
          </Panel>
        </div>
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

  if (detail.lane === "done") {
    return (
      <div className={styles.columns}>
        <DonePanel landed={detail.landed} />
        <div className={styles.stack}>
          {detail.spec ? (
            <Panel title="Spec">
              <SpecView spec={detail.spec} />
            </Panel>
          ) : null}
          {detail.check ? (
            <Panel title="Check">
              <CheckView check={detail.check} />
            </Panel>
          ) : null}
          <BuildPanel detail={detail} />
          {detail.plan ? <PlanPanel detail={detail} /> : null}
        </div>
      </div>
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
          <Chat key={detail.lane} framed detail={detail} streaming={live.streaming} activity={live.activity} />
        </Panel>
        <Panel title="Spec" className={styles.specPanel}>
          <div className={styles.specHead}>
            <ReviewBar detail={detail} onMoved={onMoved} />
          </div>
          <div className={styles.specBody}>
            {detail.spec ? (
              <SpecView spec={detail.spec} />
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
          <Chat key={detail.lane} framed detail={detail} streaming={live.streaming} activity={live.activity} />
        </Panel>
        <PlanPanel detail={detail} />
      </div>
    );
  }

  if (detail.lane === "build") {
    return (
      <div className={styles.columns}>
        <Panel title="Developer" className={styles.chatPanel}>
          <Chat key={detail.lane} framed detail={detail} streaming={live.streaming} activity={live.activity} />
        </Panel>
        <div className={`${styles.sidePanel} ${styles.stack}`}>
          {detail.feedback ? (
            <Panel title={detail.shipAfterCheck ? "Sent back from Ship" : "Sent back from Try it"}>
              <p className={styles.feedbackText}>{detail.feedback}</p>
            </Panel>
          ) : null}
          {detail.check && detail.check.bugs.length > 0 ? (
            <Panel title="Check found">
              <CheckView check={detail.check} />
            </Panel>
          ) : null}
          <Panel title="Checklist">
            {detail.checklist && detail.checklist.length > 0 ? (
              <ChecklistView items={detail.checklist} />
            ) : (
              <p className={styles.muted}>The developer's checklist shows here once it starts one.</p>
            )}
          </Panel>
        </div>
      </div>
    );
  }

  if (detail.lane === "check") {
    return (
      <div className={styles.columns}>
        <Panel title="Reviewer" className={styles.chatPanel}>
          <Chat key={detail.lane} framed detail={detail} streaming={live.streaming} activity={live.activity} />
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
        <Chat
          key={detail.lane}
          framed
          detail={detail}
          streaming={live.streaming}
          activity={live.activity}
          sendRowEnd={<GoodBar detail={detail} onMoved={onMoved} />}
        />
      </Panel>
      <Panel title="Brief" className={styles.briefPanel}>
        <BriefPanel brief={detail.brief} />
      </Panel>
    </div>
  );
}

export function Card() {
  const { id } = useParams();
  const { live, error, reload, gone } = useCardLive(id);
  const [params] = useSearchParams();
  const asked = params.get("lane");
  // Anything that isn't a lane the card has finished (its own lane, a later one, a skipped one, Done, a typo, or a lane
  // that stopped being past since the link was made) shows the card's current lane.
  const viewing = live ? (lookBackLanes(live.detail.lane).find((lane) => lane === asked) ?? null) : null;

  return (
    <div className={styles.page}>
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
              <div className={styles.titleGroup}>
                <CardTitle
                  title={live.detail.title}
                  projectName={live.detail.projectName}
                  branch={live.detail.branch}
                  worktreePath={live.detail.worktreePath}
                />
                {/* An idea waits for Start, and a landed card needs nothing from you: no badge, as on the board. */}
                {live.detail.lane === "ideas" || live.detail.lane === "done" ? null : live.detail.state === "working" ? (
                  <Badge tone="working">▶ working</Badge>
                ) : (
                  <Badge tone="needs-you">● needs you</Badge>
                )}
              </div>
              <div className={styles.endGroup}>
                <LaneSteps current={live.detail.lane} viewing={viewing} navigable />
                <DeleteCard detail={live.detail} gone={gone} />
              </div>
            </div>
            {viewing ? (
              <>
                <p className={styles.lookingBack} role="status">
                  Looking back at {laneName(viewing)}. It&apos;s finished, so nothing here can be changed.{" "}
                  <Link to={{ search: "" }}>Back to {laneName(live.detail.lane)}</Link>
                </p>
                {/* Keyed by lane: Build and Check both fold "Round N", and a fold you opened in one mustn't open in the other. */}
                <PastLaneView key={viewing} detail={live.detail} lane={viewing} />
              </>
            ) : (
              <LaneView live={live} onMoved={() => void reload()} />
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
