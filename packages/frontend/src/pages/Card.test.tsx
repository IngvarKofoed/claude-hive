import { useRef, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AmendmentInfo, CardDetail, ErrorAction, ForYouItem, PendingItem, ShipPlan } from "@hive/shared";
import { api } from "../api/client";
import type { CardLive } from "../components/cardState";
import { ForYouProvider, useForYou } from "../components/forYou";
import { tagText } from "../components/ForYouEntry";
import { FROM_FOR_YOU } from "../components/fromForYou";
import { Card, LaneView, lookBackLanes } from "./Card";
import { ForYou } from "./ForYou";
import { skippedLanes } from "../components/skippedLanes";

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
  mockup: null,
  spec: null,
  specPath: null,
  plan: null,
  build: null,
  check: null,
  setup: null,
  port: null,
  feedback: null,
  shipAfterCheck: false,
  checklist: null,
  apps: [],
  appStopped: false,
  issues: [],
  decisions: [],
  chat: [],
  pastChats: {},
  history: { plans: [], builds: [], checks: [], tryit: [] },
  pending: null,
  turnRunning: false,
  landed: null,
  landing: false,
  sendBack: null,
  amendment: null,
  fromChat: null,
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
  it("gives Mockup the Designer chat with its Good buttons, and the Mockup panel above the Brief", () => {
    show({ mockup: { folder: "docs/mockups/c1", current: null, kept: null, files: [] } });
    expect(screen.getByRole("heading", { name: "Designer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Good · keep in docs/mockups" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Good · don't keep" })).toBeInTheDocument();
    expect(screen.getByText("The designer's mockup shows here once it has one.")).toBeInTheDocument();
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.indexOf("Mockup")).toBeGreaterThan(-1);
    expect(headings.indexOf("Mockup")).toBeLessThan(headings.indexOf("Brief"));
  });

  it("shows the amendment band above the Spec when the card carries one", () => {
    show({ lane: "spec", amendment: { ...amendment, summary: null, signedOff: null } });
    const band = screen.getByRole("note");
    expect(within(band).getByText("Amendment 1")).toBeInTheDocument();
    expect(within(band).getByText("Make it per printer")).toBeInTheDocument();
    expect(within(band).queryByText("Settings are now per printer.")).toBeNull();
  });

  it("gives Refine two Good buttons", () => {
    show({ lane: "refine" });
    expect(screen.getByRole("button", { name: "Good · on to Mockup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Good · skip to Spec" })).toBeInTheDocument();
  });

  it("offers Keep it after all in Spec for a mockup that wasn't kept", () => {
    show({
      lane: "spec",
      mockup: { folder: "docs/mockups/c1", current: { kind: "pages", page: "docs/mockups/c1/index.html" }, kept: false, files: ["index.html"] },
    });
    expect(screen.getByRole("button", { name: "Keep it after all" })).toBeInTheDocument();
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

describe("the live Build lane's right column", () => {
  const plan = { steps: [], chunks: [], tests: ["t"] } as unknown as CardDetail["plan"];
  const check = { round: 1, summary: "Off by one", bugs: [{ where: "a.ts:3", problem: "floor, not round" }] };

  it("shows no Plan panel, and the empty line when there's no checklist", () => {
    show({ lane: "build", plan });
    expect(screen.queryByRole("heading", { name: "Plan" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Checklist" })).toBeInTheDocument();
    expect(screen.getByText("The developer's checklist shows here once it starts one.")).toBeInTheDocument();
    expect(screen.queryByText(/Sent back from/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Check found" })).toBeNull();
  });

  it("shows the empty line for an empty list", () => {
    show({ lane: "build", checklist: [] });
    expect(screen.getByText("The developer's checklist shows here once it starts one.")).toBeInTheDocument();
  });

  it("lists the checklist with each item's status", () => {
    show({
      lane: "build",
      checklist: [
        { id: "1", text: "Read", status: "completed" },
        { id: "2", text: "Write", status: "in_progress" },
        { id: "3", text: "Test", status: "pending" },
      ],
    });
    const rows = screen.getAllByRole("listitem").filter((r) => r.hasAttribute("data-status"));
    expect(rows.map((r) => [r.textContent, r.getAttribute("data-status")])).toEqual([
      ["✓Done: Read", "completed"],
      ["▶In progress: Write", "in_progress"],
      ["○Waiting: Test", "pending"],
    ]);
    expect(screen.queryByText("The developer's checklist shows here once it starts one.")).toBeNull();
  });

  it("names where the feedback came from and keeps its text", () => {
    show({ lane: "build", feedback: "Line one\nLine two" });
    expect(screen.getByRole("heading", { name: "Sent back from Try it" })).toBeInTheDocument();
    expect(screen.getByText(/Line one/).textContent).toBe("Line one\nLine two");
    document.body.innerHTML = "";
    show({ lane: "build", feedback: "Conflict", shipAfterCheck: true });
    expect(screen.getByRole("heading", { name: "Sent back from Ship" })).toBeInTheDocument();
  });

  it("puts Check found above the checklist", () => {
    show({ lane: "build", check });
    const found = screen.getByRole("heading", { name: "Check found" });
    const list = screen.getByRole("heading", { name: "Checklist" });
    expect(found.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

const chat = (from: "you" | "product-owner" | "designer" | "spec-writer", text: string, id: string) =>
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

const amendment: AmendmentInfo = {
  n: 1,
  words: "Make it per printer",
  points: [{ what: "Per printer", kind: "spec", why: "the what was wrong" }],
  summary: "Settings are now per printer.",
  signedOff: "auto",
  reviewed: false,
};
const emptyHistory = { plans: [], builds: [], checks: [], tryit: [] };
const done = (history: Partial<CardDetail["history"]>, over: Partial<CardDetail> = {}): CardDetail => ({
  ...specCard,
  lane: "done",
  history: { ...emptyHistory, ...history },
  ...over,
});
const foldOf = (heading: string) => screen.getByText(heading).closest("details");

describe("looking back at the later lanes' rounds", () => {
  const buildRound = (summary: string) => ({
    summary,
    departures: [],
    issues: [{ where: "Rounds", problem: `${summary} problem`, guess: "built it so" }],
    decisions: [{ what: `${summary} decision`, alternative: "the other way" }],
  });

  it("lists Build rounds newest on top by position, newest open, older folded, files only on the newest", () => {
    const files = [{ path: "src/a.ts", added: 1, removed: 2 }];
    page(
      done(
        { builds: [buildRound("Third"), buildRound("Second"), buildRound("First")] },
        { build: { summary: "x", departures: [], files } as CardDetail["build"] },
      ),
      "/cards/c1?lane=build",
    );
    const headings = screen.getAllByText(/^Round \d$/).map((h) => h.textContent);
    expect(headings).toEqual(["Round 3", "Round 2", "Round 1"]);
    expect(screen.getByRole("heading", { name: "Round 3" })).toBeInTheDocument();
    expect(foldOf("Round 2")).not.toHaveAttribute("open");
    expect(foldOf("Round 1")).not.toHaveAttribute("open");
    expect(screen.getByText("Third problem")).toBeInTheDocument();
    expect(screen.getByText("Third decision")).toBeInTheDocument();
    expect(screen.getAllByText("src/a.ts")).toHaveLength(1);
    expect(screen.getAllByText("Files changed")).toHaveLength(1);
  });

  it("doesn't carry a fold you opened in one lane over to another", () => {
    const check = (summary: string) => ({ round: 1, summary, bugs: [], issues: [] });
    page(
      done({ builds: [buildRound("Second"), buildRound("First")], checks: [check("Newer"), check("Older")] }),
      "/cards/c1?lane=build",
    );
    (foldOf("Round 1") as HTMLDetailsElement).open = true;
    fireEvent.click(within(screen.getByRole("list", { name: "Lanes" })).getByRole("link", { name: "✓ Check" }));
    expect(screen.getByText("Older")).toBeInTheDocument();
    expect(foldOf("Round 1")).not.toHaveAttribute("open");
  });

  it("shows one round open with nothing folded", () => {
    page(done({ builds: [buildRound("Only")] }), "/cards/c1?lane=build");
    expect(screen.getByRole("heading", { name: "Round 1" })).toBeInTheDocument();
    expect(document.querySelector("details")).toBeNull();
  });

  it("numbers plans by position", () => {
    const plan = (summary: string) => ({ summary, steps: [], chunks: [], tests: [] }) as unknown as CardDetail["plan"];
    page(done({ plans: [plan("B")!, plan("A")!] }), "/cards/c1?lane=plan");
    expect(screen.getAllByText(/^Plan \d$/).map((h) => h.textContent)).toEqual(["Plan 2", "Plan 1"]);
  });

  it("shows Check rounds with their reported spec issues", () => {
    const record = (n: number, summary: string, issues: { where: string; problem: string; guess: string }[]) => ({
      round: 1,
      summary,
      bugs: [],
      issues,
      n,
    });
    page(
      done({
        checks: [
          record(2, "Newest summary", [{ where: "Spec §4", problem: "Unclear order", guess: "oldest first" }]),
          record(1, "Older summary", []),
        ],
      }),
      "/cards/c1?lane=check",
    );
    expect(screen.getAllByText(/^Round \d$/).map((h) => h.textContent)).toEqual(["Round 2", "Round 1"]);
    expect(screen.getByText("Unclear order")).toBeInTheDocument();
    expect(screen.getByText("Built as: oldest first")).toBeInTheDocument();
    expect(foldOf("Round 1")).not.toHaveAttribute("open");
  });

  it("shows Accepted, then Feedback rounds as written, counting only feedback", () => {
    page(
      done({
        tryit: [
          { kind: "accepted" },
          { kind: "feedback", text: "second line one\nsecond line two" },
          { kind: "feedback", text: "first" },
        ],
      }),
      "/cards/c1?lane=tryit",
    );
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getAllByText(/^Feedback \d$/).map((h) => h.textContent)).toEqual(["Feedback 2", "Feedback 1"]);
    expect(screen.getByText(/second line one/).textContent).toBe("second line one\nsecond line two");
    expect(foldOf("Feedback 1")).not.toHaveAttribute("open");
  });

  it("shows an amendment round with its words, summary and sign-off, apart from the feedback count", () => {
    page(
      done({
        tryit: [
          { kind: "amendment", amendment },
          { kind: "feedback", text: "first" },
        ],
      }),
      "/cards/c1?lane=tryit",
    );
    expect(screen.getByRole("heading", { name: "Amendment 1" })).toBeInTheDocument();
    expect(screen.getByText("Make it per printer")).toBeInTheDocument();
    expect(screen.getByText("Settings are now per printer.")).toBeInTheDocument();
    expect(screen.getByText("signed off on its own, review skipped")).toBeInTheDocument();
    expect(foldOf("Feedback 1")).not.toBeNull();
  });

  it("shows no Accepted when the card wasn't accepted", () => {
    page(done({ tryit: [{ kind: "feedback", text: "only" }] }), "/cards/c1?lane=tryit");
    expect(screen.queryByText("Accepted")).toBeNull();
    expect(screen.getByRole("heading", { name: "Feedback 1" })).toBeInTheDocument();
  });

  it("falls back to today's view when a lane's list is empty", () => {
    page(done({}), "/cards/c1?lane=build");
    expect(screen.getByText("No build report is kept.")).toBeInTheDocument();
    document.body.innerHTML = "";
    page(done({}), "/cards/c1?lane=check");
    expect(screen.getByText("No Check round is kept.")).toBeInTheDocument();
    document.body.innerHTML = "";
    page(done({}), "/cards/c1?lane=tryit");
    expect(screen.getByText("No feedback or acceptance is kept.")).toBeInTheDocument();
    document.body.innerHTML = "";
    page(done({}), "/cards/c1?lane=plan");
    expect(screen.getByText("No plan is kept.")).toBeInTheDocument();
  });
});

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

  it("shows a typed idea's own title and text for Ideas, alone on the right, with no chat panel", () => {
    page(specCard, "/cards/c1?lane=ideas");
    expect(screen.getByText("Bigger font")).toBeInTheDocument();
    expect(screen.getByText("Some users can't read the labels.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Idea" })).toBeInTheDocument();
    // A typed idea never had a chat (docs/specs/2026-11-28-chat-with-a-project-then-make-it-an-idea.md, The card page).
    expect(screen.queryByText("No chat in this lane.")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Project chat" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  describe("an idea made from a project chat", () => {
    const copy: CardDetail["chat"] = [
      { kind: "message", id: "k1", at: "t", from: "you", text: "Could the font be bigger?" },
      { kind: "message", id: "k2", at: "t", from: "project-chat", text: "It is set in the print dialog." },
    ];
    const idea = (over: Partial<CardDetail>): CardDetail => ({ ...specCard, lane: "ideas", pastChats: {}, ...over });

    it("shows the copy in a Project chat panel on the left, with a link to the chat", () => {
      page(idea({ chat: copy, fromChat: { id: "ch7", title: "Font" } }), "/cards/c1");
      expect(screen.getByRole("heading", { name: "Project chat" })).toBeInTheDocument();
      expect(screen.getByText("It is set in the print dialog.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open the chat" })).toHaveAttribute("href", "/projects/p1/chat/ch7");
      expect(screen.getByRole("textbox", { name: "Title" })).toBeInTheDocument();
    });

    it("shows the copy without the link when the chat is gone", () => {
      page(idea({ chat: copy, fromChat: null }), "/cards/c1");
      expect(screen.getByText("Could the font be bigger?")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Open the chat" })).toBeNull();
    });

    it("shows no left panel for a typed idea", () => {
      page(idea({ chat: [] }), "/cards/c1");
      expect(screen.queryByRole("heading", { name: "Project chat" })).toBeNull();
      expect(screen.getByRole("textbox", { name: "Title" })).toBeInTheDocument();
    });

    it("titles the look-back at Ideas 'Project chat', with the copy on the left of the idea", () => {
      page({ ...specCard, pastChats: { ideas: copy } }, "/cards/c1?lane=ideas");
      expect(screen.getByRole("heading", { name: "Project chat" })).toBeInTheDocument();
      const said = screen.getByText("It is set in the print dialog.");
      expect(said.compareDocumentPosition(screen.getByText("Bigger font")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
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

  it("counts every lane before the current one as finished, except a skipped one", () => {
    expect(lookBackLanes("ideas")).toEqual([]);
    expect(lookBackLanes("plan", ["mockup"])).toEqual(["ideas", "refine", "spec"]);
    expect(lookBackLanes("plan")).toEqual(["ideas", "refine", "mockup", "spec"]);
    expect(skippedLanes(specCard)).toEqual(["mockup"]);
  });

  const withMockup = (over: Partial<NonNullable<CardDetail["mockup"]>> = {}): CardDetail => ({
    ...specCard,
    pastChats: { ...specCard.pastChats, mockup: [chat("designer", "Here's a first mockup.", "m1")] },
    mockup: {
      folder: "docs/mockups/c1",
      current: { kind: "pages", page: "docs/mockups/c1/index.html" },
      kept: true,
      files: ["index.html"],
      ...over,
    },
  });

  it("links Mockup in the strip for a card that made one, and looks back at the Designer chat and the mockup", () => {
    page({ ...withMockup(), worktreePath: "/r/.claude/worktrees/c1" }, "/cards/c1");
    const strip = screen.getByRole("list", { name: "Lanes" });
    expect(within(strip).getByRole("link", { name: "✓ Mockup" })).toHaveAttribute("href", "/cards/c1?lane=mockup");
    fireEvent.click(within(strip).getByRole("link", { name: "✓ Mockup" }));
    expect(screen.getByText(/Looking back at Mockup/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Designer" })).toBeInTheDocument();
    expect(screen.getByText("Here's a first mockup.")).toBeInTheDocument();
    expect(screen.getByText("Kept in docs/mockups/c1/")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "index.html" })).toHaveAttribute("href", "/api/cards/c1/mockup/index.html");
  });

  it("shows no Mockup look-back for a skipped lane, even when asked for by address", () => {
    page(specCard, "/cards/c1?lane=mockup");
    expect(screen.queryByText(/Looking back/)).toBeNull();
  });
});

describe("the card page's top band", () => {
  const kept = { ...specCard, branch: "hive/bigger-font-1", worktreePath: "/repo/.claude/worktrees/bigger-font-1" };

  it("has no breadcrumb, and keeps the branch and path inside the title's hover card", () => {
    page(kept, "/cards/c1");
    expect(screen.queryByRole("link", { name: "Board" })).toBeNull();
    expect(screen.queryByText(/›/)).toBeNull();
    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("hive/bigger-font-1")).toBeInTheDocument();
    expect(within(tooltip).getByText("/repo/.claude/worktrees/bigger-font-1")).toBeInTheDocument();
    expect(screen.getAllByText("hive/bigger-font-1")).toHaveLength(1);
    expect(screen.getAllByText("/repo/.claude/worktrees/bigger-font-1")).toHaveLength(1);
  });

  it("puts the lane strip and Delete card in one group beside the title's, inside one band", () => {
    page(kept, "/cards/c1");
    const strip = screen.getByRole("list", { name: "Lanes" });
    const del = screen.getByRole("button", { name: "Delete card" });
    const endGroup = strip.parentElement!;
    expect(del.parentElement).toBe(endGroup);
    const titleGroup = screen.getByRole("heading", { level: 1, name: "T" }).closest("div")!.parentElement!;
    expect(titleGroup).toContainElement(screen.getByText("● needs you"));
    expect(titleGroup).not.toBe(endGroup);
    expect(titleGroup.parentElement).toBe(endGroup.parentElement);
  });

  it("leaves the title plain on an idea and on a landed card", () => {
    page({ ...specCard, lane: "ideas", pastChats: {} }, "/cards/c1");
    expect(screen.getByRole("heading", { level: 1, name: "T" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "T" })).toBeNull();
    expect(screen.queryByText("Click to copy the path")).toBeNull();
  });

  it("leaves the title plain on a landed card too", () => {
    page(done({}), "/cards/c1");
    expect(screen.queryByRole("button", { name: "T" })).toBeNull();
    expect(screen.queryByText("Click to copy the path")).toBeNull();
    expect(screen.queryByText("● needs you")).toBeNull();
  });

  it("opens the delete confirm in the strip's group, after the strip", () => {
    page(kept, "/cards/c1");
    const endGroup = screen.getByRole("list", { name: "Lanes" }).parentElement!;
    fireEvent.click(screen.getByRole("button", { name: "Delete card" }));
    const confirm = screen.getByRole("group", { name: "Delete this card" });
    expect(confirm.parentElement).toBe(endGroup);
    expect(endGroup.lastElementChild).toBe(confirm);
  });
});

describe("the card page's chat panels", () => {
  it("frames the chat in a chat lane, with Good in Send's row in Refine", () => {
    show({ lane: "refine" });
    expect(screen.getByRole("log").closest("[data-framed]")).not.toBeNull();
    const send = screen.getByRole("button", { name: "Send" });
    expect(send.parentElement).toContainElement(screen.getByRole("button", { name: "Good · on to Mockup" }));
  });

  it("leaves Ship's Landing chat unframed", async () => {
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
    await screen.findByRole("button", { name: "Land on main" });
    expect(screen.getByRole("log").closest("[data-framed]")).toBeNull();
  });
});

// docs/specs/2026-11-28-back-to-for-you-after-a-lane-action.md
describe("back to For you after a lane action", () => {
  type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
  const deferred = <T,>(): Deferred<T> => {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };
  const entry = (kind: ForYouItem["kind"], lane: CardDetail["lane"]): ForYouItem => ({
    card: { id: "c1", projectId: "p1", title: "T", lane, state: "needs-you", moveError: null },
    projectName: "m",
    since: new Date().toISOString(),
    kind,
    text: "Waiting for you",
    pending: null,
    actions: [],
  });
  const cleanPlan: ShipPlan = {
    base: "origin/main",
    uncommitted: [],
    unpushed: 0,
    tests: "npm test",
    noTestsReason: null,
    checkoutBlocks: false,
    busy: false,
  };
  const errorLine = (...actions: ErrorAction[]) =>
    ({ kind: "error", id: "e1", at: "t", message: "The turn failed.", actions }) as const;
  const refineCard: CardDetail = { ...detail, lane: "refine", chat: [chat("product-owner", "Ready when you are.", "p1")] };
  const tryItCard: CardDetail = { ...specCard, lane: "tryit", spec: { ...specCard.spec!, review: "fresh" }, chat: [] };

  let go: (to: string) => void = () => {};
  function Nav() {
    const navigate = useNavigate();
    go = (to) => void navigate(to);
    return null;
  }
  function Where() {
    return <p data-testid="where">{useLocation().pathname}</p>;
  }
  const where = () => screen.getByTestId("where").textContent;

  /** The card page inside the app's providers, with a stand-in For you page unless one is given. */
  function open(card: CardDetail, opts: { url?: string; state?: unknown; forYou?: ReactNode } = {}) {
    const { url = "/cards/c1", forYou = <p>For you page</p> } = opts;
    // An explicit `state: undefined` is a visit with no state, not a default.
    const state = "state" in opts ? opts.state : FROM_FOR_YOU;
    liveCard.current = { detail: card, streaming: "", activity: null };
    const [pathname, search = ""] = url.split("?");
    render(
      <MemoryRouter initialEntries={[{ pathname, search: search ? `?${search}` : "", state }]}>
        <ForYouProvider>
          <Nav />
          <Where />
          <Routes>
            <Route path="/cards/:id" element={<Card />} />
            <Route path="/for-you" element={forYou} />
          </Routes>
        </ForYouProvider>
      </MemoryRouter>,
    );
  }

  it("goes back to For you after Good, once the list has reloaded, and the card isn't listed (How to verify 1)", async () => {
    const reloaded = deferred<{ items: ForYouItem[] }>();
    const forYou = vi
      .spyOn(api, "forYou")
      .mockResolvedValueOnce({ items: [entry("your-turn", "refine")] })
      .mockReturnValueOnce(reloaded.promise);
    const good = vi.spyOn(api, "good").mockResolvedValue({} as never);
    open(refineCard, { forYou: <ForYou /> });
    await waitFor(() => expect(forYou).toHaveBeenCalledTimes(1));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Good · on to Mockup" })));
    expect(good).toHaveBeenCalledWith("c1", { skipMockup: false });
    expect(forYou).toHaveBeenCalledTimes(2);
    // The reload is held: still on the card.
    expect(where()).toBe("/cards/c1");
    expect(screen.getByRole("heading", { name: "Product owner" })).toBeInTheDocument();
    await act(async () => reloaded.resolve({ items: [] }));
    expect(where()).toBe("/for-you");
    expect(screen.getByRole("heading", { name: "For you" })).toBeInTheDocument();
    expect(screen.queryByText("m · T")).toBeNull();
  });

  it("keeps the memory while looking back at a lane, and goes back to For you after Review (How to verify 2)", async () => {
    for (const way of ["Back to Spec link", "● Spec in the strip"]) {
      const forYou = vi
        .spyOn(api, "forYou")
        .mockResolvedValueOnce({ items: [entry("your-turn", "spec")] })
        .mockResolvedValueOnce({ items: [] });
      vi.spyOn(api, "review").mockResolvedValue({} as never);
      open(specCard, { forYou: <ForYou /> });
      await waitFor(() => expect(forYou).toHaveBeenCalledTimes(1));
      const strip = screen.getByRole("list", { name: "Lanes" });
      fireEvent.click(within(strip).getByRole("link", { name: "✓ Refine" }));
      expect(screen.getByText(/Looking back at Refine/)).toBeInTheDocument();
      if (way === "Back to Spec link") fireEvent.click(screen.getByRole("link", { name: "Back to Spec" }));
      else fireEvent.click(within(strip).getByRole("link", { name: "● Spec" }));
      expect(screen.queryByText(/Looking back/)).toBeNull();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Review" })));
      await waitFor(() => expect(where()).toBe("/for-you"));
      expect(forYou).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Nothing is waiting for you. Everything is running on its own.")).toBeInTheDocument();
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it("lands on a fresh For you after Accept, with the card as Ship · land on main from the first render (How to verify 3)", async () => {
    const firstRender: string[][] = [];
    function FirstRender() {
      const { items } = useForYou();
      const seen = useRef(false);
      if (!seen.current) {
        seen.current = true;
        firstRender.push(items.map(tagText));
      }
      return <ForYou />;
    }
    vi.spyOn(api, "forYou")
      .mockResolvedValueOnce({ items: [entry("try-it", "tryit")] })
      .mockResolvedValueOnce({ items: [entry("land", "ship")] });
    vi.spyOn(api, "accept").mockResolvedValue({} as never);
    open(tryItCard, { forYou: <FirstRender /> });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept" })));
    await waitFor(() => expect(where()).toBe("/for-you"));
    expect(firstRender).toEqual([["Ship · land on main"]]);
    expect(screen.getByText("Ship · land on main")).toBeInTheDocument();
  });

  it("stays on the card with the refusal when Land on main is refused (How to verify 4)", async () => {
    const forYou = vi.spyOn(api, "forYou").mockResolvedValue({ items: [entry("land", "ship")] });
    vi.spyOn(api, "shipPlan").mockResolvedValue(cleanPlan);
    const land = vi
      .spyOn(api, "land")
      .mockRejectedValue(new Error("The card's worktree has uncommitted work. Commit it, or discard it and land."));
    open({ ...detail, lane: "ship" });
    const button = await screen.findByRole("button", { name: "Land on main" });
    await waitFor(() => expect(button).toBeEnabled());
    await act(async () => fireEvent.click(button));
    expect(land).toHaveBeenCalledWith("c1");
    expect(await screen.findByRole("alert")).toHaveTextContent("uncommitted work");
    expect(where()).toBe("/cards/c1");
    expect(forYou).toHaveBeenCalledTimes(1);
  });

  it("stays on a card opened from the board or a typed address (How to verify 5)", async () => {
    for (const state of [null, undefined, { from: "board" }]) {
      const forYou = vi.spyOn(api, "forYou").mockResolvedValue({ items: [entry("your-turn", "refine")] });
      const good = vi.spyOn(api, "good").mockResolvedValue({} as never);
      open(refineCard, { state });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Good · on to Mockup" })));
      expect(good).toHaveBeenCalledTimes(1);
      expect(where()).toBe("/cards/c1");
      expect(forYou).toHaveBeenCalledTimes(1);
      cleanup();
      vi.restoreAllMocks();
    }
  });

  const mockupCard: CardDetail = {
    ...detail,
    lane: "mockup",
    mockup: { folder: "docs/mockups/c1", current: { kind: "pages", page: "docs/mockups/c1/index.html" }, kept: null, files: ["index.html"] },
  };
  const goesBack: { action: string; card: CardDetail; call: keyof typeof api; args: unknown[]; before?: () => void }[] = [
    { action: "Good · skip to Spec", card: refineCard, call: "good", args: ["c1", { skipMockup: true }] },
    { action: "Good · keep in docs/mockups", card: mockupCard, call: "good", args: ["c1", { keep: true }] },
    { action: "Good · don't keep", card: mockupCard, call: "good", args: ["c1", { keep: false }] },
    { action: "Sign off", card: { ...specCard, spec: { ...specCard.spec!, review: "fresh" } }, call: "signoff", args: ["c1"] },
    {
      action: "Send back",
      card: tryItCard,
      call: "feedback",
      args: ["c1", "The label overlaps."],
      before: () =>
        fireEvent.change(screen.getByRole("textbox", { name: "What you found" }), { target: { value: "The label overlaps." } }),
    },
    { action: "Retry", card: { ...tryItCard, chat: [errorLine("retry")] }, call: "retry", args: ["c1"] },
    { action: "Land on main", card: { ...detail, lane: "ship" }, call: "land", args: ["c1"] },
    { action: "Back to Try it", card: { ...detail, lane: "ship" }, call: "backToTryIt", args: ["c1"] },
    { action: "Retry", card: { ...detail, lane: "plan", chat: [errorLine("retry", "back-to-spec")] }, call: "retry", args: ["c1"] },
    { action: "Back to Spec", card: { ...detail, lane: "build", chat: [errorLine("retry", "back-to-spec")] }, call: "backToSpec", args: ["c1"] },
    { action: "Back to Build", card: { ...detail, lane: "check", chat: [errorLine("back-to-build", "move-on")] }, call: "backToBuild", args: ["c1"] },
    { action: "Move on", card: { ...detail, lane: "check", chat: [errorLine("back-to-build", "move-on")] }, call: "moveOn", args: ["c1"] },
    { action: "Review", card: { ...specCard, chat: [errorLine("review")] }, call: "review", args: ["c1"] },
  ];

  it.each(goesBack)("goes back to For you after $action in $card.lane", async ({ action, card, call, args, before }) => {
    const forYou = vi.spyOn(api, "forYou").mockResolvedValue({ items: [] });
    const spy = vi.spyOn(api, call as "retry").mockResolvedValue({} as never);
    vi.spyOn(api, "shipPlan").mockResolvedValue(cleanPlan);
    open(card);
    before?.();
    const buttons = await screen.findAllByRole("button", { name: action });
    // Review on a Spec card with an error line shows twice: the bar's and the line's. The line's is the last.
    const button = buttons.at(-1)!;
    await waitFor(() => expect(button).toBeEnabled());
    await act(async () => fireEvent.click(button));
    expect(spy).toHaveBeenCalledWith(...args);
    await waitFor(() => expect(where()).toBe("/for-you"));
    expect(forYou).toHaveBeenCalledTimes(2);
  });

  it("goes back to For you after Discard them and land", async () => {
    vi.spyOn(api, "forYou").mockResolvedValue({ items: [] });
    vi.spyOn(api, "shipPlan").mockResolvedValue({ ...cleanPlan, uncommitted: ["?? notes.txt"] });
    const land = vi.spyOn(api, "land").mockResolvedValue({ ok: true });
    open({ ...detail, lane: "ship" });
    const button = await screen.findByRole("button", { name: "Discard them and land" });
    await waitFor(() => expect(button).toBeEnabled());
    await act(async () => fireEvent.click(button));
    expect(land).toHaveBeenCalledWith("c1", true);
    await waitFor(() => expect(where()).toBe("/for-you"));
  });

  it("stays on the card after Stop, Send, answering a question and Try it's app Start", async () => {
    const question: PendingItem = {
      id: "q1",
      kind: "question",
      questions: [{ question: "Round up or down?", header: "Size", multiSelect: false, options: [{ label: "Up", description: "" }] }],
    };
    const setupDone: CardDetail["setup"] = {
      status: "done",
      reason: null,
      copied: [],
      leftOut: [],
      installed: "npm ci",
      start: [{ what: "app", command: "npm run dev", dir: ".", port: 5230, url: "http://localhost:5230" }],
      test: "npm test",
      shared: [],
      notes: "",
    };
    const cases: {
      name: string;
      card: CardDetail;
      prepare?: () => void;
      press: () => void;
      spy: () => ReturnType<typeof vi.spyOn>;
    }[] = [
      {
        name: "Stop in a running Plan card's footer",
        card: { ...detail, lane: "plan", state: "working", turnRunning: true },
        press: () => fireEvent.click(screen.getByRole("button", { name: "Stop" })),
        spy: () => vi.spyOn(api, "stop").mockResolvedValue({} as never),
      },
      {
        name: "Stop beside Send in Refine",
        card: { ...refineCard, state: "working", turnRunning: true },
        press: () => fireEvent.click(screen.getByRole("button", { name: "Stop" })),
        spy: () => vi.spyOn(api, "stop").mockResolvedValue({} as never),
      },
      {
        name: "Send in Refine's chat",
        card: refineCard,
        prepare: () =>
          fireEvent.change(screen.getByRole("textbox", { name: "Your reply" }), { target: { value: "Per printer." } }),
        press: () => fireEvent.click(screen.getByRole("button", { name: "Send" })),
        spy: () => vi.spyOn(api, "sendMessage").mockResolvedValue({} as never),
      },
      {
        name: "answering a pending question",
        card: { ...detail, lane: "plan", pending: question },
        prepare: () => fireEvent.click(screen.getByRole("button", { name: "Up" })),
        press: () => fireEvent.click(screen.getByRole("button", { name: "Send" })),
        spy: () => vi.spyOn(api, "answer").mockResolvedValue({} as never),
      },
      {
        name: "Try it's app Start",
        card: { ...tryItCard, setup: setupDone },
        press: () => fireEvent.click(screen.getByRole("button", { name: "Start" })),
        spy: () => vi.spyOn(api, "appStart").mockResolvedValue({} as never),
      },
    ];
    for (const { name, card, prepare, press, spy } of cases) {
      const forYou = vi.spyOn(api, "forYou").mockResolvedValue({ items: [] });
      const called = spy();
      open(card);
      prepare?.();
      await act(async () => press());
      expect(called, name).toHaveBeenCalled();
      await act(async () => {});
      expect(where(), name).toBe("/cards/c1");
      expect(forYou, name).toHaveBeenCalledTimes(1);
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it("doesn't go back when Good's answer arrives after you went to another page or card", async () => {
    for (const elsewhere of ["/", "/cards/c2"]) {
      const answered = deferred<unknown>();
      const forYou = vi.spyOn(api, "forYou").mockResolvedValue({ items: [] });
      vi.spyOn(api, "good").mockReturnValue(answered.promise as never);
      open(refineCard);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Good · on to Mockup" })));
      act(() => go(elsewhere));
      await act(async () => answered.resolve({}));
      await act(async () => {});
      expect(where(), elsewhere).toBe(elsewhere);
      expect(forYou, elsewhere).toHaveBeenCalledTimes(1);
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it("doesn't go back when the list's reload arrives after you went to another page or card", async () => {
    for (const elsewhere of ["/", "/cards/c2"]) {
      const reloaded = deferred<{ items: ForYouItem[] }>();
      vi.spyOn(api, "forYou").mockResolvedValueOnce({ items: [] }).mockReturnValueOnce(reloaded.promise);
      vi.spyOn(api, "good").mockResolvedValue({} as never);
      open(refineCard);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Good · on to Mockup" })));
      expect(where()).toBe("/cards/c1");
      act(() => go(elsewhere));
      await act(async () => reloaded.resolve({ items: [] }));
      expect(where(), elsewhere).toBe(elsewhere);
      cleanup();
      vi.restoreAllMocks();
    }
  });
});
