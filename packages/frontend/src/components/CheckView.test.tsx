import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CheckView } from "./CheckView";

describe("CheckView", () => {
  it("shows the round, the summary as Markdown and each bug", () => {
    render(
      <CheckView
        check={{
          round: 2,
          summary: "Reviewed **everything** in `src/a.ts`",
          bugs: [{ where: "src/a.ts:12", problem: "Crashes on an empty list" }],
        }}
      />,
    );
    expect(screen.getByText("Round 2")).toBeInTheDocument();
    expect(screen.getByText("everything").tagName).toBe("STRONG");
    expect(screen.getByText("src/a.ts").tagName).toBe("CODE");
    expect(screen.getByText("src/a.ts:12")).toBeInTheDocument();
    expect(screen.getByText("Crashes on an empty list")).toBeInTheDocument();
    expect(screen.queryByText("No bugs.")).toBeNull();
  });

  it("says No bugs. when there are none", () => {
    render(<CheckView check={{ round: 1, summary: "Clean.", bugs: [] }} />);
    expect(screen.getByText("No bugs.")).toBeInTheDocument();
  });
});
