// Card moves are plain code (docs/ARCHITECTURE.md, Card Moves). Every lane the hive moves a card to is decided
// here, from what you did or from the fields of a role's report, never by reading prose.
import type { Lane } from "@hive/shared";

/** Dragging a card on the board: only Ideas → Refine so far. */
export function canMove(from: Lane, to: Lane): boolean {
  return from === "ideas" && to === "refine";
}

/** What you did on the card page that moves a card. */
export type CardAction = "good" | "signoff" | "back-to-spec";

/** The lane a card goes to when you act on it, or null when that action doesn't move a card from this lane. */
export function laneAfter(from: Lane, action: CardAction): Lane | null {
  switch (action) {
    case "good":
      return from === "refine" ? "spec" : null; // Mockup is skipped until its slice is built
    case "signoff":
      return from === "spec" ? "plan" : null;
    case "back-to-spec":
      return from === "plan" ? "spec" : null;
  }
}

/** Where the planner's report leaves the card: a done plan moves it to Build; anything else keeps it in Plan. */
export function laneAfterPlan(report: "done" | "blocked" | "missing"): Lane {
  return report === "done" ? "build" : "plan";
}
