// Card moves are plain code (docs/ARCHITECTURE.md, Card Moves). Every lane the hive moves a card to is decided
// here, from what you did or from the fields of a role's report, never by reading prose.
import type { Lane } from "@hive/shared";

/** Dragging a card on the board: only Ideas → Refine so far. */
export function canMove(from: Lane, to: Lane): boolean {
  return from === "ideas" && to === "refine";
}

/** What you did on the card page that moves a card. */
export type CardAction = "good" | "signoff" | "back-to-spec" | "back-to-build" | "move-on";

/** The lane a card goes to when you act on it, or null when that action doesn't move a card from this lane. */
export function laneAfter(from: Lane, action: CardAction): Lane | null {
  switch (action) {
    case "good":
      return from === "refine" ? "spec" : null; // Mockup is skipped until its slice is built
    case "signoff":
      return from === "spec" ? "plan" : null;
    case "back-to-spec":
      // A blocked plan, or a blocked build until the spec keeper exists (docs/specs/2026-11-26-build-lane-developer.md)
      return from === "plan" || from === "build" ? "spec" : null;
    case "back-to-build":
      // One more round for a card that Check stopped (docs/specs/2026-11-27-check-lane-reviewer.md)
      return from === "check" ? "build" : null;
    case "move-on":
      // Try it as built, for a card that Check stopped or couldn't review
      return from === "check" ? "tryit" : null;
  }
}

/** Where the planner's report leaves the card: a done plan moves it to Build; anything else keeps it in Plan. */
export function laneAfterPlan(report: "done" | "blocked" | "missing"): Lane {
  return report === "done" ? "build" : "plan";
}

/**
 * Where the developer's report leaves the card: a done report moves it to Check; anything else keeps it in Build. A
 * `done` report while a merge of main is still unfinished doesn't count as done.
 */
export function laneAfterBuild(report: "done" | "blocked" | "missing", mergeUnfinished = false): Lane {
  return report === "done" && !mergeUnfinished ? "check" : "build";
}

/** Check rounds that run without you: round 1's bugs go back to Build on their own; later rounds' bugs stop the card. */
export const CHECK_ROUNDS = 2;

/**
 * Where the reviewer's report leaves the card. A `done` report without bugs moves it to Try it; with bugs, it goes
 * back to Build while the round is under the limit, and otherwise stays in Check for you. A `blocked` or missing
 * report keeps it in Check.
 */
export function laneAfterCheck(report: "done" | "blocked" | "missing", bugs: number, round: number): Lane {
  if (report !== "done") return "check";
  if (bugs === 0) return "tryit";
  return round < CHECK_ROUNDS ? "build" : "check";
}
