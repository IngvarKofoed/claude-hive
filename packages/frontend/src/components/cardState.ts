import type { CardDetail, HiveEvent } from "@hive/shared";

export interface CardLive {
  detail: CardDetail;
  /** Text of the block being written; cleared when the finished message arrives. */
  streaming: string;
  /** The passing activity line. */
  activity: string | null;
}

/** Apply one event to the card page's state. Events for other cards change nothing. */
export function applyCardEvent(state: CardLive, event: HiveEvent): CardLive {
  const id = state.detail.id;
  switch (event.type) {
    case "card.updated":
      if (event.card.id !== id) return state;
      return { ...state, detail: { ...state.detail, ...event.card } };
    case "chat.delta":
      if (event.cardId !== id) return state;
      return { ...state, streaming: state.streaming + event.text };
    case "chat.message": {
      if (event.cardId !== id) return state;
      const exists = state.detail.chat.some((item) => item.id === event.item.id);
      const chat = exists ? state.detail.chat : [...state.detail.chat, event.item];
      // Your own message, sent mid-turn, doesn't finish the block being written.
      const yours = event.item.kind === "message" && event.item.from === "you";
      return { ...state, streaming: yours ? state.streaming : "", detail: { ...state.detail, chat } };
    }
    case "chat.activity":
      if (event.cardId !== id) return state;
      return { ...state, activity: event.text };
    case "brief.updated":
      if (event.cardId !== id) return state;
      return { ...state, detail: { ...state.detail, brief: event.brief } };
    case "spec.updated":
      if (event.cardId !== id) return state;
      return { ...state, detail: { ...state.detail, spec: event.spec } };
    case "plan.updated":
      if (event.cardId !== id) return state;
      return { ...state, detail: { ...state.detail, plan: event.plan } };
    case "check.updated":
      // A round that stops the card in Check doesn't change its lane, so nothing else refetches it.
      if (event.cardId !== id) return state;
      return { ...state, detail: { ...state.detail, check: event.check, issues: event.issues } };
    case "setup.updated":
      if (event.cardId !== id) return state;
      return { ...state, detail: { ...state.detail, setup: event.setup, port: event.port } };
    case "app.updated":
      if (event.cardId !== id) return state;
      return { ...state, detail: { ...state.detail, apps: event.apps, appStopped: event.appStopped } };
    case "pending.updated":
      if (event.cardId !== id) return state;
      return { ...state, detail: { ...state.detail, pending: event.pending } };
    case "turn.started":
      if (event.cardId !== id) return state;
      return { ...state, detail: { ...state.detail, turnRunning: true } };
    case "turn.ended":
      if (event.cardId !== id) return state;
      return { ...state, streaming: "", activity: null, detail: { ...state.detail, turnRunning: false } };
    default:
      return state;
  }
}
