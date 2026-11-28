// For you: which cards wait for you, and what each one wants (docs/specs/2026-11-27-for-you.md). Plain code from what
// the card already stores; the one line is the hive's own sentence, never a reading of a session's prose.
import { laneActions } from "@hive/shared";
import type {
  CardState, ChatItem, ForYouKind, Lane, LaneActionId, LaneActionInput, LaneActionState, PendingItem, ReviewState,
} from "@hive/shared";

/** A card waits for you when nothing runs on it and it's under way (Refine through Ship). */
export function waitsForYou(card: { lane: Lane; state: CardState }): boolean {
  return card.state === "needs-you" && card.lane !== "ideas" && card.lane !== "done";
}

export interface WaitInput {
  lane: Lane;
  /** The card's open question or permission. */
  pending: PendingItem | null;
  /** The last line of the current lane's chat, from this visit to the lane (spec: an earlier visit's doesn't count). */
  lastChat: ChatItem | undefined;
  /** The spec's review state, for a card in Spec. */
  review: ReviewState | null;
}

/** What a waiting card wants: the first match of the spec's table wins. */
export function whatItWants(input: WaitInput): { kind: ForYouKind; text: string } {
  const { lane, pending, lastChat, review } = input;
  if (pending?.kind === "question") {
    const first = pending.questions[0]?.question ?? "A question is waiting.";
    const more = pending.questions.length - 1;
    return { kind: "question", text: more > 0 ? `${first} (and ${more} more)` : first };
  }
  if (pending?.kind === "permission") return { kind: "permission", text: `Allow ${pending.toolName}?` };
  if (lastChat?.kind === "error") return { kind: "stuck", text: lastChat.message };
  switch (lane) {
    case "refine":
      return { kind: "your-turn", text: "Reply to the product owner, or say Good." };
    case "mockup":
      return { kind: "your-turn", text: "Reply to the designer, or say Good." };
    case "spec":
      if (review === "fresh") return { kind: "sign-off", text: "Reviewed. Sign off, or reply to the spec writer." };
      if (review === "stale") {
        return { kind: "review-again", text: "The spec changed since its review. Press Review again, or reply." };
      }
      return { kind: "your-turn", text: "Reply to the spec writer, or press Review when the spec is ready." };
    case "tryit":
      return { kind: "try-it", text: "Ready to test." };
    case "ship":
      return { kind: "land", text: "Ready to land on main." };
    default:
      return { kind: "waiting", text: "Nothing is running. Open the card to carry on." };
  }
}

/** The lane actions an entry offers outside Ship: those you press without the card page's forms or its Ship plan. */
const ENTRY_ACTIONS: ReadonlySet<LaneActionId> = new Set<LaneActionId>([
  "good", "skip-mockup", "keep", "dont-keep", "review", "signoff", "retry", "back-to-spec", "back-to-build", "move-on",
]);

/**
 * A Ship entry's actions. Discard them and land comes with Land on main's confirm row, and Retry is left off: it lands
 * again without asking, while Land on main in the same entry confirms first.
 */
const SHIP_ACTIONS: ReadonlySet<LaneActionId> = new Set<LaneActionId>(["land", "back-to-tryit", "back-to-build"]);

/**
 * The lane actions a For you entry offers (docs/specs/2026-11-28-for-you-actions.md, What For you offers). None for a
 * question or permission, since every action waits on the answer, nor for a card in Try it, which you test on the card
 * page. Ship's Land on main is always enabled: the list never reads the plan, and the button only opens the confirm row
 * that does. Stop never shows: a listed card isn't working, apart from a question asked mid-turn.
 */
export function forYouActions(kind: ForYouKind, input: LaneActionInput): LaneActionState[] {
  if (kind === "question" || kind === "permission" || input.lane === "tryit") return [];
  const actions = laneActions(input);
  if (input.lane === "ship") {
    return actions
      .filter((action) => SHIP_ACTIONS.has(action.id))
      .map((action) => (action.id === "land" ? { ...action, enabled: true, reason: null } : action));
  }
  return actions.filter((action) => ENTRY_ACTIONS.has(action.id));
}
