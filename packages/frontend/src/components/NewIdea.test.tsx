import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardResponse, ProjectSummary } from "@hive/shared";
import { api } from "../api/client";
import { NewIdea } from "./NewIdea";
import { NewIdeaProvider, useNewIdea } from "./newIdeaContext";

afterEach(() => vi.restoreAllMocks());

const project = (id: string, name: string) => ({ id, name, path: `/r/${id}` }) as unknown as ProjectSummary;

function board(...projects: ProjectSummary[]) {
  return vi.spyOn(api, "board").mockResolvedValue({ projects, cards: [] } as BoardResponse);
}

/** A stand-in for the board's field: opens the form with a preset. */
function Opener({ projectId, title }: { projectId?: string; title?: string }) {
  const { openNewIdea } = useNewIdea();
  return <button onClick={() => openNewIdea({ projectId, title })}>From the board</button>;
}

function renderForm(opener?: { projectId?: string; title?: string }) {
  return render(
    <NewIdeaProvider>
      <NewIdea />
      {opener ? <Opener {...opener} /> : null}
    </NewIdeaProvider>,
  );
}

async function openForm() {
  await userEvent.click(screen.getByRole("button", { name: "New idea" }));
}

describe("NewIdea", () => {
  it("has one project already chosen, and focus in the form", async () => {
    board(project("p1", "flux"));
    renderForm();
    await openForm();
    const select = await screen.findByLabelText("Project");
    expect(select).toHaveValue("p1");
    expect(screen.getByLabelText("Title")).toHaveFocus();
    expect(screen.getByRole("button", { name: "New idea" })).toHaveAttribute("aria-expanded", "true");
    await userEvent.type(screen.getByLabelText("Title"), "Font");
    await userEvent.type(screen.getByLabelText("Idea"), "Bigger font");
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("keeps Add disabled with several projects until one is picked", async () => {
    board(project("p1", "flux"), project("p2", "hive"));
    renderForm();
    await openForm();
    const select = await screen.findByLabelText("Project");
    expect(select).toHaveValue("");
    await userEvent.type(screen.getByLabelText("Title"), "Font");
    await userEvent.type(screen.getByLabelText("Idea"), "Bigger font");
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    await userEvent.selectOptions(select, "hive");
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("posts the idea, then closes and empties the form", async () => {
    board(project("p1", "flux"));
    const add = vi.spyOn(api, "newCard").mockResolvedValue(undefined);
    renderForm();
    await openForm();
    await userEvent.type(await screen.findByLabelText("Title"), "Font");
    await userEvent.type(screen.getByLabelText("Idea"), "Bigger font");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(add).toHaveBeenCalledWith({ projectId: "p1", title: "Font", text: "Bigger font" });
    expect(screen.queryByLabelText("Idea")).not.toBeInTheDocument();
    await openForm();
    expect(await screen.findByLabelText("Idea")).toHaveValue("");
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  it("keeps Add disabled until there is a title and a text", async () => {
    board(project("p1", "flux"));
    renderForm();
    await openForm();
    const add = await screen.findByRole("button", { name: "Add" });
    await userEvent.type(screen.getByLabelText("Title"), "Font");
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Idea"), "Bigger font");
    expect(add).toBeEnabled();
    await userEvent.clear(screen.getByLabelText("Title"));
    expect(add).toBeDisabled();
  });

  it("starts with the project and title it was opened with, and focus in the text", async () => {
    board(project("p1", "flux"), project("p2", "hive"));
    renderForm({ projectId: "p2", title: "Bigger font" });
    await userEvent.click(screen.getByRole("button", { name: "From the board" }));
    expect(await screen.findByLabelText("Project")).toHaveValue("p2");
    expect(screen.getByLabelText("Title")).toHaveValue("Bigger font");
    expect(screen.getByLabelText("Idea")).toHaveFocus();
  });

  it("puts focus in the title when only the project was passed", async () => {
    board(project("p1", "flux"), project("p2", "hive"));
    renderForm({ projectId: "p2", title: "" });
    await userEvent.click(screen.getByRole("button", { name: "From the board" }));
    expect(await screen.findByLabelText("Project")).toHaveValue("p2");
    expect(screen.getByLabelText("Title")).toHaveFocus();
  });

  it("when already open, replaces the project and title and keeps the typed text", async () => {
    board(project("p1", "flux"), project("p2", "hive"));
    renderForm({ projectId: "p2", title: "From the board" });
    await openForm();
    await userEvent.selectOptions(await screen.findByLabelText("Project"), "flux");
    await userEvent.type(screen.getByLabelText("Title"), "Old");
    await userEvent.type(screen.getByLabelText("Idea"), "Typed text");
    await userEvent.click(screen.getByRole("button", { name: "From the board" }));
    expect(screen.getByLabelText("Project")).toHaveValue("p2");
    expect(screen.getByLabelText("Title")).toHaveValue("From the board");
    expect(screen.getByLabelText("Idea")).toHaveValue("Typed text");
  });

  /** Each page has its own header and so its own form: a new `page` key stands for moving to another page. */
  const onPage = (page: string) => (
    <NewIdeaProvider>
      <NewIdea key={page} />
      <Opener projectId="p2" title="Bigger font" />
    </NewIdeaProvider>
  );

  it("doesn't bring back a title already added on the next page's form", async () => {
    board(project("p1", "flux"), project("p2", "hive"));
    vi.spyOn(api, "newCard").mockResolvedValue(undefined);
    const { rerender } = render(onPage("board"));
    await userEvent.click(screen.getByRole("button", { name: "From the board" }));
    await userEvent.type(await screen.findByLabelText("Idea"), "Some text");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    rerender(onPage("card"));
    await openForm();
    expect(await screen.findByLabelText("Title")).toHaveValue("");
  });

  it("closes when its page goes, and the next page's form doesn't take the title it was opened with", async () => {
    board(project("p1", "flux"), project("p2", "hive"));
    const { rerender } = render(onPage("board"));
    await userEvent.click(screen.getByRole("button", { name: "From the board" }));
    expect(await screen.findByLabelText("Title")).toHaveValue("Bigger font");
    rerender(onPage("card"));
    expect(screen.getByRole("button", { name: "New idea" })).toHaveAttribute("aria-expanded", "false");
    await act(async () => {});
    expect(screen.queryByLabelText("Idea")).not.toBeInTheDocument();
    await openForm();
    expect(await screen.findByLabelText("Title")).toHaveValue("");
  });

  it("keeps the text and shows the error when adding fails", async () => {
    board(project("p1", "flux"));
    vi.spyOn(api, "newCard").mockRejectedValue(new Error("Disk full"));
    renderForm();
    await openForm();
    await userEvent.type(await screen.findByLabelText("Title"), "Font");
    await userEvent.type(screen.getByLabelText("Idea"), "Bigger font");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Disk full")).toBeInTheDocument();
    expect(screen.getByLabelText("Idea")).toHaveValue("Bigger font");
  });

  it("shows a failed load, and says to add a project when there are none", async () => {
    const spy = vi.spyOn(api, "board").mockRejectedValue(new Error("Backend down"));
    renderForm();
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
    renderForm();
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
    renderForm();
    await openForm();
    await userEvent.type(await screen.findByLabelText("Title"), "Font");
    await userEvent.type(screen.getByLabelText("Idea"), "Bigger font");
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
    renderForm();
    await openForm();
    await screen.findByLabelText("Idea");
    await userEvent.keyboard("{Escape}");
    window.removeEventListener("keydown", onWindowKey);
    expect(screen.queryByLabelText("Idea")).not.toBeInTheDocument();
    expect(onWindowKey).not.toHaveBeenCalled();
  });
});
