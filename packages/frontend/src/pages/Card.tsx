import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { CardDetail, HiveEvent } from "@hive/shared";
import { api } from "../api/client";
import { useHiveEvents, useStreamOpen } from "../api/events";
import { BriefPanel } from "../components/BriefPanel";
import { applyCardEvent, type CardLive } from "../components/cardState";
import { Chat } from "../components/Chat";
import { Header } from "../components/Header";
import { LaneSteps } from "../components/LaneSteps";
import { Badge } from "../components/ui/Badge";
import { Chip } from "../components/ui/Chip";
import { Panel } from "../components/ui/Panel";
import styles from "./Card.module.css";

export function Card() {
  const { id } = useParams();
  const [live, setLive] = useState<CardLive | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const detail: CardDetail = await api.card(id);
      setLive({ detail, streaming: "", activity: null });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the card.");
    }
  }, [id]);

  useEffect(() => {
    setLive(null);
    void load();
  }, [load]);

  useHiveEvents((event: HiveEvent) => {
    setLive((prev) => (prev ? applyCardEvent(prev, event) : prev));
  });

  // Whatever happened while the stream was down (a hive restart, a slow connect) is in the card itself.
  useStreamOpen(() => void load());

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
            <div className={styles.columns}>
              <Panel title="Product owner" className={styles.chatPanel}>
                <Chat detail={live.detail} streaming={live.streaming} activity={live.activity} />
              </Panel>
              <Panel title="Brief" className={styles.briefPanel}>
                <BriefPanel brief={live.detail.brief} />
              </Panel>
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}
