import type { HiveEvent, ProjectChatDetail } from "@hive/shared";

export interface ProjectChatLive {
  detail: ProjectChatDetail;
  /** Text of the block being written; cleared when the finished message arrives. */
  streaming: string;
  /** The passing activity line. */
  activity: string | null;
}

/** Apply one event to a project chat page's state, the way `applyCardEvent` does for a card. Other chats' events change nothing. */
export function applyProjectChatEvent(state: ProjectChatLive, event: HiveEvent): ProjectChatLive {
  const id = state.detail.id;
  switch (event.type) {
    case "projectChat.updated": {
      // The summary's fields, and the turn's end: an idle chat runs nothing, so a block cut off by Stop goes, as
      // turn.ended clears it on a card. The draft comes with a refetch.
      if (event.chat.id !== id) return state;
      const detail = { ...state.detail, ...event.chat };
      if (event.chat.state === "working") return { ...state, detail: { ...detail, turnRunning: true } };
      if (event.chat.state === "idle") return { streaming: "", activity: null, detail: { ...detail, turnRunning: false } };
      return { ...state, detail };
    }
    case "projectChat.delta":
      if (event.chatId !== id) return state;
      return { ...state, streaming: state.streaming + event.text };
    case "projectChat.message": {
      if (event.chatId !== id) return state;
      const exists = state.detail.chat.some((item) => item.id === event.item.id);
      const chat = exists ? state.detail.chat : [...state.detail.chat, event.item];
      // Your own message, sent mid-turn, doesn't finish the block being written.
      const yours = event.item.kind === "message" && event.item.from === "you";
      return { ...state, streaming: yours ? state.streaming : "", detail: { ...state.detail, chat } };
    }
    case "projectChat.activity":
      if (event.chatId !== id) return state;
      return { ...state, activity: event.text };
    case "projectChat.pending":
      if (event.chatId !== id) return state;
      return { ...state, detail: { ...state.detail, pending: event.pending } };
    case "card.deleted": {
      // A "Made an idea" note loses its link when its card goes; a refetch gets the same from the server.
      if (!state.detail.chat.some((item) => item.kind === "message" && item.cardId === event.cardId)) return state;
      const chat = state.detail.chat.map((item) => {
        if (item.kind !== "message" || item.cardId !== event.cardId) return item;
        const { cardId: _gone, ...rest } = item;
        return rest;
      });
      return { ...state, detail: { ...state.detail, chat } };
    }
    default:
      return state;
  }
}
