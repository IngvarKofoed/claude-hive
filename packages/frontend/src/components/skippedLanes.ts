import { LANES, type CardDetail, type Lane } from "@hive/shared";

/**
 * The lanes a card passed without entering. Only Mockup can be skipped: a card past it with no `mockup` went from
 * Refine straight to Spec (docs/specs/2026-11-28-mockup-lane-and-designer-role.md).
 */
export function skippedLanes(detail: Pick<CardDetail, "lane" | "mockup">): Lane[] {
  const index = (lane: Lane) => LANES.findIndex((l) => l.id === lane);
  return index(detail.lane) > index("mockup") && detail.mockup === null ? ["mockup"] : [];
}
