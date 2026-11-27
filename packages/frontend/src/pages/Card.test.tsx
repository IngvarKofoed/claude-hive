import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardDetail } from "@hive/shared";
import { api } from "../api/client";
import type { CardLive } from "../components/cardState";
import { Card, LaneView, lookBackLanes } from "./Card";

// The full page is rendered with its header stubbed and its live state handed in, so these tests reach no backend.
vi.mock("../components/Header", () => ({ Header: () => null }));
const liveCard = vi.hoisted(() => ({ current: null as CardLive | null }));
vi.mock("../components/useCardLive", () => ({
  useCardLive: () => ({ live: liveCard.current, error: null, reload: async () => {}, gone: false }),
}));

const detail: CardDetail = {
  id: "c1",
  projectId: "p1",
  projectName: "m",
  title: "T",
  ideaTitle: "i",
  ideaText: "i",
  lane: "mockup",
  state: "needs-you",
  moveError: null,
  branch: null,
  worktreePath: null,
  brief: null,
  spec: null,
  specPath: null,
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
  pastChats: {},
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

const chat = (from: "you" | "product-owner" | "spec-writer", text: string, id: string) =>
  ({ kind: "message", id, at: "t", from, text }) as const;

const specCard: CardDetail = {
  ...detail,
  lane: "spec",
  ideaTitle: "Bigger font",
  ideaText: "Some users can't read the labels.",
  brief: {
    title: "Adjustable printer font",
    problem: "Labels are too small to read.",
    whoItsFor: "Operators",
    whatDoneLooksLike: ["Font size per printer"],
    outOfScope: [],
    openPoints: [],
  },
  spec: { path: "docs/specs/x.md", text: "# The spec", review: "none" },
  specPath: "docs/specs/x.md",
  chat: [chat("spec-writer", "Here's the spec.", "s1")],
  pastChats: { refine: [chat("product-owner", "Per printer, or for all?", "r1"), chat("you", "Per printer.", "r2")] },
};

function page(card: CardDetail, url: string) {
  liveCard.current = { detail: card, streaming: "", activity: null };
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/cards/:id" element={<Card />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("looking back at a finished lane", () => {
  it("shows Refine's chat read-only next to the brief, with the way back to the current lane", () => {
    page(specCard, "/cards/c1?lane=refine");
    expect(screen.getByText(/Looking back at Refine/)).toBeInTheDocument();
    expect(screen.getByText("Per printer, or for all?")).toBeInTheDocument();
    expect(screen.getByText("Per printer.")).toBeInTheDocument();
    expect(screen.getByText("Labels are too small to read.")).toBeInTheDocument();
    // Nothing to type into or press: no reply box, no Send, no Good, no Review. Only the title row's Delete is left.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Delete card"]);
    // The spec writer's live chat isn't shown while looking back.
    expect(screen.queryByText("Here's the spec.")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Spec" })).toBeInTheDocument();
  });

  it("shows the idea's own title and text for Ideas, on the right, after an empty chat", () => {
    page(specCard, "/cards/c1?lane=ideas");
    const noChat = screen.getByText("No chat in this lane.");
    const idea = screen.getByText("Bigger font");
    expect(noChat.compareDocumentPosition(idea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Some users can't read the labels.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("says where the spec is when it can't be read, as on a landed card", () => {
    const landed = { commit: "abcdef1234", subject: "Add it", base: "origin/main", remote: true, checkout: "updated" };
    page({ ...specCard, lane: "done", spec: null, landed, pastChats: {} }, "/cards/c1?lane=spec");
    expect(screen.getByText("The spec can't be shown here: it's on main at docs/specs/x.md.")).toBeInTheDocument();
    expect(screen.getByText("No chat in this lane.")).toBeInTheDocument();
  });

  it("doesn't say the spec is on main for a card that hasn't landed", () => {
    page({ ...specCard, lane: "plan", spec: null, landed: null, pastChats: {} }, "/cards/c1?lane=spec");
    expect(screen.getByText("The spec can't be shown here.")).toBeInTheDocument();
  });

  it("shows the current lane for anything that isn't a finished lane", () => {
    for (const lane of ["spec", "plan", "mockup", "done", "nonsense"]) {
      page(specCard, `/cards/c1?lane=${lane}`);
      expect(screen.queryByText(/Looking back/)).toBeNull();
      expect(screen.getByRole("heading", { name: "Spec writer" })).toBeInTheDocument();
      document.body.innerHTML = "";
    }
  });

  it("links finished lanes in the strip, skips Mockup, and links the current lane only as the way back", () => {
    page(specCard, "/cards/c1");
    const strip = screen.getByRole("list", { name: "Lanes" });
    expect(within(strip).getByRole("link", { name: "✓ Ideas" })).toHaveAttribute("href", "/cards/c1?lane=ideas");
    expect(within(strip).getByRole("link", { name: "✓ Refine" })).toHaveAttribute("href", "/cards/c1?lane=refine");
    expect(within(strip).getByText("– Mockup")).not.toHaveAttribute("href");
    expect(within(strip).queryByRole("link", { name: /Spec/ })).toBeNull();
    expect(within(strip).queryByRole("link", { name: /Plan/ })).toBeNull();

    fireEvent.click(within(strip).getByRole("link", { name: "✓ Refine" }));
    expect(screen.getByText(/Looking back at Refine/)).toBeInTheDocument();
    expect(within(strip).getByText("✓ Refine")).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(strip).getByRole("link", { name: "● Spec" }));
    expect(screen.queryByText(/Looking back/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Spec writer" })).toBeInTheDocument();
  });

  it("gives an idea's page the editor and no badge, as on the board", () => {
    page({ ...specCard, lane: "ideas", pastChats: {} }, "/cards/c1");
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Bigger font");
    expect(screen.getByRole("textbox", { name: "Idea" })).toHaveValue("Some users can't read the labels.");
    expect(screen.queryByText("● needs you")).toBeNull();
  });

  it("counts only built lanes before the current one as finished", () => {
    expect(lookBackLanes("ideas")).toEqual([]);
    expect(lookBackLanes("plan")).toEqual(["ideas", "refine", "spec"]);
  });
});
