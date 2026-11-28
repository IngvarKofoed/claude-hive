// The card page's and For you's side of the lane actions (docs/specs/2026-11-28-for-you-actions.md): the definition in
// packages/shared, read from the live CardDetail, the api call behind each action that takes no body, and the context
// a card-page component reports a pressed action through.
import { createContext, useContext } from "react";
import { laneActions, type CardDetail, type LaneActionId, type LaneActionState, type ShipPlan } from "@hive/shared";
import { api } from "../api/client";

/** What the card page knows that the card doesn't carry: Ship's plan, once read, and Try it's feedback box. */
export interface LaneActionExtras {
  shipPlan?: ShipPlan | null;
  hasFeedback?: boolean;
}

/** The card's lane actions as they stand now, from the live card. */
export function laneActionsFor(detail: CardDetail, extras: LaneActionExtras = {}): LaneActionState[] {
  return laneActions({
    lane: detail.lane,
    turnRunning: detail.turnRunning,
    pending: detail.pending !== null,
    lastChat: detail.chat.at(-1) ?? null,
    spec: detail.spec ? { review: detail.spec.review, hasText: detail.spec.text !== null } : null,
    issues: detail.issues.map((issue) => issue.status),
    // `landing` comes only with a full load; the live card.updated event carries `state`, which is working while it lands.
    landing: detail.landing || (detail.lane === "ship" && detail.state === "working"),
    shipPlan: extras.shipPlan ?? null,
    hasFeedback: extras.hasFeedback ?? false,
    mockup: detail.mockup,
    sendBack: detail.sendBack !== null,
  });
}

/** The action with this id, if it's on offer. */
export function actionOf(actions: readonly LaneActionState[], id: LaneActionId): LaneActionState | undefined {
  return actions.find((action) => action.id === id);
}

/** Land on main, and Discard them and land when the plan lists uncommitted work, for a Ship card that isn't landing. */
export function landActions(plan: ShipPlan): LaneActionState[] {
  return laneActions({
    lane: "ship",
    turnRunning: false,
    pending: false,
    lastChat: null,
    spec: null,
    issues: [],
    landing: false,
    shipPlan: plan,
    hasFeedback: false,
  }).filter((action) => action.id === "land" || action.id === "discard-and-land");
}

/** The actions you press without filling anything in. Start and Send back keep their forms. */
export type LaneActionCall = Exclude<LaneActionId, "start" | "send-back">;

/** Each such action's api call, the same route on the card page and For you. Wrapped, so a test's spy on `api` holds. */
export const LANE_ACTION_CALLS: Record<LaneActionCall, (cardId: string) => Promise<unknown>> = {
  good: (id) => api.good(id, { skipMockup: false }),
  "skip-mockup": (id) => api.good(id, { skipMockup: true }),
  keep: (id) => api.good(id, { keep: true }),
  "dont-keep": (id) => api.good(id, { keep: false }),
  review: (id) => api.review(id),
  signoff: (id) => api.signoff(id),
  retry: (id) => api.retry(id),
  "back-to-spec": (id) => api.backToSpec(id),
  "back-to-build": (id) => api.backToBuild(id),
  "move-on": (id) => api.moveOn(id),
  accept: (id) => api.accept(id),
  land: (id) => api.land(id),
  "discard-and-land": (id) => api.land(id, true),
  "back-to-tryit": (id) => api.backToTryIt(id),
  stop: (id) => api.stop(id),
};

/**
 * What a component calls after a lane action's call resolved, Stop included, and never after a refusal
 * (docs/specs/2026-11-28-back-to-for-you-after-a-lane-action.md). The Card page provides it and decides what follows;
 * outside it, as on For you and in a component's own tests, it does nothing.
 */
const LaneActionDone = createContext<(id: LaneActionId) => void>(() => {});
export const LaneActionDoneProvider = LaneActionDone.Provider;

/** The page's handler for a lane action that succeeded. */
export function useLaneActionDone(): (id: LaneActionId) => void {
  return useContext(LaneActionDone);
}
