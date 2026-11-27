import { render, screen } from "@testing-library/react";
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
  lane: "mockup",
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
  landed: null,
  landing: false,
};

afterEach(() => vi.restoreAllMocks());

function show(over: Partial<CardDetail>) {
  render(
    <MemoryRouter>
      <LaneView live={{ detail: { ...detail, ...over }, streaming: "", activity: null }} onMoved={() => {}} />
    </MemoryRouter>,
  );
}

describe("LaneView", () => {
  it("says a lane that isn't built yet isn't implemented", () => {
    show({});
    expect(screen.getByText(/This lane isn't implemented yet/)).toBeInTheDocument();
  });

  it("gives Ship its panel and a Landing chat", async () => {
    vi.spyOn(api, "shipPlan").mockResolvedValue({
      base: "origin/main",
      uncommitted: [],
      unpushed: 0,
      tests: "npm test",
      noTestsReason: null,
      checkoutBlocks: false,
      busy: false,
    });
    show({ lane: "ship" });
    expect(await screen.findByRole("button", { name: "Land on main" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Landing" })).toBeInTheDocument();
  });

  it("shows the Done panel", () => {
    show({ lane: "done", landed: { commit: "abcdef1234", subject: "Add it", base: "origin/main", remote: true, checkout: "updated" } });
    expect(screen.getByText("abcdef1")).toBeInTheDocument();
  });
});
