import { act, fireEvent, render, screen } from "@testing-library/react";
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
    render(<CardTile card={{ ...base, lane: "refine" }} />);
    expect(screen.getByText("● needs you")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows no badge for an idea: it waits for Start, not for an answer", () => {
    render(<CardTile card={base} />);
    expect(screen.queryByText("● needs you")).toBeNull();
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

  it("is draggable only in Ideas, and opens in every lane, Ideas too", () => {
    const onDragStart = vi.fn();
    const onOpen = vi.fn();
    const { container, rerender } = render(<CardTile card={base} onDragStart={onDragStart} onOpen={onOpen} />);
    expect(container.querySelector("article")).toHaveAttribute("draggable", "true");
    fireEvent.click(screen.getByRole("button", { name: "Seed price history" }));
    expect(onOpen).toHaveBeenCalledWith(base);
    rerender(<CardTile card={{ ...base, lane: "refine" }} onDragStart={onDragStart} />);
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

  it("isn't draggable where nothing can be dropped (By project gives no onDragStart)", () => {
    const { container } = render(<CardTile card={base} />);
    expect(container.querySelector("article")).toHaveAttribute("draggable", "false");
  });

  describe("Start", () => {
    it("shows on an idea only, and only when the board gives onStart", () => {
      const onStart = vi.fn().mockResolvedValue(undefined);
      const { rerender } = render(<CardTile card={base} />);
      expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
      rerender(<CardTile card={base} onStart={onStart} />);
      expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
      rerender(<CardTile card={{ ...base, lane: "refine" }} onStart={onStart} />);
      expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    });

    it("starts the idea, and is disabled while the move runs", async () => {
      let finish = () => {};
      const onStart = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
      render(<CardTile card={base} onStart={onStart} />);
      await userEvent.click(screen.getByRole("button", { name: "Start" }));
      expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
      expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
      await act(async () => finish());
      expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
    });

    it("sits before the badge row's Delete", () => {
      render(<CardTile card={base} onStart={vi.fn()} />);
      const buttons = screen.getAllByRole("button").map((b) => b.textContent);
      expect(buttons.indexOf("Start")).toBeLessThan(buttons.indexOf("Delete"));
    });
  });

  it("shows the lane's name, with a strip screen readers skip, only when asked", () => {
    const { container, rerender } = render(<CardTile card={{ ...base, lane: "build", state: "working" }} />);
    expect(screen.queryByText("Build")).toBeNull();
    rerender(<CardTile card={{ ...base, lane: "build", state: "working" }} showLane />);
    expect(screen.getByText("Build")).toBeInTheDocument();
    const strip = container.querySelector("ol");
    expect(strip).toHaveAttribute("aria-hidden", "true");
    const statuses = [...strip!.querySelectorAll("li")].map((li) => li.getAttribute("data-status"));
    expect(statuses).toEqual(["past", "past", "past", "past", "past", "current", "future", "future", "future", "future"]);
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
      const { container } = render(<CardTile card={base} onDragStart={vi.fn()} />);
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(container.querySelector("article")).toHaveAttribute("draggable", "false");
    });
  });
});
