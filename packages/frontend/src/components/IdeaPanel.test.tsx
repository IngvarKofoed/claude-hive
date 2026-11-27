import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardDetail } from "@hive/shared";
import { api } from "../api/client";
import { IdeaPanel } from "./IdeaPanel";

afterEach(() => vi.restoreAllMocks());

const detail = { id: "c1", ideaTitle: "Bigger font", ideaText: "Make it bigger." } as unknown as CardDetail;

function setup() {
  const onChanged = vi.fn();
  render(<IdeaPanel detail={detail} onChanged={onChanged} />);
  return onChanged;
}

describe("IdeaPanel", () => {
  it("shows the title and the text, with Save off until something changed", async () => {
    setup();
    expect(screen.getByLabelText("Title")).toHaveValue("Bigger font");
    expect(screen.getByLabelText("Idea")).toHaveValue("Make it bigger.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Title"), "!");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await userEvent.clear(screen.getByLabelText("Idea"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });

  it("saves the edit and tells the page", async () => {
    const save = vi.spyOn(api, "updateIdea").mockResolvedValue({} as never);
    const onChanged = setup();
    await userEvent.type(screen.getByLabelText("Title"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith("c1", { title: "Bigger font!", text: "Make it bigger." });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("starts without saving when nothing changed", async () => {
    const save = vi.spyOn(api, "updateIdea").mockResolvedValue({} as never);
    const move = vi.spyOn(api, "moveCard").mockResolvedValue(undefined);
    const onChanged = setup();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(save).not.toHaveBeenCalled();
    expect(move).toHaveBeenCalledWith("c1", { lane: "refine" });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("saves unsaved edits first, then starts", async () => {
    const order: string[] = [];
    vi.spyOn(api, "updateIdea").mockImplementation(async () => {
      order.push("save");
      return {} as never;
    });
    vi.spyOn(api, "moveCard").mockImplementation(async () => {
      order.push("move");
      return undefined;
    });
    setup();
    await userEvent.type(screen.getByLabelText("Idea"), " More.");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(order).toEqual(["save", "move"]);
  });

  it("doesn't move the card when the save fails, and shows the error", async () => {
    vi.spyOn(api, "updateIdea").mockRejectedValue(new Error("Disk full"));
    const move = vi.spyOn(api, "moveCard").mockResolvedValue(undefined);
    const onChanged = setup();
    await userEvent.type(screen.getByLabelText("Idea"), " More.");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Disk full")).toBeInTheDocument();
    expect(move).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("shows a failed move", async () => {
    vi.spyOn(api, "moveCard").mockRejectedValue(new Error("Branch exists"));
    const onChanged = setup();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Branch exists")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
