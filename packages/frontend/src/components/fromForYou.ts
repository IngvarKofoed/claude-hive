// Whether the card page was opened from a For you entry (docs/specs/2026-11-28-back-to-for-you-after-a-lane-action.md).
// The memory is React Router location state on the history entry: it never shows in the URL, so a typed or pasted
// address and the board never carry it, while a reload of the card page or browser Back to it keeps it.

/** The location state For you's entry link passes to the card page. */
export const FROM_FOR_YOU = { from: "for-you" } as const;

/** True only for a location state that says it came from For you; anything else, including no state, is false. */
export function cameFromForYou(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { from?: unknown }).from === FROM_FOR_YOU.from;
}
