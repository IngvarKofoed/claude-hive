import { describe, expect, it } from "vitest";
import type { CardSummary } from "@hive/shared";
import { boardSummary, cardBadge, inProgress } from "./cardBadge";

const card = (lane: CardSummary["lane"], state: CardSummary["state"] = "needs-you", id: string = lane): CardSummary => ({
  id,
  projectId: "p1",
  title: "A card",
  lane,
  state,
  moveError: null,
});

describe("cardBadge", () => {
  it("gives ideas and landed cards no badge", () => {
    expect(cardBadge(card("ideas"))).toBeNull();
    expect(cardBadge(card("done"))).toBeNull();
  });

  it("says when a lane isn't built", () => {
    expect(cardBadge(card("mockup"))).toEqual({ tone: "neutral", label: "Not implemented yet" });
  });

  it("follows the card's state everywhere else", () => {
    expect(cardBadge(card("refine", "working"))).toEqual({ tone: "working", label: "▶ working" });
    expect(cardBadge(card("tryit"))).toEqual({ tone: "needs-you", label: "● needs you" });
  });
});

describe("inProgress", () => {
  it("is Refine through Ship", () => {
    expect(inProgress(card("ideas"))).toBe(false);
    expect(inProgress(card("refine"))).toBe(true);
    expect(inProgress(card("ship"))).toBe(true);
    expect(inProgress(card("done"))).toBe(false);
  });
});

describe("boardSummary", () => {
  it("counts projects, cards in progress and the ● needs you badges", () => {
    const cards = [
      card("ideas", "needs-you", "a"),
      card("refine", "needs-you", "b"),
      card("build", "working", "c"),
      card("tryit", "needs-you", "d"),
      card("mockup", "needs-you", "e"),
      card("done", "needs-you", "f"),
    ];
    // In progress: refine, build, tryit, mockup. Waiting: refine and tryit; not the idea, the landed card, or the
    // Mockup card, which shows "Not implemented yet".
    expect(boardSummary(4, cards)).toBe("4 projects · 4 cards in progress · 2 waiting for you");
  });

  it("reads one in the singular, and none as nothing waiting", () => {
    expect(boardSummary(1, [card("build", "working")])).toBe("1 project · 1 card in progress · nothing waiting for you");
    expect(boardSummary(2, [])).toBe("2 projects · 0 cards in progress · nothing waiting for you");
  });
});
