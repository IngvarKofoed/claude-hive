import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CardSummary } from "@hive/shared";
import { CardTile } from "./CardTile";

const base: CardSummary = {
  id: "c1",
  projectId: "p1",
  title: "Seed price history",
  lane: "ideas",
  state: "needs-you",
  moveError: null,
};

describe("CardTile", () => {
  it("shows ● needs you, and no error", () => {
    render(<CardTile card={base} />);
    expect(screen.getByText("● needs you")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows ▶ working", () => {
    render(<CardTile card={{ ...base, lane: "refine", state: "working" }} />);
    expect(screen.getByText("▶ working")).toBeInTheDocument();
  });

  it("shows the move error", () => {
    render(<CardTile card={{ ...base, moveError: "fatal: 'hive/x' already exists" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("fatal: 'hive/x' already exists");
  });

  it("is draggable only in Ideas, and opens only in Refine", () => {
    const { container, rerender } = render(<CardTile card={base} />);
    expect(container.querySelector("article")).toHaveAttribute("draggable", "true");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(<CardTile card={{ ...base, lane: "refine" }} />);
    expect(container.querySelector("article")).toHaveAttribute("draggable", "false");
    expect(screen.getByRole("button", { name: "Seed price history" })).toBeInTheDocument();
  });
});
