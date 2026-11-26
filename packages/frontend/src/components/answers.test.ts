import { describe, expect, it } from "vitest";
import type { Question } from "@hive/shared";
import { buildAnswers, isComplete, togglePick } from "./answers";

const single: Question = {
  question: "One point per day?",
  header: "Detail",
  multiSelect: false,
  options: [
    { label: "Daily", description: "" },
    { label: "Every change", description: "" },
  ],
};
const multi: Question = { ...single, question: "Which seeds?", header: "Scope", multiSelect: true };

describe("buildAnswers", () => {
  it("uses the picked label for a single select", () => {
    expect(buildAnswers([single], { picks: { [single.question]: ["Daily"] }, free: {} })).toEqual({
      [single.question]: "Daily",
    });
  });

  it("joins picked labels with a comma for a multi select", () => {
    expect(buildAnswers([multi], { picks: { [multi.question]: ["A", "B"] }, free: {} })).toEqual({
      [multi.question]: "A, B",
    });
  });

  it("lets free text win over a pick, and ignores blank free text", () => {
    const input = {
      picks: { [single.question]: ["Daily"], [multi.question]: ["A"] },
      free: { [single.question]: "  Hourly  ", [multi.question]: "   " },
    };
    expect(buildAnswers([single, multi], input)).toEqual({ [single.question]: "Hourly", [multi.question]: "A" });
  });

  it("leaves unanswered questions out", () => {
    const answers = buildAnswers([single, multi], { picks: {}, free: { [multi.question]: "all" } });
    expect(answers).toEqual({ [multi.question]: "all" });
    expect(isComplete([single, multi], answers)).toBe(false);
  });
});

describe("togglePick", () => {
  it("replaces for single select and clears on a second click", () => {
    expect(togglePick(["Daily"], "Every change", false)).toEqual(["Every change"]);
    expect(togglePick(["Daily"], "Daily", false)).toEqual([]);
  });

  it("adds and removes for multi select", () => {
    expect(togglePick(["A"], "B", true)).toEqual(["A", "B"]);
    expect(togglePick(["A", "B"], "A", true)).toEqual(["B"]);
  });
});
