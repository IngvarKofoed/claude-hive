// Make it an idea's guard (docs/specs/2026-11-28-chat-with-a-project-then-make-it-an-idea.md, Make it an idea). One
// definition that the greyed button and the server's 409 both read, so the two give the same words, the way
// laneActions.ts does for lane actions.

/** The reply box's hint, and the 409 a message gets, while the quiet draft turn runs. */
export const IDEA_DRAFTING = "Claude is drafting the idea";

export interface IdeaDraftInput {
  /** The chat has at least one reply from Claude. */
  hasReply: boolean;
  turnRunning: boolean;
  /** A question waits for your answer. */
  asking: boolean;
  /** A draft form is open: drafting, ready or failed. */
  draftOpen: boolean;
}

/** Why Make it an idea is greyed out, or null when it's on. The reasons are checked in this order. */
export function ideaDraftBlock(input: IdeaDraftInput): string | null {
  if (input.asking) return "Answer the question first";
  if (input.turnRunning) return "Wait for Claude to finish";
  if (input.draftOpen) return "Add or cancel the idea first";
  if (!input.hasReply) return "Say something first";
  return null;
}
