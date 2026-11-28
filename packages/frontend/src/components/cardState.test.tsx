import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { describe, expect, it } from "vitest";
import type { CardDetail } from "@hive/shared";
import { applyCardEvent, type CardLive } from "./cardState";
import { api } from "../api/client";
import { Chat } from "./Chat";

const detail: CardDetail = {
  id: "c1",
  projectId: "p1",
  projectName: "magic-grow",
  title: "Seed price history",
  ideaTitle: "idea",
  ideaText: "idea",
  lane: "refine",
  state: "working",
  moveError: null,
  branch: "hive/x",
  worktreePath: "/r/.claude/worktrees/x",
  brief: null,
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
  turnRunning: true,
  landed: null,
  landing: false,
};
const start: CardLive = { detail, streaming: "", activity: null };

describe("applyCardEvent", () => {
  it("applies setup.updated to the card's setup and port, and ignores other cards", () => {
    const setup = {
      status: "done" as const,
      reason: null,
      copied: [],
      leftOut: [],
      installed: "npm ci",
      start: [],
      test: "npm test",
      shared: [],
      notes: "",
    };
    const s = applyCardEvent(start, { type: "setup.updated", cardId: "c1", setup, port: 5300 });
    expect(s.detail.setup).toEqual(setup);
    expect(s.detail.port).toBe(5300);
    expect(applyCardEvent(start, { type: "setup.updated", cardId: "other", setup, port: 1 })).toBe(start);
  });

  it("applies app.updated to the card's apps and appStopped, and ignores other cards", () => {
    const apps = [{ what: "the app", port: 5300, url: "http://localhost:5300", state: "running" as const, reason: null, output: ["hi"] }];
    const s = applyCardEvent(start, { type: "app.updated", cardId: "c1", apps, appStopped: true });
    expect(s.detail.apps).toEqual(apps);
    expect(s.detail.appStopped).toBe(true);
    expect(applyCardEvent(start, { type: "app.updated", cardId: "other", apps, appStopped: true })).toBe(start);
  });

  it("appends deltas, then a message replaces the streaming text", () => {
    let s = applyCardEvent(start, { type: "chat.delta", cardId: "c1", text: "Hel" });
    s = applyCardEvent(s, { type: "chat.delta", cardId: "c1", text: "lo" });
    expect(s.streaming).toBe("Hello");

    s = applyCardEvent(s, {
      type: "chat.message",
      cardId: "c1",
      item: { kind: "message", id: "m1", at: "t", from: "product-owner", text: "Hello" },
    });
    expect(s.streaming).toBe("");
    expect(s.detail.chat).toHaveLength(1);
  });

  it("keeps the text being written when your own message arrives mid-turn", () => {
    const start: CardLive = { detail, streaming: "Draft br", activity: null };
    const s = applyCardEvent(start, {
      type: "chat.message",
      cardId: "c1",
      item: { kind: "message", id: "y1", at: "2026-11-26T10:00:00Z", from: "you", text: "Per printer" },
    });
    expect(s.streaming).toBe("Draft br");
    expect(s.detail.chat.at(-1)).toMatchObject({ from: "you" });
  });

  it("does not add the same message twice", () => {
    const item = { kind: "message", id: "m1", at: "t", from: "you", text: "hi" } as const;
    let s = applyCardEvent(start, { type: "chat.message", cardId: "c1", item });
    s = applyCardEvent(s, { type: "chat.message", cardId: "c1", item });
    expect(s.detail.chat).toHaveLength(1);
  });

  it("ignores events for other cards", () => {
    expect(applyCardEvent(start, { type: "chat.delta", cardId: "other", text: "x" })).toBe(start);
  });

  it("stores the spec and the plan from their events", () => {
    const spec = { path: "docs/specs/x.md", text: "# X", review: "fresh" as const };
    let s = applyCardEvent(start, { type: "spec.updated", cardId: "c1", spec });
    expect(s.detail.spec).toEqual(spec);
    const plan = { steps: [], chunks: [], tests: ["t"] };
    s = applyCardEvent(s, { type: "plan.updated", cardId: "c1", plan });
    expect(s.detail.plan).toEqual(plan);
    expect(applyCardEvent(start, { type: "spec.updated", cardId: "other", spec })).toBe(start);
    expect(applyCardEvent(start, { type: "plan.updated", cardId: "other", plan })).toBe(start);
  });

  it("takes the developer's checklist from checklist.updated, for its own card only", () => {
    const checklist = [{ id: "1", text: "Write it", status: "in_progress" as const }];
    const s = applyCardEvent(start, { type: "checklist.updated", cardId: "c1", checklist });
    expect(s.detail.checklist).toEqual(checklist);
    expect(applyCardEvent(start, { type: "checklist.updated", cardId: "other", checklist })).toBe(start);
  });

  it("takes a finished Check round and its issues from check.updated", () => {
    const check = { round: 2, summary: "Still off by one", bugs: [{ where: "a.ts:3", problem: "floor, not round" }] };
    const issues = [{ id: "i1", foundIn: "check" as const, where: "Outcome", problem: "silent", guess: "kept it" }];
    const s = applyCardEvent(start, { type: "check.updated", cardId: "c1", check, issues });
    expect(s.detail.check).toEqual(check);
    expect(s.detail.issues).toEqual(issues);
    expect(applyCardEvent(start, { type: "check.updated", cardId: "other", check, issues })).toBe(start);
  });

  it("takes a lane change from card.updated", () => {
    const s = applyCardEvent(start, {
      type: "card.updated",
      card: { id: "c1", projectId: "p1", title: "Seed price history", lane: "spec", state: "working", moveError: null },
    });
    expect(s.detail.lane).toBe("spec");
  });

  it("sets and clears the activity, and toggles the turn", () => {
    let s = applyCardEvent(start, { type: "chat.activity", cardId: "c1", text: "reading src/a.ts…" });
    expect(s.activity).toBe("reading src/a.ts…");
    s = applyCardEvent(s, { type: "chat.activity", cardId: "c1", text: null });
    expect(s.activity).toBeNull();
    s = applyCardEvent(s, { type: "turn.ended", cardId: "c1" });
    expect(s.detail.turnRunning).toBe(false);
    s = applyCardEvent(s, { type: "turn.started", cardId: "c1" });
    expect(s.detail.turnRunning).toBe(true);
  });
});

describe("Chat", () => {
  it("shows streaming text, Stop while a turn runs, and Retry on a retryable error", () => {
    const withError: CardDetail = {
      ...detail,
      chat: [
        { kind: "message", id: "m1", at: "t", from: "you", text: "hello there" },
        { kind: "error", id: "e1", at: "t", message: "Not logged in", actions: ["retry"] },
      ],
    };
    render(<Chat detail={withError} streaming="Partial rep" activity="reading a.ts…" />);
    expect(screen.getByText("hello there")).toBeInTheDocument();
    expect(screen.getByText("Partial rep")).toBeInTheDocument();
    expect(screen.getByText("reading a.ts…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows a question with its options", () => {
    const withQuestion: CardDetail = {
      ...detail,
      turnRunning: false,
      pending: {
        id: "p1",
        kind: "question",
        questions: [
          {
            question: "How far back?",
            header: "Window",
            multiSelect: false,
            options: [{ label: "30 days", description: "" }],
          },
        ],
      },
    };
    render(<Chat detail={withQuestion} streaming="" activity={null} />);
    expect(screen.getByText("How far back?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30 days" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("shows one button per error action and calls the matching endpoint", async () => {
    const retry = vi.spyOn(api, "retry").mockResolvedValue(undefined);
    const review = vi.spyOn(api, "review").mockResolvedValue({ ok: true });
    const back = vi.spyOn(api, "backToSpec").mockResolvedValue({} as never);
    const backBuild = vi.spyOn(api, "backToBuild").mockResolvedValue({} as never);
    const moveOn = vi.spyOn(api, "moveOn").mockResolvedValue({} as never);
    const withError: CardDetail = {
      ...detail,
      turnRunning: false,
      chat: [
        { kind: "error", id: "e1", at: "t", message: "Blocked", actions: ["retry", "review", "back-to-spec", "back-to-build", "move-on"] },
        { kind: "error", id: "e2", at: "t", message: "Plain", actions: [] },
      ],
    };
    render(<Chat detail={withError} streaming="" activity={null} />);
    expect(screen.getAllByRole("button", { name: /Retry|Review again|Back to Spec|Back to Build|Move on/ })).toHaveLength(5);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await userEvent.click(screen.getByRole("button", { name: "Review again" }));
    await userEvent.click(screen.getByRole("button", { name: "Back to Spec" }));
    await userEvent.click(screen.getByRole("button", { name: "Back to Build" }));
    await userEvent.click(screen.getByRole("button", { name: "Move on" }));
    expect(backBuild).toHaveBeenCalledWith("c1");
    expect(moveOn).toHaveBeenCalledWith("c1");
    expect(retry).toHaveBeenCalledWith("c1");
    expect(review).toHaveBeenCalledWith("c1");
    expect(back).toHaveBeenCalledWith("c1");
    vi.restoreAllMocks();
  });

  it("has no reply box in Check, and labels the reviewer", () => {
    const chat: CardDetail["chat"] = [{ kind: "message", id: "1", at: "t", from: "reviewer", text: "Found one bug" }];
    render(<Chat detail={{ ...detail, lane: "check", turnRunning: false, chat }} streaming="" activity={null} />);
    expect(screen.queryByLabelText("Your reply")).toBeNull();
    expect(screen.getByText("Reviewer")).toBeInTheDocument();
  });

  it("labels each author and shows hive notes as a quiet line", () => {
    const chat: CardDetail["chat"] = [
      { kind: "message", id: "1", at: "t", from: "you", text: "a" },
      { kind: "message", id: "2", at: "t", from: "product-owner", text: "b" },
      { kind: "message", id: "3", at: "t", from: "spec-writer", text: "c" },
      { kind: "message", id: "4", at: "t", from: "planner", text: "d" },
      { kind: "message", id: "5", at: "t", from: "hive", text: "The review found two fixes" },
    ];
    render(<Chat detail={{ ...detail, turnRunning: false, chat }} streaming="" activity={null} />);
    for (const label of ["You", "Product owner", "Spec writer", "Planner"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Hive:")).toBeInTheDocument();
    expect(screen.getByText(/The review found two fixes/)).toBeInTheDocument();
  });

  it("sends on Enter and adds a new line on Shift+Enter", async () => {
    const send = vi.spyOn(api, "sendMessage").mockResolvedValue(undefined);
    render(<Chat detail={{ ...detail, turnRunning: false }} streaming="" activity={null} />);
    const box = screen.getByLabelText("Your reply");
    await userEvent.type(box, "line one{Shift>}{Enter}{/Shift}line two");
    expect(send).not.toHaveBeenCalled();
    expect(box).toHaveValue("line one\nline two");
    await userEvent.type(box, "{Enter}");
    expect(send).toHaveBeenCalledWith("c1", { text: "line one\nline two" });
    vi.restoreAllMocks();
  });

  it("closes the reply box during a review, except to answer a question", () => {
    const spec = { path: "docs/specs/x.md", text: "# X", review: "running" as const };
    const base: CardDetail = { ...detail, lane: "spec", turnRunning: false, spec };
    const { rerender } = render(<Chat detail={base} streaming="" activity={null} />);
    expect(screen.getByLabelText("Your reply")).toBeDisabled();
    expect(screen.getByText("Wait for the review")).toBeInTheDocument();

    const applying = { ...base, spec: { ...spec, review: "applying" as const } };
    rerender(<Chat detail={applying} streaming="" activity={null} />);
    expect(screen.getByLabelText("Your reply")).toBeDisabled();
    expect(screen.getByText("The spec writer is applying the review")).toBeInTheDocument();

    const asking: CardDetail = {
      ...applying,
      pending: { id: "q", kind: "question", questions: [{ question: "Which?", header: "H", multiSelect: false, options: [] }] },
    };
    rerender(<Chat detail={asking} streaming="" activity={null} />);
    expect(screen.getByLabelText("Your reply")).toBeEnabled();
  });

  it("has no reply box in Plan, but still shows Stop and questions", () => {
    render(<Chat detail={{ ...detail, lane: "plan", turnRunning: true }} streaming="" activity={null} />);
    expect(screen.queryByLabelText("Your reply")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });
});

describe("Chat in Build", () => {
  it("has no reply box and labels the developer's messages", () => {
    const build: CardDetail = {
      ...detail,
      lane: "build",
      turnRunning: false,
      chat: [{ kind: "message", id: "m1", at: "t", from: "developer", text: "Built the column" }],
    };
    render(<Chat detail={build} streaming="" activity={null} />);
    expect(screen.queryByLabelText("Your reply")).toBeNull();
    expect(screen.getByText("Developer")).toBeInTheDocument();
    expect(screen.getByText("Built the column")).toBeInTheDocument();
  });
});
