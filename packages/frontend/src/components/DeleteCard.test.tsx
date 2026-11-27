import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardDetail } from "@hive/shared";
import { api } from "../api/client";
import { DeleteCard } from "./DeleteCard";

const detail = {
  id: "c1", lane: "build", branch: "hive/printer-font-c1", title: "T",
} as unknown as CardDetail;

afterEach(() => vi.restoreAllMocks());

/** The card page at /cards/c1, with the board at /. */
function show(over: Partial<CardDetail> = {}, gone = false) {
  return render(
    <MemoryRouter initialEntries={["/cards/c1"]}>
      <Routes>
        <Route path="/" element={<p>The board</p>} />
        <Route path="/cards/:id" element={<DeleteCard detail={{ ...detail, ...over }} gone={gone} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DeleteCard", () => {
  it("names the branch and the loss, then deletes and goes to the board", async () => {
    const deleted = vi.spyOn(api, "deleteCard").mockResolvedValue({ left: [] });
    show();
    await userEvent.click(screen.getByRole("button", { name: "Delete card" }));
    expect(screen.getByText(
      "Delete this card? Its worktree and the branch hive/printer-font-c1 are removed, and its history is deleted. " +
        "Work that isn't on main is lost.",
    )).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleted).toHaveBeenCalledWith("c1");
    expect(await screen.findByText("The board")).toBeInTheDocument();
  });

  it("says what was left behind instead of leaving", async () => {
    vi.spyOn(api, "deleteCard").mockResolvedValue({ left: ["The branch hive/printer-font-c1: it's checked out elsewhere."] });
    show();
    await userEvent.click(screen.getByRole("button", { name: "Delete card" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("The branch hive/printer-font-c1: it's checked out elsewhere.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the board" })).toBeInTheDocument();
  });

  it("still says what was left behind when card.deleted arrives before the answer", async () => {
    let answer!: (r: { left: string[] }) => void;
    vi.spyOn(api, "deleteCard").mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { rerender } = show();
    await userEvent.click(screen.getByRole("button", { name: "Delete card" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    rerender(
      <MemoryRouter initialEntries={["/cards/c1"]}>
        <Routes>
          <Route path="/" element={<p>The board</p>} />
          <Route path="/cards/:id" element={<DeleteCard detail={detail} gone />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText("The board")).not.toBeInTheDocument();
    answer({ left: ["The branch hive/printer-font-c1: it's checked out elsewhere."] });
    expect(await screen.findByText("The branch hive/printer-font-c1: it's checked out elsewhere.")).toBeInTheDocument();
  });

  it("says a landed card's commit stays, and closes on Escape", async () => {
    show({ lane: "done" });
    await userEvent.click(screen.getByRole("button", { name: "Delete card" }));
    expect(screen.getByText("Delete this card's history? Its commit on main stays.")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Delete card" })).toBeInTheDocument();
  });

  it("shows a refusal", async () => {
    vi.spyOn(api, "deleteCard").mockRejectedValue(new Error("Wait for the landing to finish."));
    show({ lane: "ship" });
    await userEvent.click(screen.getByRole("button", { name: "Delete card" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wait for the landing to finish.");
  });

  it("goes to the board when the card was deleted elsewhere", async () => {
    show({}, true);
    expect(await screen.findByText("The board")).toBeInTheDocument();
  });
});
