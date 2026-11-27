// For you: which cards wait for you, and what each one wants (docs/specs/2026-11-27-for-you.md). Plain code from what
// the card already stores; the one line is the hive's own sentence, never a reading of a session's prose.
import { laneImplemented } from "@hive/shared";
import type { CardState, ChatItem, ForYouKind, Lane, PendingItem, ReviewState } from "@hive/shared";

/** A card waits for you when nothing runs on it, it's under way (Refine through Ship), and its lane is built. */
export function waitsForYou(card: { lane: Lane; state: CardState }): boolean {
  return card.state === "needs-you" && card.lane !== "ideas" && card.lane !== "done" && laneImplemented(card.lane);
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
