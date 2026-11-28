import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CardSummary, ProjectSummary } from "@hive/shared";
import { ProjectRow } from "./ProjectRow";

const project: ProjectSummary = { id: "p1", name: "flux", path: "~/work/flux", trustWarning: false };
const card = (id: string, lane: CardSummary["lane"]): CardSummary => ({
  id,
  projectId: "p1",
  title: `Card ${id}`,
  lane,
  state: "needs-you",
  moveError: null,
});
const landed = [card("d1", "done"), card("d2", "done"), card("d3", "done")];

function row(cards: CardSummary[], compact?: boolean) {
  return (
    <ProjectRow
      project={project}
      cards={cards}
      compact={compact}
      dragging={null}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onDrop={vi.fn()}
      onOpen={vi.fn()}
      onStart={vi.fn()}
      onBoard={vi.fn()}
    />
  );
}

describe("ProjectRow, compact Done", () => {
  it("shows a closed '3 landed' button and no landed tiles", () => {
    render(row(landed, true));
    expect(screen.getByRole("button", { name: "3 landed" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Card d1")).toBeNull();
    expect(screen.queryByRole("group", { name: "flux, landed" })).toBeNull();
  });

  it("opens a strip of the three tiles in board order, and closes it again", async () => {
    render(row(landed, true));
    const button = screen.getByRole("button", { name: "3 landed" });
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const strip = screen.getByRole("group", { name: "flux, landed" });
    expect(strip).toHaveAttribute("id", button.getAttribute("aria-controls"));
    expect(within(strip).getAllByRole("button").map((b) => b.textContent)).toEqual(
      expect.arrayContaining(["Card d1", "Card d2", "Card d3"]),
    );
    const titles = within(strip)
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t?.startsWith("Card"));
    expect(titles).toEqual(["Card d1", "Card d2", "Card d3"]);
    await userEvent.click(button);
    expect(screen.queryByRole("group", { name: "flux, landed" })).toBeNull();
  });

  it("follows the cards while open, and goes when none are left", async () => {
    const { rerender } = render(row(landed, true));
    await userEvent.click(screen.getByRole("button", { name: "3 landed" }));
    rerender(row([...landed, card("d4", "done")], true));
    expect(within(screen.getByRole("group", { name: "flux, landed" })).getByText("Card d4")).toBeInTheDocument();
    rerender(row([card("r1", "refine")], true));
    expect(screen.queryByRole("button", { name: /landed/ })).toBeNull();
    expect(screen.queryByRole("group", { name: "flux, landed" })).toBeNull();
  });

  it("has no landed button for a project with no landed cards", () => {
    render(row([card("r1", "refine")], true));
    expect(screen.queryByRole("button", { name: /landed/ })).toBeNull();
  });

  it("shows the full path as the title", () => {
    render(row([], true));
    expect(screen.getByText("~/work/flux")).toHaveAttribute("title", "~/work/flux");
  });
});

describe("ProjectRow, not compact", () => {
  it("keeps landed tiles in the Done cell, with no landed button", () => {
    render(row(landed));
    expect(screen.queryByRole("button", { name: /landed/ })).toBeNull();
    expect(within(screen.getByRole("group", { name: "flux, Done" })).getByText("Card d1")).toBeInTheDocument();
  });
});
