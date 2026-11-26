import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CardDetail } from "@hive/shared";
import { applyCardEvent, type CardLive } from "./cardState";
import { Chat } from "./Chat";

const detail: CardDetail = {
  id: "c1",
  projectId: "p1",
  projectName: "magic-grow",
  title: "Seed price history",
  ideaText: "idea",
  lane: "refine",
  state: "working",
  moveError: null,
  branch: "hive/x",
  worktreePath: "/r/.claude/worktrees/x",
  brief: null,
  chat: [],
  pending: null,
  turnRunning: true,
};
const start: CardLive = { detail, streaming: "", activity: null };

describe("applyCardEvent", () => {
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
        { kind: "error", id: "e1", at: "t", message: "Not logged in", retryable: true },
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
});
