import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardResponse, ProjectSummary } from "@hive/shared";
import { api } from "../api/client";
import { NewIdea } from "./NewIdea";

afterEach(() => vi.restoreAllMocks());

const project = (id: string, name: string) => ({ id, name, path: `/r/${id}` }) as unknown as ProjectSummary;

function board(...projects: ProjectSummary[]) {
  return vi.spyOn(api, "board").mockResolvedValue({ projects, cards: [] } as BoardResponse);
}

async function openForm() {
  await userEvent.click(screen.getByRole("button", { name: "New idea" }));
}

describe("NewIdea", () => {
  it("has one project already chosen, and focus in the form", async () => {
    board(project("p1", "flux"));
    render(<NewIdea />);
    await openForm();
    const select = await screen.findByLabelText("Project");
    expect(select).toHaveValue("p1");
    expect(screen.getByLabelText("Idea")).toHaveFocus();
    expect(screen.getByRole("button", { name: "New idea" })).toHaveAttribute("aria-expanded", "true");
    await userEvent.type(screen.getByLabelText("Idea"), "Bigger font");
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("keeps Add disabled with several projects until one is picked", async () => {
    board(project("p1", "flux"), project("p2", "hive"));
    render(<NewIdea />);
    await openForm();
    const select = await screen.findByLabelText("Project");
    expect(select).toHaveValue("");
    await userEvent.type(screen.getByLabelText("Idea"), "Bigger font");
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    await userEvent.selectOptions(select, "hive");
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("posts the idea, then closes and empties the form", async () => {
    board(project("p1", "flux"));
    const add = vi.spyOn(api, "newCard").mockResolvedValue(undefined);
    render(<NewIdea />);
    await openForm();
    await userEvent.type(await screen.findByLabelText("Idea"), "Bigger font");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(add).toHaveBeenCalledWith({ projectId: "p1", text: "Bigger font" });
    expect(screen.queryByLabelText("Idea")).not.toBeInTheDocument();
    await openForm();
    expect(await screen.findByLabelText("Idea")).toHaveValue("");
  });

  it("keeps the text and shows the error when adding fails", async () => {
    board(project("p1", "flux"));
    vi.spyOn(api, "newCard").mockRejectedValue(new Error("Disk full"));
    render(<NewIdea />);
    await openForm();
    await userEvent.type(await screen.findByLabelText("Idea"), "Bigger font");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Disk full")).toBeInTheDocument();
    expect(screen.getByLabelText("Idea")).toHaveValue("Bigger font");
  });

  it("shows a failed load, and says to add a project when there are none", async () => {
    const spy = vi.spyOn(api, "board").mockRejectedValue(new Error("Backend down"));
    render(<NewIdea />);
    await openForm();
    expect(await screen.findByText("Backend down")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    spy.mockResolvedValue({ projects: [], cards: [] } as BoardResponse);
    await openForm();
    expect(await screen.findByText(/Add one on the Board first/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
  });

  it("closes on Escape and on Cancel, adding nothing, and returns focus to the button", async () => {
    board(project("p1", "flux"));
    const add = vi.spyOn(api, "newCard").mockResolvedValue(undefined);
    render(<NewIdea />);
    const button = screen.getByRole("button", { name: "New idea" });
    await openForm();
    await userEvent.type(await screen.findByLabelText("Idea"), "x");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByLabelText("Idea")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    await openForm();
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Idea")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(add).not.toHaveBeenCalled();
  });

  it("stays open while Add runs, so a late answer can't close a reopened form", async () => {
    board(project("p1", "flux"));
    let finish = () => {};
    vi.spyOn(api, "newCard").mockImplementation(() => new Promise((resolve) => (finish = () => resolve(undefined))));
    render(<NewIdea />);
    await openForm();
    await userEvent.type(await screen.findByLabelText("Idea"), "Bigger font");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByLabelText("Idea")).toBeInTheDocument();
    await act(async () => finish());
    expect(screen.queryByLabelText("Idea")).not.toBeInTheDocument();
  });

  it("keeps Escape to itself, so a Delete question elsewhere stays open", async () => {
    board(project("p1", "flux"));
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<NewIdea />);
    await openForm();
    await screen.findByLabelText("Idea");
    await userEvent.keyboard("{Escape}");
    window.removeEventListener("keydown", onWindowKey);
    expect(screen.queryByLabelText("Idea")).not.toBeInTheDocument();
    expect(onWindowKey).not.toHaveBeenCalled();
  });
});
