// A project chat's summary, as the board and the chat list show it. Pure, and free of hive.ts, so hive.ts can import it
// while chats/index.ts imports hive.ts (docs/specs/2026-11-28-chat-with-a-project-then-make-it-an-idea.md).
import type { ProjectChatSummary } from "@hive/shared";
import type { ChatRow } from "../db";

/** asking while a question waits, working while a turn runs, otherwise idle. */
export function chatSummary(row: ChatRow): ProjectChatSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    state: row.pending ? "asking" : row.turnRunning ? "working" : "idle",
    updatedAt: row.updatedAt,
  };
}
