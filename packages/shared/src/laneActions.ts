// Lane actions: what you can do to a card in a lane (docs/specs/2026-11-28-for-you-actions.md). One definition that
// the card page and For you both read, so the two can't disagree. It decides only what the page offers: the server's
// own guards stay as they are and have the last word.
import type { ChatItem, IssueStatus, Lane, ReviewState, ShipPlan } from "./index";

export type LaneActionId =
  | "start" | "good" | "review" | "signoff" | "retry" | "back-to-spec" | "back-to-build" | "move-on"
  | "send-to-build" | "accept" | "land" | "discard-and-land" | "back-to-tryit" | "stop";

/**
 * Each lane's actions, in display order. Every action an error line can carry is in its lane's list: an action left
 * out would drop off the error line (backend errorActions.test.ts checks every addError against it).
 */
export const LANE_ACTIONS = {
  ideas: ["start"],
  refine: ["good", "retry", "stop"],
  mockup: [], // comes with Mockup's slice
  spec: ["review", "signoff", "retry", "stop"],
  plan: ["retry", "back-to-spec", "stop"],
  build: ["retry", "back-to-spec", "stop"],
  check: ["retry", "back-to-build", "move-on", "back-to-spec", "stop"],
  tryit: ["send-to-build", "accept", "retry"],
  ship: ["land", "discard-and-land", "back-to-tryit", "retry", "back-to-build", "stop"],
  done: [],
} as const satisfies Record<Lane, readonly LaneActionId[]>;

/** Each action's one label, on the card page and For you alike. */
export const LANE_ACTION_LABEL: Record<LaneActionId, string> = {
  start: "Start",
  good: "Good",
  review: "Review",
  signoff: "Sign off",
  retry: "Retry",
  "back-to-spec": "Back to Spec",
  "back-to-build": "Back to Build",
  "move-on": "Move on",
  "send-to-build": "Send to Build",
  accept: "Accept",
  land: "Land on main",
  "discard-and-land": "Discard them and land",
  "back-to-tryit": "Back to Try it",
  stop: "Stop",
};

/** The page's main button for its lane. */
const PRIMARY: ReadonlySet<LaneActionId> = new Set<LaneActionId>(["good", "signoff", "send-to-build", "land"]);

/** One action on offer, as a button shows it: greyed with its reason when it isn't enabled. */
export interface LaneActionState {
  id: LaneActionId;
  label: string;
  primary: boolean;
  enabled: boolean;
  /** Why it's greyed, in the card page's words; null when enabled, or when greyed for want of input (an empty box). */
  reason: string | null;
}

/**
 * What an error line offers: retry the failed turn, run the review again, send a blocked plan or build back to Spec,
 * or, for a card that Check stopped, send it back to Build for one more round or move it on to Try it. Offered only
 * while the line is its lane's last chat line, and only the ones its lane lists.
 */
export type ErrorAction = Extract<LaneActionId, "retry" | "review" | "back-to-spec" | "back-to-build" | "move-on">;

/** The error actions a lane lists: what an error line written to lane `L` may carry. */
export type LaneErrorAction<L extends Lane> = Extract<(typeof LANE_ACTIONS)[L][number], ErrorAction>;

/** What the rules read. All of it is on CardDetail, or ShipPlan, today. */
export interface LaneActionInput {
  lane: Lane;
  turnRunning: boolean;
  /** A question or permission is open on the card. */
  pending: boolean;
  /** The last line of the current lane's chat. */
  lastChat: ChatItem | null;
  /** The spec's review state and whether it has text; null when there's no spec, which reads as no review and no text. */
  spec: { review: ReviewState; hasText: boolean } | null;
  /** The statuses of the card's spec issues. */
  issues: readonly IssueStatus[];
  /** Land on main is running for the card. */
  landing: boolean;
  /** What Land on main would do now; null until it's read. */
  shipPlan: ShipPlan | null;
  /** Try it's feedback box has text. */
  hasFeedback: boolean;
}

/** Why Sign off is greyed, or null when it is enabled. */
function signOffReason(review: ReviewState, turnRunning: boolean): string | null {
  if (review === "fresh") return turnRunning ? "Wait for the spec writer to finish" : null;
  if (review === "none") return "Run the review first";
  if (review === "stale") return "Review the changed spec again first";
  if (review === "unfinished") return "Finish the review first";
  return "Wait for the review";
}

function reviewReason(input: LaneActionInput): string | null {
  const review = input.spec?.review ?? "none";
  if (input.turnRunning) return "Wait for the spec writer to finish";
  if (!input.spec?.hasText) return "Wait for the spec writer to write the spec";
  if (review === "running" || review === "applying") return "Wait for the review";
  if (review === "unfinished") return "Finish the review first";
  if (review === "fresh") return "Already reviewed";
  return null;
}

/** Land on main's reasons, first match winning; `uncommitted` false leaves out the last, for Discard them and land. */
function landReason(input: LaneActionInput, uncommitted: boolean): string | null {
  const plan = input.shipPlan;
  if (input.landing) return "Landing…";
  if (!plan) return "Reading what landing will do…";
  if (plan.busy) return "Another card of this project is landing.";
  if (plan.unpushed > 0) return `Your local main has ${plan.unpushed} commits that aren't on origin. Push them first.`;
  if (plan.checkoutBlocks) return "Your checkout has main checked out with uncommitted changes. Commit or stash them first.";
  if (uncommitted && plan.uncommitted.length > 0) return "Uncommitted work in the card's worktree won't land.";
  return null;
}

/** Try it's first two reasons, shared by Send to Build and Accept. */
function tryItReason(input: LaneActionInput): string | null {
  if (input.pending || input.issues.includes("waiting")) return "Answer the spec keeper's question first.";
  if (input.turnRunning) return "The spec keeper is working. Wait for it to finish.";
  return null;
}

type Rule = { offered: boolean; enabled: boolean; reason: string | null };

const greyed = (reason: string | null): Rule => ({ offered: true, enabled: reason === null, reason });

function rule(id: LaneActionId, input: LaneActionInput): Rule {
  const last = input.lastChat;
  switch (id) {
    case "start":
      return greyed(null);
    case "good":
      return greyed(input.turnRunning || input.pending ? "Wait for the product owner to finish" : null);
    case "review":
      return greyed(reviewReason(input));
    case "signoff":
      return greyed(signOffReason(input.spec?.review ?? "none", input.turnRunning));
    case "retry":
    case "back-to-spec":
    case "back-to-build":
    case "move-on": {
      const listed = last?.kind === "error" && last.actions.includes(id);
      return { ...greyed(input.turnRunning ? "Wait for the running turn to finish" : null), offered: listed };
    }
    case "send-to-build": {
      const held = input.issues.includes("held");
      const reason = tryItReason(input);
      if (reason) return greyed(reason);
      return { offered: true, enabled: input.hasFeedback || held, reason: null };
    }
    case "accept":
      return greyed(
        tryItReason(input) ?? (input.issues.includes("held") ? "Changes you asked for go to Build with Send to Build." : null),
      );
    case "land":
      return greyed(landReason(input, true));
    case "discard-and-land":
      return { ...greyed(landReason(input, false)), offered: (input.shipPlan?.uncommitted.length ?? 0) > 0 };
    case "back-to-tryit":
      return greyed(input.landing ? "The card is landing." : null);
    case "stop":
      return { offered: input.turnRunning, enabled: true, reason: null };
  }
}

/** The actions on offer for a card, in LANE_ACTIONS order, each with its label, whether it's enabled, and why not. */
export function laneActions(input: LaneActionInput): LaneActionState[] {
  const ids: readonly LaneActionId[] = LANE_ACTIONS[input.lane];
  return ids.flatMap((id) => {
    const { offered, enabled, reason } = rule(id, input);
    if (!offered) return [];
    return [{ id, label: LANE_ACTION_LABEL[id], primary: PRIMARY.has(id), enabled, reason }];
  });
}
