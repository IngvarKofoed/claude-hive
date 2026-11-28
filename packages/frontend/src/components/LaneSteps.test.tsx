import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { LaneSteps } from "./LaneSteps";

const strip = (props: Partial<Parameters<typeof LaneSteps>[0]>) =>
  render(
    <MemoryRouter>
      <LaneSteps current="spec" navigable {...props} />
    </MemoryRouter>,
  );

describe("LaneSteps", () => {
  it("draws a skipped lane as '– Mockup', plain text and never a link", () => {
    strip({ skipped: ["mockup"] });
    const list = screen.getByRole("list", { name: "Lanes" });
    expect(within(list).getByText("– Mockup")).not.toHaveAttribute("href");
    expect(within(list).queryByRole("link", { name: /Mockup/ })).toBeNull();
    expect(within(list).getByRole("link", { name: "✓ Refine" })).toBeInTheDocument();
  });

  it("links Mockup like any past lane when it wasn't skipped", () => {
    strip({});
    expect(screen.getByRole("link", { name: "✓ Mockup" })).toHaveAttribute("href", "/?lane=mockup");
  });

  it("draws a skipped lane as past in the compact strip", () => {
    const { container } = strip({ compact: true, skipped: ["mockup"] });
    const segments = container.querySelectorAll("li");
    expect(Array.from(segments).map((s) => s.getAttribute("data-status")).slice(0, 4)).toEqual([
      "past",
      "past",
      "past",
      "current",
    ]);
  });
});
