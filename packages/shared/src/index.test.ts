import { describe, expect, it } from "vitest";
import { LANES, laneImplemented } from "./index";

describe("lanes", () => {
  it("lists the ten lanes in board order", () => {
    expect(LANES.map((l) => l.id)).toEqual([
      "ideas", "refine", "mockup", "spec", "plan", "build", "check", "tryit", "ship", "done",
    ]);
  });

  it("marks the lanes built so far as implemented, and the rest not", () => {
    expect(LANES.filter((l) => l.implemented).map((l) => l.id)).toEqual(["ideas", "refine", "spec", "plan", "build", "check", "tryit"]);
    expect(laneImplemented("build")).toBe(true);
    expect(laneImplemented("ship")).toBe(false);
  });
});
