import type { Lane } from "@hive/shared";

/**
 * What Delete asks before it goes, naming what's lost (docs/specs/2026-11-27-delete-a-card.md). The tile has less room,
 * so its card question is shorter; an idea has no git, and a landed card's commit stays on main.
 */
export function deleteQuestion(card: { lane: Lane; branch?: string | null }, place: "page" | "tile"): string {
  if (card.lane === "ideas") return "Delete this idea?";
  if (card.lane === "done") return "Delete this card's history? Its commit on main stays.";
  if (place === "tile") return "Delete this card and its branch? Work that isn't on main is lost.";
  const branch = card.branch ? `the branch ${card.branch}` : "its branch";
  return `Delete this card? Its worktree and ${branch} are removed, and its history is deleted. Work that isn't on main is lost.`;
}
