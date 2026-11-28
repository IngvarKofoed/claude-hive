import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { ProjectChatSummary } from "@hive/shared";
import { Header } from "../components/Header";
import { ProjectChatList } from "../components/ProjectChatList";
import { ProjectChatPane } from "../components/ProjectChatPane";
import { useProjectChatList } from "../components/useProjectChatList";
import { useProjectChatLive } from "../components/useProjectChatLive";
import styles from "./ProjectChat.module.css";

/**
 * A chat with a project (docs/specs/2026-11-28-chat-with-a-project-then-make-it-an-idea.md): the project's chats on the
 * left, and this chat, with the idea's draft form under its log, taking the rest. Without a chat id it is a new chat, made by
 * its first message.
 */
export function ProjectChat() {
  const { projectId = "", chatId } = useParams();
  const navigate = useNavigate();
  const list = useProjectChatList(projectId);
  const { live, error, reload, gone } = useProjectChatLive(chatId);
  const newChatPath = `/projects/${projectId}/chat`;

  // This chat was deleted, here or in another tab: on to a new one.
  useEffect(() => {
    if (gone) navigate(newChatPath, { replace: true });
  }, [gone, navigate, newChatPath]);

  function created(chat: ProjectChatSummary) {
    list.add(chat);
    navigate(`${newChatPath}/${chat.id}`);
  }

  function deleted(id: string) {
    list.remove(id);
    if (id === chatId) navigate(newChatPath);
  }

  const projectName = live?.detail.projectName ?? list.projectName;
  const loading = chatId !== undefined && !live && !error;

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <h1 className={styles.title}>{projectName ?? "Project"}</h1>
        {list.error ? (
          <p className={styles.error} role="alert">
            {list.error}
          </p>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.columns}>
          <ProjectChatList
            projectId={projectId}
            chats={list.chats}
            currentId={chatId}
            onNew={() => navigate(newChatPath)}
            onDeleted={deleted}
          />
          {loading ? (
            <p className={styles.loading}>Loading the chat…</p>
          ) : error ? (
            <p className={styles.loading}>
              <Link to={newChatPath}>Start a new chat</Link>
            </p>
          ) : (
            <ProjectChatPane
              projectId={projectId}
              chatId={chatId}
              live={live}
              onCreated={created}
              onChanged={() => void reload()}
            />
          )}
        </div>
      </main>
    </div>
  );
}
