import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardTitle } from "./CardTitle";

const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const writeText = vi.fn();

function show(over: { branch?: string | null; worktreePath?: string | null } = {}) {
  render(
    <CardTitle
      title="Bigger font"
      projectName="flux"
      branch={"branch" in over ? over.branch! : "hive/bigger-font-1"}
      worktreePath={"worktreePath" in over ? over.worktreePath! : "/repo/.claude/worktrees/bigger-font-1"}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  if (original) Object.defineProperty(navigator, "clipboard", original);
  else delete (navigator as { clipboard?: unknown }).clipboard;
});

async function click() {
  fireEvent.click(screen.getByRole("button", { name: "Bigger font" }));
  await act(async () => {});
}

describe("CardTitle", () => {
  it("makes the title a button that lists the project, branch and path as its description", () => {
    show();
    const heading = screen.getByRole("heading", { level: 1 });
    const button = screen.getByRole("button", { name: "Bigger font" });
    expect(heading).toContainElement(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    for (const text of ["flux", "hive/bigger-font-1", "/repo/.claude/worktrees/bigger-font-1", "Click to copy the path"]) {
      expect(button).toHaveAccessibleDescription(expect.stringContaining(text));
    }
  });

  it("copies the path on click, says so, and puts the line back after two seconds", async () => {
    writeText.mockResolvedValue(undefined);
    show();
    await click();
    expect(writeText).toHaveBeenCalledWith("/repo/.claude/worktrees/bigger-font-1");
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
    expect(screen.getByRole("tooltip")).toHaveAttribute("data-copied");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Click to copy the path");
    expect(screen.getByRole("tooltip")).not.toHaveAttribute("data-copied");
  });

  it("says when the path couldn't be copied, and resets", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    show();
    await click();
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't copy the path");
    expect(screen.getByRole("tooltip")).toHaveAttribute("data-copied");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Click to copy the path");
  });

  it("restarts the timer on a second click", async () => {
    writeText.mockResolvedValue(undefined);
    show();
    await click();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await click();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Click to copy the path");
  });

  it("is plain text with the project and branch, and no copy line, when only the branch is kept", () => {
    show({ worktreePath: null });
    expect(screen.queryByRole("button")).toBeNull();
    const heading = screen.getByRole("heading", { level: 1, name: "Bigger font" });
    expect(heading).toHaveAccessibleDescription(expect.stringContaining("flux"));
    expect(heading).toHaveAccessibleDescription(expect.stringContaining("hive/bigger-font-1"));
    expect(screen.queryByText("Click to copy the path")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("describes the title by the project alone with no worktree and no branch", () => {
    show({ worktreePath: null, branch: null });
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleDescription("flux");
  });
});
