import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForYouItem, ShipPlan } from "@hive/shared";

vi.mock("../api/events", () => ({
  useHiveEvents: () => {},
  useStreamOpen: () => {},
  subscribe: () => () => {},
  onStreamOpen: () => () => {},
}));

import { api } from "../api/client";
import { ForYouEntry } from "./ForYouEntry";
import { ForYouProvider } from "./forYou";

const item: ForYouItem = {
  card: { id: "c1", projectId: "p", title: "Fix fonts", lane: "ship", state: "needs-you", moveError: null },
  projectName: "flux",
  since: new Date().toISOString(),
  kind: "land",
  text: "Ready to land",
  pending: null,
  actions: [
    { id: "land", label: "Land on main", primary: true, enabled: true, reason: null },
    { id: "back-to-tryit", label: "Back to Try it", primary: false, enabled: true, reason: null },
  ],
};

const plan = (over: Partial<ShipPlan> = {}): ShipPlan => ({
  base: "origin/main",
  uncommitted: [],
  unpushed: 0,
  tests: "npm test",
  noTestsReason: null,
  checkoutBlocks: false,
  busy: false,
  ...over,
});

function show() {
  return render(
    <MemoryRouter>
      <ForYouProvider>
        <ForYouEntry item={item} nowMs={Date.now()} />
      </ForYouProvider>
    </MemoryRouter>,
  );
}

async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Land on main" }));
  return screen.findByRole("group", { name: "Land Fix fonts on main" });
}

afterEach(() => vi.restoreAllMocks());

describe("LandConfirm in a For you entry", () => {
  it("opens on Land on main without posting, reads the plan and lists its steps and warnings", async () => {
    vi.spyOn(api, "forYou").mockResolvedValue({ items: [] });
    vi.spyOn(api, "shipPlan").mockResolvedValue(plan({ tests: null, noTestsReason: "No test command.", unpushed: 2 }));
    const land = vi.spyOn(api, "land");
    show();
    await open();
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Land Fix fonts on main?")).toBeTruthy();
    expect(await screen.findByText(/Squash the card onto/)).toBeTruthy();
    expect(screen.getByText(/No tests will run: No test command\./)).toBeTruthy();
    expect(screen.getByText(/Push it to origin\/main/)).toBeTruthy();
    expect(screen.getAllByText(/2 commits that aren't on origin/).length).toBeGreaterThan(0);
    expect(land).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Back to Try it" })).toBeNull();
  });

  it("closes on Cancel and on Escape without landing", async () => {
    vi.spyOn(api, "forYou").mockResolvedValue({ items: [] });
    vi.spyOn(api, "shipPlan").mockResolvedValue(plan());
    const land = vi.spyOn(api, "land");
    show();
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group")).toBeNull();
    await open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("group")).toBeNull();
    expect(land).not.toHaveBeenCalled();
  });

  it("lands on confirm, then reloads", async () => {
    const forYou = vi.spyOn(api, "forYou").mockResolvedValue({ items: [] });
    vi.spyOn(api, "shipPlan").mockResolvedValue(plan());
    const land = vi.spyOn(api, "land").mockResolvedValue({ ok: true });
    show();
    await open();
    await screen.findByText(/Squash the card onto/);
    const before = forYou.mock.calls.length;
    fireEvent.click(screen.getAllByRole("button", { name: "Land on main" })[0]!);
    await waitFor(() => expect(land).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(forYou.mock.calls.length).toBe(before + 1));
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("greys Land on main for uncommitted files and lands with a discard", async () => {
    vi.spyOn(api, "forYou").mockResolvedValue({ items: [] });
    vi.spyOn(api, "shipPlan").mockResolvedValue(plan({ uncommitted: ["M src/a.ts"] }));
    const land = vi.spyOn(api, "land").mockResolvedValue({ ok: true });
    show();
    const row = await open();
    expect(await screen.findByText("M src/a.ts")).toBeTruthy();
    const landBtn = Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "Land on main")!;
    expect((landBtn as HTMLButtonElement).disabled).toBe(true);
    expect(landBtn.title).toBe("Uncommitted work in the card's worktree won't land.");
    expect(screen.getByText("Land on main: Uncommitted work in the card's worktree won't land.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard them and land" }));
    await waitFor(() => expect(land).toHaveBeenCalledWith("c1", true));
  });

  it("shows a failed plan read with Cancel, and a refused land in the open row", async () => {
    vi.spyOn(api, "forYou").mockResolvedValue({ items: [] });
    const shipPlan = vi.spyOn(api, "shipPlan").mockRejectedValue(new Error("Could not read the plan."));
    show();
    await open();
    expect(await screen.findByText("Could not read the plan.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    shipPlan.mockResolvedValue(plan());
    vi.spyOn(api, "land").mockRejectedValue(new Error("Another card is landing."));
    await open();
    await screen.findByText(/Squash the card onto/);
    fireEvent.click(screen.getAllByRole("button", { name: "Land on main" })[0]!);
    expect(await screen.findByText("Another card is landing.")).toBeTruthy();
    expect(screen.getByRole("group")).toBeTruthy();
  });
});
