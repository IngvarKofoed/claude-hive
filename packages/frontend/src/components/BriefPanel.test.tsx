import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BriefPanel } from "./BriefPanel";

describe("BriefPanel", () => {
  it("shows the empty state without a brief", () => {
    render(<BriefPanel brief={null} />);
    expect(screen.getByText("The brief appears here once the product owner writes it.")).toBeInTheDocument();
  });

  it("renders every section, lists as lists", () => {
    render(
      <BriefPanel
        brief={{
          title: "Seed price history",
          problem: "Players can't tell if a price is high.",
          whoItsFor: "Players",
          whatDoneLooksLike: ["Shows a point per day", "Marks today"],
          outOfScope: [],
          openPoints: ["How far back?"],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Seed price history" })).toBeInTheDocument();
    for (const heading of ["Problem", "Who it's for", "What done looks like", "Out of scope", "Open points"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
  });
});
