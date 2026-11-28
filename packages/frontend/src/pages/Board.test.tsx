import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LANES, type BoardResponse, type CardSummary, type HiveEvent } from "@hive/shared";

const listeners = new Set<(event: HiveEvent) => void>();
vi.mock("../api/events", () => ({
  useHiveEvents: (handler: (event: HiveEvent) => void) => {
    listeners.clear();
    listeners.add(handler);
  },
  useStreamOpen: () => {},
}));

import { api } from "../api/client";
import { Board, COMPACT_KEY, LAYOUT_KEY, PHASE_BANDS } from "./Board";

const card = (id: string, lane: CardSummary["lane"], state: CardSummary["state"] = "needs-you"): CardSummary => ({
  id,
  projectId: "p1",
  title: `Card ${id}`,
  lane,
  state,
  moveError: null,
});

const board: BoardResponse = {
  projects: [{ id: "p1", name: "flux", path: "~/work/flux", trustWarning: false }],
  cards: [card("i1", "ideas"), card("r1", "refine"), card("b1", "build", "working")],
};

function emit(event: HiveEvent) {
  act(() => {
    for (const listener of listeners) listener(event);
  });
}

async function renderBoard() {
  const view = render(
    <MemoryRouter>
      <Board />
    </MemoryRouter>,
  );
  await screen.findByText(/1 project/);
  return view;
}

describe("Board", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(api, "board").mockResolvedValue(board);
  });
  afterEach(() => vi.restoreAllMocks());

  it("opens By lane when nothing is stored, with the phase bands over the lanes", async () => {
    await renderBoard();
    expect(screen.getByRole("button", { name: "By lane" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "flux, Refine" })).toBeInTheDocument();
    expect(screen.getByText("with you")).toBeInTheDocument();
    expect(screen.getAllByText("hands off")).toHaveLength(2);
  });

  it("switches to By project, and opens there next time", async () => {
    const { unmount } = await renderBoard();
    await userEvent.click(screen.getByRole("button", { name: "By project" }));
    expect(screen.getByRole("region", { name: "flux" })).toBeInTheDocument();
    expect(screen.queryByText("with you")).toBeNull();
    expect(localStorage.getItem(LAYOUT_KEY)).toBe("project");
    unmount();

    await renderBoard();
    expect(screen.getByRole("button", { name: "By project" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "flux" })).toBeInTheDocument();
  });

  it("opens By lane, and still switches, when storage refuses", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await renderBoard();
    expect(screen.getByRole("button", { name: "By lane" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "By project" }));
    expect(screen.getByRole("region", { name: "flux" })).toBeInTheDocument();
  });

  it("keeps the summary line in step with the badges", async () => {
    await renderBoard();
    // The idea doesn't count; Refine does; Build is working.
    expect(screen.getByText("1 project · 2 cards in progress · 1 waiting for you")).toBeInTheDocument();
    emit({ type: "card.updated", card: card("b1", "build", "needs-you") });
    expect(screen.getByText("1 project · 2 cards in progress · 2 waiting for you")).toBeInTheDocument();
    expect(screen.getAllByText("● needs you")).toHaveLength(2);
  });

  it("starts an idea from its panel with the same move as the drag, and shows a refusal above the board", async () => {
    localStorage.setItem(LAYOUT_KEY, "project");
    const move = vi.spyOn(api, "moveCard").mockRejectedValue(new Error("This card is already moving."));
    await renderBoard();
    const panel = screen.getByRole("region", { name: "flux" });
    await userEvent.click(within(panel).getByRole("button", { name: "Start" }));
    expect(move).toHaveBeenCalledWith("i1", { lane: "refine" });
    expect(await screen.findByRole("alert")).toHaveTextContent("This card is already moving.");
  });

  describe("Compact", () => {
    it("is a button in By lane, off by default, and absent in By project", async () => {
      await renderBoard();
      expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "false");
      await userEvent.click(screen.getByRole("button", { name: "By project" }));
      expect(screen.queryByRole("button", { name: "Compact" })).toBeNull();
    });

    it("is remembered, across a remount and a trip to By project", async () => {
      const { unmount } = await renderBoard();
      await userEvent.click(screen.getByRole("button", { name: "Compact" }));
      expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
      expect(localStorage.getItem(COMPACT_KEY)).toBe("on");
      await userEvent.click(screen.getByRole("button", { name: "By project" }));
      await userEvent.click(screen.getByRole("button", { name: "By lane" }));
      expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
      unmount();
      await renderBoard();
      expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
      await userEvent.click(screen.getByRole("button", { name: "Compact" }));
      expect(localStorage.getItem(COMPACT_KEY)).toBe("off");
    });

    it("starts off, and still toggles, when storage refuses", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      await renderBoard();
      expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "false");
      await userEvent.click(screen.getByRole("button", { name: "Compact" }));
      expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
    });

    it("shows each lane header as the lane's name alone, with who works in it as its title", async () => {
      localStorage.setItem(COMPACT_KEY, "on");
      await renderBoard();
      expect(screen.getByTitle("you ⇄ product owner")).toBeInTheDocument();
      expect(screen.queryByText("you ⇄ product owner")).toBeNull();
      const headRow = screen.getByText("Projects").parentElement!;
      const laneCells = Array.from(headRow.children).slice(1);
      expect(
        laneCells.map((cell) => ({ text: cell.textContent, spans: cell.children.length, title: cell.getAttribute("title") })),
      ).toEqual(LANES.map((lane) => ({ text: lane.name, spans: 1, title: lane.who || null })));
    });

    it("shows the who as text when off", async () => {
      await renderBoard();
      expect(screen.getByText("you ⇄ product owner")).toBeInTheDocument();
      expect(screen.queryByTitle("you ⇄ product owner")).toBeNull();
    });

    it("still moves an idea to Refine by drag and by Start", async () => {
      localStorage.setItem(COMPACT_KEY, "on");
      const move = vi.spyOn(api, "moveCard").mockResolvedValue({} as never);
      await renderBoard();
      const tile = screen.getByRole("button", { name: "Card i1" }).closest("article")!;
      const data: Record<string, string> = {};
      const dataTransfer = {
        setData: (k: string, v: string) => (data[k] = v),
        getData: (k: string) => data[k],
        effectAllowed: "",
      };
      fireEvent.dragStart(tile, { dataTransfer });
      const refine = screen.getByRole("group", { name: "flux, Refine" });
      fireEvent.dragOver(refine, { dataTransfer });
      fireEvent.drop(refine, { dataTransfer });
      expect(move).toHaveBeenCalledWith("i1", { lane: "refine" });
      move.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Start" }));
      expect(move).toHaveBeenCalledWith("i1", { lane: "refine" });
    });
  });

  it("keeps Compact off's column template, and shares one template across the rows", () => {
    const css = (name: string) =>
      Object.entries(
        import.meta.glob<string>("../**/*.module.css", { query: "?raw", import: "default", eager: true }),
      ).find(([path]) => path.endsWith(name))![1];
    const board = css("Board.module.css");
    const rule = (source: string, selector: string) =>
      source.slice(source.indexOf(`${selector} {`), source.indexOf("}", source.indexOf(`${selector} {`)));
    expect(rule(board, ".grid")).toContain("--board-columns: var(--project-col-width) repeat(10, var(--lane-width));");
    for (const selector of [".bandRow", ".headRow"]) {
      expect(rule(board, selector)).toContain("grid-template-columns: var(--board-columns);");
    }
    expect(rule(css("ProjectRow.module.css"), ".row")).toContain("grid-template-columns: var(--board-columns);");
  });

  it("shows each By lane header as the lane's name and who works in it, and nothing else", async () => {
    await renderBoard();
    const headRow = screen.getByText("Projects").parentElement!;
    const laneCells = Array.from(headRow.children).slice(1);
    expect(laneCells.map((cell) => ({ text: cell.textContent, spans: cell.children.length }))).toEqual(
      LANES.map((lane) => ({ text: lane.name + lane.who, spans: lane.who ? 2 : 1 })),
    );
  });

  it("has bands that cover every lane once, in order", () => {
    expect(PHASE_BANDS.flatMap((band) => band.lanes)).toEqual(LANES.map((lane) => lane.id));
  });
});
