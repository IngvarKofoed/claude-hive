import { describe, expect, it } from "vitest";
import { FROM_FOR_YOU, cameFromForYou } from "./fromForYou";

describe("cameFromForYou", () => {
  it("is true for the state For you's entry link passes", () => {
    expect(cameFromForYou(FROM_FOR_YOU)).toBe(true);
    expect(cameFromForYou({ from: "for-you" })).toBe(true);
  });

  it("is false for no state, a string, or any other object", () => {
    expect(cameFromForYou(null)).toBe(false);
    expect(cameFromForYou(undefined)).toBe(false);
    expect(cameFromForYou("for-you")).toBe(false);
    expect(cameFromForYou({})).toBe(false);
    expect(cameFromForYou({ from: "board" })).toBe(false);
  });
});
