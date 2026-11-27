import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardDetail } from "@hive/shared";
import { api } from "../api/client";
import { LaneView } from "./Card";

const detail: CardDetail = {
  id: "c1",
  projectId: "p1",
  projectName: "m",
  title: "T",
  ideaText: "i",
  lane: "ship",
  state: "needs-you",
  moveError: null,
  branch: null,
  worktreePath: null,
  brief: null,
  spec: null,
  plan: null,
  build: null,
  check: null,
  setup: null,
  port: null,
  feedback: null,
  apps: [],
  appStopped: false,
  issues: [],
  decisions: [],
  chat: [],
  pending: null,
  turnRunning: false,
};

afterEach(() => vi.restoreAllMocks());

describe("Ship page", () => {
  it("offers Back to Try it beside the not-implemented notice", async () => {
    const back = vi.spyOn(api, "backToTryIt").mockResolvedValue({} as never);
    const onMoved = vi.fn();
    render(
      <MemoryRouter>
        <LaneView live={{ detail, streaming: "", activity: null }} onMoved={onMoved} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/This lane isn't implemented yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back to Try it" }));
    expect(back).toHaveBeenCalledWith("c1");
    expect(onMoved).toHaveBeenCalled();
  });
});
