import { describe, expect, it } from "vitest";
import { LANES, lanesBefore } from "./index";

describe("lanes", () => {
  it("lists the ten lanes in board order", () => {
    expect(LANES.map((l) => l.id)).toEqual([
      "ideas", "refine", "mockup", "spec", "plan", "build", "check", "tryit", "ship", "done",
    ]);
  });

  it("has no implemented flag now that every lane is built", () => {
    for (const lane of LANES) expect(lane).not.toHaveProperty("implemented");
  });

  it("lists the lanes before a lane, in board order", () => {
    expect(lanesBefore("ideas")).toEqual([]);
    expect(lanesBefore("spec")).toEqual(["ideas", "refine", "mockup"]);
    expect(lanesBefore("done")).toEqual(["ideas", "refine", "mockup", "spec", "plan", "build", "check", "tryit", "ship"]);
  });
});
