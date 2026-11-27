import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardSummary } from "@hive/shared";
import { api } from "../api/client";
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

  it("shows no badge for a landed card", () => {
    render(<CardTile card={{ ...base, lane: "done" }} />);
    expect(screen.queryByText("● needs you")).toBeNull();
    expect(screen.queryByText("Not implemented yet")).toBeNull();
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
    expect(screen.queryByRole("button", { name: "Seed price history" })).not.toBeInTheDocument();
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
    render(<CardTile card={{ ...base, lane: "mockup", state: "working" }} />);
    expect(screen.getByText("Not implemented yet")).toBeInTheDocument();
    expect(screen.queryByText("▶ working")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seed price history" })).toBeInTheDocument();
  });

  describe("Delete", () => {
    afterEach(() => vi.restoreAllMocks());

    it("asks first, naming what goes, then deletes", async () => {
      const deleted = vi.spyOn(api, "deleteCard").mockResolvedValue({ left: [] });
      const onDeleted = vi.fn();
      render(<CardTile card={{ ...base, lane: "build" }} onDeleted={onDeleted} />);
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(screen.getByText("Delete this card and its branch? Work that isn't on main is lost.")).toBeInTheDocument();
      expect(deleted).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(deleted).toHaveBeenCalledWith("c1");
      expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
    });

    it("says less for an idea and a landed card", async () => {
      const { rerender } = render(<CardTile card={base} />);
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(screen.getByText("Delete this idea?")).toBeInTheDocument();
      rerender(<CardTile card={{ ...base, lane: "done" }} />);
      expect(screen.getByText("Delete this card's history? Its commit on main stays.")).toBeInTheDocument();
    });

    it("closes on Cancel or Escape with nothing done, and shows a refusal", async () => {
      const deleted = vi.spyOn(api, "deleteCard").mockRejectedValue(new Error("Wait for the landing to finish."));
      render(<CardTile card={{ ...base, lane: "ship" }} />);
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByText(/Delete this card and its branch/)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByText(/Delete this card and its branch/)).not.toBeInTheDocument();
      expect(deleted).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Wait for the landing to finish.");
    });

    it("isn't draggable while asking", async () => {
      const { container } = render(<CardTile card={base} />);
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(container.querySelector("article")).toHaveAttribute("draggable", "false");
    });
  });
});
