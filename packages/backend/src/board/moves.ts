// Card moves are plain code (docs/ARCHITECTURE.md, Card Moves). This slice has one row: Ideas → Refine.
import type { Lane } from "@hive/shared";

export function canMove(from: Lane, to: Lane): boolean {
  return from === "ideas" && to === "refine";
}
