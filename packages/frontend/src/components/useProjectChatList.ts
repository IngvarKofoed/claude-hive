import { useCallback, useEffect, useState } from "react";
import type { ProjectChatSummary } from "@hive/shared";
import { api } from "../api/client";
import { useHiveEvents, useStreamOpen } from "../api/events";

/** Newest activity first, as the server lists them. */
const newestFirst = (a: ProjectChatSummary, b: ProjectChatSummary) => b.updatedAt.localeCompare(a.updatedAt);

function upsert(list: ProjectChatSummary[], chat: ProjectChatSummary): ProjectChatSummary[] {
  return [chat, ...list.filter((c) => c.id !== chat.id)].sort(newestFirst);
}

/**
 * The project's chats for the page's left column, and its name for the top band. Kept current by `projectChat.updated`
 * and `projectChat.deleted` for this project, and refetched when the stream (re)connects.
 */
export function useProjectChatList(projectId: string | undefined) {
  const [projectName, setProjectName] = useState<string | null>(null);
  const [chats, setChats] = useState<ProjectChatSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const list = await api.projectChats(projectId);
      setProjectName(list.projectName);
      setChats(list.chats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the chats.");
    }
  }, [projectId]);

  useEffect(() => {
    setProjectName(null);
    setChats([]);
    void load();
  }, [load]);

  useHiveEvents((event) => {
    if (event.type === "projectChat.updated" && event.chat.projectId === projectId) {
      setChats((prev) => upsert(prev, event.chat));
    } else if (event.type === "projectChat.deleted") {
      setChats((prev) => prev.filter((chat) => chat.id !== event.chatId));
    }
  });
  useStreamOpen(() => void load());

  const add = useCallback((chat: ProjectChatSummary) => setChats((prev) => upsert(prev, chat)), []);
  const remove = useCallback((id: string) => setChats((prev) => prev.filter((chat) => chat.id !== id)), []);

  return { projectName, chats, error, add, remove };
}
