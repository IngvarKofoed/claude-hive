// Card moves are plain code (docs/ARCHITECTURE.md, Card Moves). Every lane the hive moves a card to is decided
// here, from what you did or from the fields of a role's report, never by reading prose.
import type { IssueLevel, IssueVerdict, Lane, SendBackPoint } from "@hive/shared";

/** Dragging a card on the board: only Ideas → Refine so far. */
export function canMove(from: Lane, to: Lane): boolean {
  return from === "ideas" && to === "refine";
}

/** What you did on the card page that moves a card. */
export type CardAction =
  | "good" | "skip-mockup" | "signoff" | "back-to-spec" | "back-to-build" | "move-on" | "feedback" | "accept" | "back-to-tryit";

/** The lane a card goes to when you act on it, or null when that action doesn't move a card from this lane. */
export function laneAfter(from: Lane, action: CardAction): Lane | null {
  switch (action) {
    case "good":
      // Refine's Good goes on to Mockup, and Mockup's Good (keep or don't keep) to Spec
      // (docs/specs/2026-11-28-mockup-lane-and-designer-role.md)
      return from === "refine" ? "mockup" : from === "mockup" ? "spec" : null;
    case "skip-mockup":
      // Refine's "Good · skip to Spec", when there's nothing to show
      return from === "refine" ? "spec" : null;
    case "signoff":
      return from === "spec" ? "plan" : null;
    case "back-to-spec":
      // A blocked plan or build, or a severe issue the spec keeper stopped the card on in Check
      // (docs/specs/2026-11-28-spec-keeper.md, After the batch), or a Send back whose pick failed, from Try it
      // (docs/specs/2026-11-28-try-it-send-back.md)
      return from === "plan" || from === "build" || from === "check" || from === "tryit" ? "spec" : null;
    case "back-to-build":
      // One more round for a card that Check stopped (docs/specs/2026-11-27-check-lane-reviewer.md), a landing whose
      // tests failed on the squash (docs/specs/2026-11-27-ship-lane.md), or a Send back whose pick failed
      return from === "check" || from === "ship" || from === "tryit" ? "build" : null;
    case "move-on":
      // Try it as built, for a card that Check stopped or couldn't review
      return from === "check" ? "tryit" : null;
    case "feedback":
      // Send back: your words from Try it go to Build or Spec, as laneAfterSendBack picks (or you, after a failed
      // pick). This only says Try it is where they're sent from (docs/specs/2026-11-28-try-it-send-back.md).
      return from === "tryit" ? "build" : null;
    case "accept":
      return from === "tryit" ? "ship" : null;
    case "back-to-tryit":
      // Out of Ship, until Ship is built
      return from === "ship" ? "tryit" : null;
  }
}

/**
 * Where your Send back goes, from the spec keeper's reading of it: Spec if any point changes the spec, which makes an
 * amendment; otherwise Build. Mixed feedback goes to the earliest lane, and its bugs travel with the amendment
 * (docs/specs/2026-11-28-try-it-send-back.md, The keeper reads, code picks).
 */
export function laneAfterSendBack(points: readonly Pick<SendBackPoint, "kind">[]): "build" | "spec" {
  return points.some((p) => p.kind === "spec") ? "spec" : "build";
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
 * Where the landing leaves the card: Done once the commit is on main, Build on a conflict with main, Ship otherwise
 * (a failing test, a refused push, a cut-off landing), waiting for Retry.
 */
export function laneAfterLanding(result: "landed" | "conflict" | "stopped"): Lane {
  return result === "landed" ? "done" : result === "conflict" ? "build" : "ship";
}

/**
 * Where the reviewer's report leaves the card. A `done` report without bugs moves it to Try it; with bugs, it goes
 * back to Build while the round is under the limit, and otherwise stays in Check for you. A `blocked` or missing
 * report keeps it in Check, and so does a round without bugs while spec issues are open: the spec keeper judges them
 * first (docs/specs/2026-11-28-spec-keeper.md, The batch).
 */
export function laneAfterCheck(
  report: "done" | "blocked" | "missing", bugs: number, round: number, shipAfterCheck = false, waitingForYou = false,
  openIssues = 0,
): Lane {
  if (report !== "done") return "check";
  if (bugs === 0 && openIssues > 0) return "check";
  // A card Ship sent back goes straight back to Ship, with no second Try it (docs/specs/2026-11-27-ship-lane.md),
  // unless a spec keeper question waits for you: those are asked in Try it.
  if (bugs === 0) return shipAfterCheck && !waitingForYou ? "ship" : "tryit";
  return round < CHECK_ROUNDS ? "build" : "check";
}

// ---------- the spec keeper (docs/specs/2026-11-28-spec-keeper.md) ----------

/** Keeper fix rounds since sign-off that run without you; after them, code fixes come to you as questions. */
export const KEEPER_FIX_ROUNDS = 2;

/** What becomes of one judged issue from a batch. */
export type IssueFate = "spec-fixed" | "no-change" | "fix" | "waits" | "severe";

/**
 * The fate of a judged issue (After the batch). A repeat always comes to you; a minor code fix goes to the developer
 * only in a `batch` turn while fix rounds are left.
 */
export function fateOf(
  judgment: { verdict: IssueVerdict; level: IssueLevel; repeats: string | null },
  turn: "batch" | "as-built",
  fixRoundsUsed: number,
): IssueFate {
  if (judgment.level === "severe") return "severe";
  if (judgment.repeats || judgment.level === "changes-signoff") return "waits";
  if (judgment.verdict === "spec-wrong") return "spec-fixed";
  if (judgment.verdict === "no-change") return "no-change";
  return turn === "batch" && fixRoundsUsed < KEEPER_FIX_ROUNDS ? "fix" : "waits";
}

/**
 * Where a judged batch leaves the card, first match winning: a severe issue stops it in Check; a code fix sends it to
 * Build; otherwise Try it, or Ship for a card Ship sent back while nothing waits for you.
 */
export function laneAfterJudging(fates: IssueFate[], shipAfterCheck: boolean, waitingForYou: boolean): Lane {
  if (fates.includes("severe")) return "check";
  if (fates.includes("fix")) return "build";
  return shipAfterCheck && !waitingForYou && !fates.includes("waits") ? "ship" : "tryit";
}

/** What follows the keeper's judgment of a blocked build's reason (A blocked build), first row that matches. */
export type AfterBlocking = "stop" | "fall-back" | "ask" | "spec-fixed" | "carry-on";

export function afterBlocking(judgment: { verdict: IssueVerdict; level: IssueLevel; repeats: string | null }): AfterBlocking {
  if (judgment.level === "severe") return "stop";
  if (judgment.verdict === "no-change") return "fall-back";
  if (judgment.level === "changes-signoff" || judgment.repeats) return "ask";
  return judgment.verdict === "spec-wrong" ? "spec-fixed" : "carry-on";
}
