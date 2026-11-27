import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CardSummary, ProjectSummary } from "@hive/shared";
import { ProjectPanel } from "./ProjectPanel";

const project: ProjectSummary = { id: "p1", name: "flux", path: "~/work/flux", trustWarning: false };

const card = (id: string, lane: CardSummary["lane"], state: CardSummary["state"] = "needs-you"): CardSummary => ({
  id,
  projectId: "p1",
  title: `Card ${id}`,
  lane,
  state,
  moveError: null,
});

function renderPanel(cards: CardSummary[], extra: Partial<Parameters<typeof ProjectPanel>[0]> = {}) {
  const props = {
    project,
    cards,
    onOpen: vi.fn(),
    onStart: vi.fn().mockResolvedValue(undefined),
    onBoard: vi.fn(),
    ...extra,
  };
  return { props, ...render(<ProjectPanel {...props} />) };
}

describe("ProjectPanel", () => {
  it("puts the cards in progress in lane order, oldest first within a lane, whatever their state", () => {
    renderPanel([
      card("tryit-1", "tryit"),
      card("build-1", "build", "working"),
      card("refine-1", "refine"),
      card("build-2", "build"),
    ]);
    const titles = screen.getAllByRole("button", { name: /^Card / }).map((b) => b.textContent);
    expect(titles).toEqual(["Card refine-1", "Card build-1", "Card build-2", "Card tryit-1"]);
  });

  it("names each card's lane", () => {
    renderPanel([card("b", "build", "working")]);
    expect(screen.getByText("Build")).toBeInTheDocument();
  });

  it("lists ideas under their own heading, with Start and no drag", async () => {
    const { props, container } = renderPanel([card("i1", "ideas"), card("r1", "refine")]);
    expect(screen.getByRole("heading", { name: "Ideas" })).toBeInTheDocument();
    const idea = screen.getByText("Card i1").closest("article")!;
    expect(idea).toHaveAttribute("draggable", "false");
    await userEvent.click(within(idea).getByRole("button", { name: "Start" }));
    expect(props.onStart).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }));
    expect(container.querySelectorAll("[draggable='true']")).toHaveLength(0);
  });

  it("opens an idea from its title, like any other card", async () => {
    const { props } = renderPanel([card("i1", "ideas")]);
    await userEvent.click(screen.getByRole("button", { name: "Card i1" }));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }));
  });

  it("folds landed cards into a count that opens and closes", async () => {
    renderPanel([card("d1", "done"), card("d2", "done")]);
    expect(screen.queryByText("Card d1")).toBeNull();
    const toggle = screen.getByRole("button", { name: /2 landed/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Card d1")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByText("Card d1")).toBeNull();
  });

  it("shows just the heading and the idea field for a project with nothing yet", () => {
    renderPanel([]);
    expect(screen.getByRole("heading", { name: "flux" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Add an idea to flux" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /landed/ })).toBeNull();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("shows the trust warning", () => {
    renderPanel([], { project: { ...project, trustWarning: true } });
    expect(screen.getByRole("alert")).toHaveTextContent("doesn't trust this folder");
  });
});
