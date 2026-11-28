// Every action an error line carries must be in its lane's LANE_ACTIONS, or the page drops it from the line
// (docs/specs/2026-11-28-for-you-actions.md, The definition). An addError with a literal lane is checked by its type;
// the calls whose lane is a variable are checked here at runtime.
import { describe, expect, it } from "vitest";
import { LANE_ACTIONS, type Lane, type LaneActionId } from "@hive/shared";
import type { Hive } from "./hive";

// Never called: these lines are checked by `npm run typecheck`. Indexed access reaches the private method's own type.
export function addErrorTypes(addError: Hive["addError"]): void {
  addError("c", "build", "m", ["retry", "back-to-spec"]);
  addError("c", "check", "m", ["back-to-build", "move-on"]);
  addError("c", "spec", "m", ["review"]);
  addError("c", "ship", "m", ["retry", "back-to-build"]);
  // @ts-expect-error Refine doesn't list Back to Spec.
  addError("c", "refine", "m", ["back-to-spec"]);
  // @ts-expect-error Ship doesn't list Move on.
  addError("c", "ship", "m", ["move-on"]);
  // @ts-expect-error Plan doesn't list Move on.
  addError("c", "plan", "m", ["retry", "move-on"]);
  // @ts-expect-error Build doesn't list Review.
  addError("c", "build", "m", ["review"]);
}

const lists = (lane: Lane, ...ids: LaneActionId[]) => {
  const listed: readonly LaneActionId[] = LANE_ACTIONS[lane];
  for (const id of ids) expect(listed, `${lane} lists ${id}`).toContain(id);
};

describe("the error actions written to a variable lane", () => {
  it("lists Retry in every lane a session or keeper turn writes an error to", () => {
    // A failed turn and a failed restart: addError(cardId, session.lane, …, ["retry"]).
    for (const lane of ["refine", "spec", "plan", "build", "check", "tryit", "ship"] as const) lists(lane, "retry");
  });

  it("lists keeperFailed's actions in Check and Build", () => {
    lists("check", "retry", "move-on");
    lists("build", "retry", "back-to-spec");
  });
});
