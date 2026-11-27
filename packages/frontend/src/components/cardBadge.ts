import { laneImplemented, type CardSummary } from "@hive/shared";
import type { BadgeTone } from "./ui/Badge";

export interface CardBadge {
  tone: BadgeTone;
  label: string;
}

/**
 * The badge a card's tile shows, and the one rule the Board's "waiting for you" counts by
 * (docs/specs/2026-11-27-board-by-project.md): none in Ideas, which wait for Start rather than an answer, and none in
 * Done; "Not implemented yet" in a lane that isn't built; otherwise the card's state.
 */
export function cardBadge(card: CardSummary): CardBadge | null {
  if (card.lane === "ideas" || card.lane === "done") return null;
  if (!laneImplemented(card.lane)) return { tone: "neutral", label: "Not implemented yet" };
  return card.state === "working"
    ? { tone: "working", label: "▶ working" }
    : { tone: "needs-you", label: "● needs you" };
}

/** A card from Refine through Ship: neither an idea nor landed. */
export function inProgress(card: CardSummary): boolean {
  return card.lane !== "ideas" && card.lane !== "done";
}

/** The line under the Board title: "4 projects · 10 cards in progress · 7 waiting for you". */
export function boardSummary(projectCount: number, cards: CardSummary[]): string {
  const going = cards.filter(inProgress).length;
  const waiting = cards.filter((card) => cardBadge(card)?.tone === "needs-you").length;
  const projects = projectCount === 1 ? "1 project" : `${projectCount} projects`;
  const progress = going === 1 ? "1 card in progress" : `${going} cards in progress`;
  const you = waiting === 0 ? "nothing waiting for you" : `${waiting} waiting for you`;
  return `${projects} · ${progress} · ${you}`;
}
