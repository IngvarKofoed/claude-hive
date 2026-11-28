import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FolderCompletions } from "@hive/shared";
import { api } from "../api/client";
import { ProjectPathInput } from "./ProjectPathInput";

afterEach(() => vi.restoreAllMocks());

const answer = (names: string[], more = 0): FolderCompletions => ({
  folders: names.map((n) => ({ name: n, value: `/r/${n}` })),
  more,
});

function Wrapper({ onSubmit = () => {}, initial = "" }: { onSubmit?: () => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <ProjectPathInput id="pp" value={value} onChange={setValue} />
    </form>
  );
}

const field = () => screen.getByRole("combobox");

describe("ProjectPathInput", () => {
  it("asks for what's typed and lists the folders with combobox ARIA", async () => {
    const folders = vi.spyOn(api, "folders").mockResolvedValue(answer(["a/", "b/"]));
    render(<Wrapper />);
    expect(folders).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.type(field(), "/r/");
    expect(folders).toHaveBeenLastCalledWith("/r/");
    const list = await screen.findByRole("listbox");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(field()).toHaveAttribute("aria-expanded", "true");
    expect(field()).toHaveAttribute("aria-controls", list.id);
    expect(field()).not.toHaveAttribute("aria-activedescendant");
  });

  it("ignores an answer that arrives after a newer one", async () => {
    const resolvers: ((a: FolderCompletions) => void)[] = [];
    vi.spyOn(api, "folders").mockImplementation(() => new Promise((r) => resolvers.push(r)));
    render(<Wrapper />);
    await userEvent.type(field(), "ab");
    expect(resolvers).toHaveLength(2);
    resolvers[1]?.(answer(["new/"]));
    await screen.findByText("new/");
    resolvers[0]?.(answer(["stale/"]));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText("stale/")).toBeNull();
    expect(screen.getByText("new/")).toBeInTheDocument();
  });

  it("shows no list when the request fails", async () => {
    vi.spyOn(api, "folders").mockRejectedValue(new Error("down"));
    render(<Wrapper />);
    await userEvent.type(field(), "x");
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("moves the highlight with the arrows, from nothing, and wraps", async () => {
    vi.spyOn(api, "folders").mockResolvedValue(answer(["a/", "b/"]));
    render(<Wrapper />);
    await userEvent.type(field(), "/");
    await screen.findByRole("listbox");
    const [a, b] = screen.getAllByRole("option") as [HTMLElement, HTMLElement];
    await userEvent.keyboard("{ArrowDown}");
    expect(a).toHaveAttribute("aria-selected", "true");
    expect(field()).toHaveAttribute("aria-activedescendant", a.id);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(a).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowUp}");
    expect(b).toHaveAttribute("aria-selected", "true");
  });

  it("ArrowUp from nothing goes to the last", async () => {
    vi.spyOn(api, "folders").mockResolvedValue(answer(["a/", "b/"]));
    render(<Wrapper />);
    await userEvent.type(field(), "/");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
  });

  it.each(["{Tab}", "{Enter}"])("%s completes a highlighted folder without submitting, and asks again", async (key) => {
    const folders = vi.spyOn(api, "folders").mockResolvedValue(answer(["a/", "b/"]));
    const submit = vi.fn();
    render(<Wrapper onSubmit={submit} />);
    await userEvent.type(field(), "/");
    await screen.findByRole("listbox");
    await userEvent.keyboard(`{ArrowDown}${key}`);
    expect(field()).toHaveValue("/r/a/");
    expect(submit).not.toHaveBeenCalled();
    await waitFor(() => expect(folders).toHaveBeenLastCalledWith("/r/a/"));
    expect(field()).toHaveFocus();
  });

  it("Escape closes the list and is defaultPrevented; with it shut, Escape is left alone", async () => {
    vi.spyOn(api, "folders").mockResolvedValue(answer(["a/"]));
    render(<Wrapper />);
    await userEvent.type(field(), "/");
    await screen.findByRole("listbox");
    expect(fireEvent.keyDown(field(), { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(fireEvent.keyDown(field(), { key: "Escape" })).toBe(true);
  });

  it("Enter with nothing highlighted submits the form", async () => {
    vi.spyOn(api, "folders").mockResolvedValue(answer(["a/"]));
    const submit = vi.fn();
    render(<Wrapper onSubmit={submit} />);
    await userEvent.type(field(), "/");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{Enter}");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("Tab with nothing highlighted completes a lone folder, and leaves two alone", async () => {
    const folders = vi.spyOn(api, "folders").mockResolvedValue(answer(["only/"]));
    const { unmount } = render(<Wrapper />);
    await userEvent.type(field(), "/");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{Tab}");
    expect(field()).toHaveValue("/r/only/");
    unmount();

    folders.mockResolvedValue(answer(["a/", "b/"]));
    render(<Wrapper />);
    await userEvent.type(field(), "/");
    await screen.findByRole("listbox");
    expect(fireEvent.keyDown(field(), { key: "Tab" })).toBe(true);
    expect(field()).toHaveValue("/");
  });

  it("a click on an option completes it and focus stays in the field", async () => {
    vi.spyOn(api, "folders").mockResolvedValue(answer(["a/"]));
    render(<Wrapper />);
    await userEvent.type(field(), "/");
    await userEvent.click(await screen.findByRole("option", { name: "a/" }));
    expect(field()).toHaveValue("/r/a/");
    expect(field()).toHaveFocus();
  });

  it("says how many more there are, on a line that isn't an option", async () => {
    vi.spyOn(api, "folders").mockResolvedValue(answer(["a/"], 3));
    render(<Wrapper />);
    await userEvent.type(field(), "/");
    expect(await screen.findByText("and 3 more — keep typing")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
