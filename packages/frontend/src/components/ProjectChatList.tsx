import { useState } from "react";
import { Link } from "react-router";
import type { ProjectChatSummary } from "@hive/shared";
import { api } from "../api/client";
import { ago } from "./ago";
import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";
import styles from "./ProjectChatList.module.css";

interface Props {
  projectId: string;
  chats: ProjectChatSummary[];
  /** The open chat; undefined on the new-chat page. */
  currentId: string | undefined;
  onNew: () => void;
  /** A chat was deleted from here. */
  onDeleted: (id: string) => void;
}

/** One chat in the list, on one line: its title, how long ago it was active, ● when it asks, and Delete, which confirms under the line. */
function ChatRow({ projectId, chat, current, onDeleted }: { projectId: string; chat: ProjectChatSummary; current: boolean; onDeleted: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteChat(chat.id);
      onDeleted(chat.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the chat.");
      setDeleting(false);
    }
  }

  return (
    <li className={styles.item} data-current={current || undefined}>
      <div className={styles.line}>
        <Link to={`/projects/${projectId}/chat/${chat.id}`} className={styles.link} aria-current={current ? "page" : undefined}>
          <span className={styles.title} title={chat.title}>
            {chat.title}
          </span>
          <span className={styles.ago}>{ago(chat.updatedAt, Date.now())}</span>
        </Link>
        {chat.state === "asking" ? (
          <span className={styles.dot} role="img" aria-label="A question waits" title="A question waits">
            ●
          </span>
        ) : null}
        {confirming ? null : (
          <Button compact variant="ghost" className={styles.delete} aria-label={`Delete ${chat.title}`} onClick={() => setConfirming(true)}>
            Delete
          </Button>
        )}
      </div>
      {confirming ? (
        <div className={styles.confirm} role="group" aria-label="Delete this chat">
          <p>Delete this chat? Ideas made from it keep their copy.</p>
          <div className={styles.actions}>
            <Button compact variant="primary" disabled={deleting} onClick={() => void remove()}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
            <Button compact disabled={deleting} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The page's left column: its title with a small New chat on the right of the same line, then the project's chats,
 * newest first. The title is drawn here rather than by Panel, so the button can share its line without sitting in the
 * heading.
 */
export function ProjectChatList({ projectId, chats, currentId, onNew, onDeleted }: Props) {
  return (
    <Panel className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.heading}>Chats</h2>
        <Button compact variant="primary" onClick={onNew} className={styles.new}>
          New chat
        </Button>
      </div>
      {chats.length > 0 ? (
        <ul className={styles.list}>
          {chats.map((chat) => (
            <ChatRow key={chat.id} projectId={projectId} chat={chat} current={chat.id === currentId} onDeleted={onDeleted} />
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>No chats yet.</p>
      )}
    </Panel>
  );
}
