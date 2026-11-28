import { useRef, useState, type KeyboardEvent } from "react";
import { IDEA_DRAFTING, ideaDraftBlock, type ProjectChatSummary } from "@hive/shared";
import { api } from "../api/client";
import { IdeaDraftForm } from "./IdeaDraftForm";
import { ChatLog, type ChatLogHandle } from "./ChatLog";
import type { AnswerFn } from "./PendingCard";
import type { ProjectChatLive } from "./projectChatState";
import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";
import styles from "./ProjectChatPane.module.css";

interface Props {
  projectId: string;
  /** The open chat; undefined on the new-chat page, where the first Send makes it. */
  chatId: string | undefined;
  /** The chat's live state; null for a new chat. */
  live: ProjectChatLive | null;
  /** The first Send made the chat. */
  onCreated: (chat: ProjectChatSummary) => void;
  /** The draft form added an idea or closed: fetch the chat again. */
  onChanged: () => void;
}

/** The chat column: the log, the draft form while one is open, the reply box, Stop while a turn runs, and Make it an idea at the end of the Send row. */
export function ProjectChatPane({ projectId, chatId, live, onCreated, onChanged }: Props) {
  const detail = live?.detail ?? null;
  const drafting = detail?.draft?.status === "drafting";
  const block = ideaDraftBlock({
    hasReply: detail?.chat.some((item) => item.kind === "message" && item.from === "project-chat") ?? false,
    turnRunning: detail?.turnRunning ?? false,
    asking: (detail?.pending ?? null) !== null,
    draftOpen: (detail?.draft ?? null) !== null,
  });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<ChatLogHandle>(null);

  async function send() {
    const body = text.trim();
    if (!body || drafting) return;
    setError(null);
    try {
      if (chatId) {
        await api.sendChatMessage(chatId, { text: body });
        setText("");
        logRef.current?.jumpToBottom();
      } else {
        const chat = await api.newProjectChat(projectId, { text: body });
        setText("");
        onCreated(chat);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the message.");
    }
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  // A chat asks only questions, so a permission card never comes; its answer has nowhere to go.
  const answer: AnswerFn = (itemId, body) =>
    chatId && "answers" in body
      ? api.answerChat(chatId, { itemId, answers: body.answers })
      : Promise.reject(new Error("A chat asks only questions."));

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  }

  return (
    <Panel title="Chat" className={styles.panel}>
      <ChatLog
        ref={logRef}
        framed
        items={detail?.chat ?? []}
        streaming={live?.streaming ?? ""}
        streamingFrom="project-chat"
        activity={live?.activity ?? null}
        // The draft turn is quiet: the reply box says Claude is drafting, and the log shows no thinking line for it.
        turnRunning={(detail?.turnRunning ?? false) && !drafting}
        pending={detail?.pending ?? null}
        onError={setError}
        answer={answer}
        emptyText="Ask about the project's code, docs or history."
      />
      {detail?.draft && chatId ? (
        <IdeaDraftForm projectId={projectId} chatId={chatId} draft={detail.draft} onChanged={onChanged} />
      ) : null}
      <div className={styles.footer}>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <form
          className={styles.reply}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label className={styles.label} htmlFor="chat-reply">
            Your message
          </label>
          <textarea
            id="chat-reply"
            className={styles.input}
            rows={3}
            value={text}
            disabled={drafting}
            onKeyDown={onKeyDown}
            onChange={(event) => setText(event.target.value)}
          />
          {drafting ? <p className={styles.hint}>{IDEA_DRAFTING}</p> : null}
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={drafting || !text.trim()}>
              Send
            </Button>
            {detail?.turnRunning && chatId ? <Button onClick={() => void run(() => api.stopChat(chatId))}>Stop</Button> : null}
            <div className={styles.end}>
              <Button
                disabled={block !== null || !chatId}
                title={block ?? undefined}
                onClick={() => chatId && void run(() => api.draftIdea(chatId))}
              >
                Make it an idea
              </Button>
            </div>
          </div>
        </form>
      </div>
    </Panel>
  );
}
