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

  it("is draggable only in Ideas, and opens in every other lane", () => {
    const { container, rerender } = render(<CardTile card={base} />);
    expect(container.querySelector("article")).toHaveAttribute("draggable", "true");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(<CardTile card={{ ...base, lane: "refine" }} />);
    expect(container.querySelector("article")).toHaveAttribute("draggable", "false");
    expect(screen.getByRole("button", { name: "Seed price history" })).toBeInTheDocument();
  });

  it("opens in Spec and Plan", () => {
    const { rerender } = render(<CardTile card={{ ...base, lane: "spec" }} />);
    expect(screen.getByRole("button", { name: "Seed price history" })).toBeInTheDocument();
    rerender(<CardTile card={{ ...base, lane: "plan", state: "working" }} />);
    expect(screen.getByText("▶ working")).toBeInTheDocument();
  });

  it("shows Not implemented yet instead of a badge in a lane that isn't built", () => {
    render(<CardTile card={{ ...base, lane: "ship", state: "working" }} />);
    expect(screen.getByText("Not implemented yet")).toBeInTheDocument();
    expect(screen.queryByText("▶ working")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seed price history" })).toBeInTheDocument();
  });
});
