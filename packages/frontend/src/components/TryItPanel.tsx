import { useState } from "react";
import type { CardDetail } from "@hive/shared";
import { api } from "../api/client";
import { outcomeSection } from "./outcome";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Markdown } from "./ui/Markdown";
import { Panel } from "./ui/Panel";
import styles from "./TryItPanel.module.css";

interface Props {
  detail: CardDetail;
  /** Called after Send to Build or Accept succeeds, so the page can load the card in its new lane. */
  onMoved: () => void;
}

const stateLabel = {
  starting: "Starting…",
  running: "Running",
  stopped: "Stopped",
} as const;
const stateTone = {
  starting: "working",
  running: "done",
  stopped: "stopped",
} as const;

function TheApp({
  detail,
  onError,
}: {
  detail: CardDetail;
  onError: (message: string) => void;
}) {
  const setup = detail.setup;
  const apps = detail.apps;
  const setupDone = setup?.status === "done";
  const canStart =
    apps.some((a) => a.state === "stopped") || (apps.length === 0 && setupDone);
  const canStop = apps.some(
    (a) => a.state === "starting" || a.state === "running",
  );

  async function call(action: (id: string) => Promise<unknown>) {
    try {
      await action(detail.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className={styles.section}>
      <h3 className={styles.heading}>The app</h3>
      {setup?.status === "running" ? (
        <p className={styles.muted}>Preparing…</p>
      ) : null}
      {setupDone ? (
        <div className={styles.actions}>
          {canStart ? (
            <Button compact onClick={() => call(api.appStart)}>
              Start
            </Button>
          ) : null}
          {canStop ? (
            <Button compact onClick={() => call(api.appStop)}>
              Stop
            </Button>
          ) : null}
          <Button compact onClick={() => call(api.appRestart)}>
            Restart
          </Button>
        </div>
      ) : null}
      {apps.map((app, i) => (
        <div key={`${i}:${app.what}`} className={styles.command}>
          <div className={styles.appHead}>
            <span className={styles.what}>{app.what}</span>
            <Badge tone={stateTone[app.state]}>{stateLabel[app.state]}</Badge>
          </div>
          {app.url ? (
            app.state === "running" ? (
              <a href={app.url} target="_blank" rel="noreferrer">
                {app.url}
              </a>
            ) : (
              <span className={styles.muted}>{app.url}</span>
            )
          ) : null}
          {app.state === "stopped" && app.reason ? (
            <p className={styles.reason}>{app.reason}</p>
          ) : null}
          {app.output.length > 0 ? (
            <details>
              <summary>Output</summary>
              <pre className={styles.output}>{app.output.join("\n")}</pre>
            </details>
          ) : null}
        </div>
      ))}
      {setupDone && apps.length === 0
        ? setup.start.map((item) => (
            <div
              key={`${item.what}:${item.command}`}
              className={styles.command}
            >
              <span className={styles.what}>{item.what}</span>
              <code className={styles.mono}>{item.command}</code>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.url}
                </a>
              ) : null}
            </div>
          ))
        : null}
      {detail.worktreePath ? (
        <p className={styles.mono}>{detail.worktreePath}</p>
      ) : null}
      {setupDone && setup.test ? (
        <div className={styles.command}>
          <span className={styles.what}>Tests</span>
          <code className={styles.mono}>{setup.test}</code>
        </div>
      ) : null}
      {setupDone && setup.shared.length > 0 ? (
        <div className={styles.warning} role="note">
          Shared with your checkout
          <ul>
            {setup.shared.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {!setup || setup.status === "failed" ? (
        <>
          <p className={styles.muted}>
            This worktree has no local files from your checkout yet, and no
            command to start it on the card&apos;s ports.
          </p>
          {setup?.reason ? (
            <p className={styles.reason}>{setup.reason}</p>
          ) : null}
        </>
      ) : null}
      {setup?.status !== "running" ? (
        <div className={styles.actions}>
          <Button compact onClick={() => call(api.setup)}>
            {setupDone ? "Prepare it again" : "Prepare it"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function TryItPanel({ detail, onMoved }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guide = outcomeSection(detail.spec?.text ?? null);
  const earlier = detail.history.tryit.flatMap((round) => (round.kind === "feedback" ? [round.text] : []));

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setError(null);
    setBusy(true);
    try {
      await action();
      after?.();
      onMoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Try it">
      <div className={styles.panel}>
        <TheApp detail={detail} onError={setError} />
        <div className={styles.section}>
          <h3 className={styles.heading}>Test guide</h3>
          {guide ? (
            <Markdown>{guide}</Markdown>
          ) : (
            <p className={styles.muted}>The spec has no Outcome section.</p>
          )}
        </div>
        <div className={styles.section}>
          <h3 className={styles.heading}>Your call</h3>
          <textarea
            className={styles.feedback}
            aria-label="What you found"
            placeholder="What you found, if anything"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className={styles.actions}>
            <Button
              variant="primary"
              disabled={busy || text.trim() === ""}
              onClick={() =>
                run(
                  () => api.feedback(detail.id, text.trim()),
                  () => setText(""),
                )
              }
            >
              Send to Build
            </Button>
            <Button
              disabled={busy}
              onClick={() => run(() => api.accept(detail.id))}
            >
              Accept
            </Button>
          </div>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          {earlier.length > 0 ? (
            <details>
              <summary>Your earlier feedback</summary>
              <div className={styles.earlier}>
                {earlier.map((text, index) => (
                  <div key={earlier.length - index}>
                    <h4 className={styles.heading}>Feedback {earlier.length - index}</h4>
                    <p className={styles.feedbackText}>{text}</p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
