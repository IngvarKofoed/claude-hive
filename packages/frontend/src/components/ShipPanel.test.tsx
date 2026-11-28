import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardDetail, Landed, ShipPlan } from "@hive/shared";
import { api } from "../api/client";
import { DonePanel, ShipPanel } from "./ShipPanel";

const detail = {
  id: "c1",
  lane: "ship",
  landing: false,
  sendBack: null,
  amendment: null,
  fromChat: null,
  chat: [],
  issues: [],
  pending: null,
  turnRunning: false,
  spec: null,
  state: "needs-you",
} as unknown as CardDetail;
const clean: ShipPlan = {
  base: "origin/main",
  uncommitted: [],
  unpushed: 0,
  tests: "npm test",
  noTestsReason: null,
  checkoutBlocks: false,
  busy: false,
};

afterEach(() => vi.restoreAllMocks());

async function show(plan: Partial<ShipPlan>, over: Partial<CardDetail> = {}, onMoved = () => {}) {
  vi.spyOn(api, "shipPlan").mockResolvedValue({ ...clean, ...plan });
  render(<ShipPanel detail={{ ...detail, ...over }} onMoved={onMoved} />);
  await screen.findByText(/Squash the card onto/);
}

const land = () => screen.getByRole("button", { name: "Land on main" });

describe("ShipPanel", () => {
  it("lands when nothing blocks", async () => {
    const spy = vi.spyOn(api, "land").mockResolvedValue({ ok: true });
    await show({});
    await userEvent.click(land());
    expect(spy).toHaveBeenCalledWith("c1");
    expect(screen.queryByRole("button", { name: "Discard them and land" })).toBeNull();
  });

  it.each([
    ["unpushed commits", { unpushed: 2 }, /2 commits that aren't on origin/],
    ["a blocked checkout", { checkoutBlocks: true }, /Commit or stash them first/],
    ["another landing", { busy: true }, /Another card of this project is landing/],
  ])("disables Land on main for %s", async (_n, plan, text) => {
    await show(plan);
    expect(land()).toBeDisabled();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(land()).toHaveAttribute("title", expect.stringMatching(text));
  });

  it("disables Land on main while landing", async () => {
    await show({}, { landing: true });
    expect(land()).toBeDisabled();
    expect(screen.getByText("Landing…")).toBeInTheDocument();
  });

  it("offers Discard with uncommitted work", async () => {
    const spy = vi.spyOn(api, "land").mockResolvedValue({ ok: true });
    await show({ uncommitted: [" M a.ts", "?? b.ts"] });
    expect(land()).toBeDisabled();
    expect(screen.getByText("?? b.ts")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Discard them and land" }));
    expect(spy).toHaveBeenCalledWith("c1", true);
  });

  it("warns when no tests will run", async () => {
    await show({ tests: null, noTestsReason: "the project has no test command" });
    expect(screen.getByText("No tests will run: the project has no test command")).toBeInTheDocument();
  });

  it("goes back to Try it, and shows errors", async () => {
    const back = vi.spyOn(api, "backToTryIt").mockResolvedValue({} as never);
    const moved = vi.fn();
    await show({}, {}, moved);
    await userEvent.click(screen.getByRole("button", { name: "Back to Try it" }));
    expect(back).toHaveBeenCalledWith("c1");
    expect(moved).toHaveBeenCalled();
    vi.spyOn(api, "land").mockRejectedValue(new Error("Nope"));
    await userEvent.click(land());
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope");
  });
});

describe("DonePanel", () => {
  const landed: Landed = { commit: "abcdef1234", subject: "Add it", base: "origin/main", remote: true, checkout: "updated" };

  it("shows the commit, the push and the checkout", () => {
    render(<DonePanel landed={landed} />);
    expect(screen.getByText("abcdef1")).toBeInTheDocument();
    expect(screen.getByText(/Add it/)).toBeInTheDocument();
    expect(screen.getByText("Pushed to origin/main")).toBeInTheDocument();
    expect(screen.getByText("Your checkout's main: up to date")).toBeInTheDocument();
  });

  it("says when local main moved and why the checkout wasn't updated", () => {
    render(<DonePanel landed={{ ...landed, remote: false, checkout: "it has uncommitted changes" }} />);
    expect(screen.getByText("Moved your local main")).toBeInTheDocument();
    expect(screen.getByText("Your checkout's main: it has uncommitted changes")).toBeInTheDocument();
  });
});
