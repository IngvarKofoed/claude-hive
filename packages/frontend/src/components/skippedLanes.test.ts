import { describe, expect, it } from "vitest";
import type { CardDetail } from "@hive/shared";
import { skippedLanes } from "./skippedLanes";

const mockup: CardDetail["mockup"] = { folder: "docs/mockups/x", current: null, kept: false, files: [] };

describe("skippedLanes", () => {
  it("is Mockup for a card past it with no mockup", () => {
    for (const lane of ["spec", "plan", "build", "check", "tryit", "ship", "done"] as const) {
      expect(skippedLanes({ lane, mockup: null })).toEqual(["mockup"]);
    }
  });

  it("is empty for a card that entered Mockup", () => {
    expect(skippedLanes({ lane: "spec", mockup })).toEqual([]);
  });

  it("is empty before and in Mockup, where the lane isn't past", () => {
    for (const lane of ["ideas", "refine", "mockup"] as const) {
      expect(skippedLanes({ lane, mockup: null })).toEqual([]);
    }
  });
});
