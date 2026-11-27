import { describe, expect, it } from "vitest";
import { outcomeSection } from "./outcome";

describe("outcomeSection", () => {
  it("cuts from the Outcome heading to the next ## heading, without the heading", () => {
    const spec = "# Title\n\n## Outcome\n\n- one\n- two\n\n### Sub\n\nmore\n\n## Design\n\ntext";
    expect(outcomeSection(spec)).toBe("- one\n- two\n\n### Sub\n\nmore");
  });

  it("runs to the end when Outcome is the last section", () => {
    expect(outcomeSection("## Outcome\n- a\n")).toBe("- a");
  });

  it("is null without an Outcome section, without text, or with an empty one", () => {
    expect(outcomeSection("## Design\n\nx")).toBeNull();
    expect(outcomeSection(null)).toBeNull();
    expect(outcomeSection("## Outcome\n\n## Design\nx")).toBeNull();
  });
});
