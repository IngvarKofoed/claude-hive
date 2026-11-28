import { act, render, screen, within } from "@testing-library/react";
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
import { Board, LAYOUT_KEY, PHASE_BANDS } from "./Board";

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
