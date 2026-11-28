import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardDetail, ChatItem, ShipPlan, SpecIssue } from "@hive/shared";
import { api } from "../api/client";
import { LANE_ACTION_CALLS, actionOf, landActions, laneActionsFor, type LaneActionCall } from "./laneActions";

const detail: CardDetail = {
  id: "c1",
  projectId: "p1",
  projectName: "magic-grow",
  title: "Seed price history",
  ideaTitle: "idea",
  ideaText: "idea",
  lane: "refine",
  state: "needs-you",
  moveError: null,
  branch: "hive/x",
  worktreePath: "/r/.claude/worktrees/x",
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
};

const plan: ShipPlan = {
  base: "origin/main", uncommitted: [], unpushed: 0, tests: "npm test", noTestsReason: null, checkoutBlocks: false, busy: false,
};

const error = (actions: Extract<ChatItem, { kind: "error" }>["actions"]): ChatItem => ({
  kind: "error", id: "e", at: "2026-11-28T10:00:00Z", message: "It failed.", actions,
});

const issue = (status: SpecIssue["status"]): SpecIssue => ({
  id: status, foundIn: "build", where: "Design", problem: "p", guess: "g", status, judgment: null, answer: null,
});

afterEach(() => vi.restoreAllMocks());

describe("laneActionsFor", () => {
  it("reads the last chat line only", () => {
    const older = { ...detail, lane: "check" as const, chat: [error(["retry", "move-on"]), { ...error([]), id: "e2" }] };
    expect(laneActionsFor(older)).toEqual([]);
    const last = { ...detail, lane: "check" as const, chat: [error(["retry", "move-on"])] };
    expect(laneActionsFor(last).map((a) => a.id)).toEqual(["retry", "move-on"]);
  });

  it("reads the running turn and the open question", () => {
    expect(actionOf(laneActionsFor(detail), "good")?.enabled).toBe(true);
    expect(actionOf(laneActionsFor({ ...detail, turnRunning: true }), "good")?.enabled).toBe(false);
    expect(actionOf(laneActionsFor({ ...detail, turnRunning: true }), "stop")).toBeDefined();
    const pending = { id: "q", kind: "permission", toolName: "Bash", input: {} } as unknown as CardDetail["pending"];
    expect(actionOf(laneActionsFor({ ...detail, pending }), "good")?.reason).toBe("Wait for the product owner to finish");
  });

  it("reads the spec's review and whether it has text", () => {
    const spec = (review: "none" | "fresh", text: string | null) => ({
      ...detail, lane: "spec" as const, spec: { path: "docs/specs/x.md", text, review },
    });
    expect(actionOf(laneActionsFor(spec("none", null)), "review")?.reason).toBe("Wait for the spec writer to write the spec");
    expect(actionOf(laneActionsFor(spec("none", "# Spec")), "review")?.enabled).toBe(true);
    expect(actionOf(laneActionsFor(spec("none", "# Spec")), "signoff")?.reason).toBe("Run the review first");
    expect(actionOf(laneActionsFor(spec("fresh", "# Spec")), "signoff")?.enabled).toBe(true);
  });

  it("reads the issues' statuses and Try it's feedback box", () => {
    const tryit = { ...detail, lane: "tryit" as const };
    expect(actionOf(laneActionsFor(tryit), "send-to-build")?.enabled).toBe(false);
    expect(actionOf(laneActionsFor(tryit, { hasFeedback: true }), "send-to-build")?.enabled).toBe(true);
    expect(actionOf(laneActionsFor({ ...tryit, issues: [issue("held")] }), "accept")?.reason).toBe(
      "Changes you asked for go to Build with Send to Build.",
    );
    expect(actionOf(laneActionsFor({ ...tryit, issues: [issue("waiting")] }), "accept")?.reason).toBe(
      "Answer the spec keeper's question first.",
    );
  });

  it("reads landing from the card, or from a working Ship card, and the plan from extras", () => {
    const ship = { ...detail, lane: "ship" as const };
    expect(actionOf(laneActionsFor(ship), "land")?.reason).toBe("Reading what landing will do…");
    expect(actionOf(laneActionsFor(ship, { shipPlan: plan }), "land")?.enabled).toBe(true);
    expect(actionOf(laneActionsFor({ ...ship, landing: true }, { shipPlan: plan }), "land")?.reason).toBe("Landing…");
    expect(actionOf(laneActionsFor({ ...ship, state: "working" }, { shipPlan: plan }), "land")?.reason).toBe("Landing…");
    expect(actionOf(laneActionsFor({ ...ship, state: "working" }), "back-to-tryit")?.reason).toBe("The card is landing.");
    // Only a Ship card reads a working state as landing.
    expect(actionOf(laneActionsFor({ ...detail, lane: "tryit", state: "working" }), "accept")?.enabled).toBe(true);
  });
});

describe("landActions", () => {
  it("gives Land on main alone for a clean plan", () => {
    expect(landActions(plan)).toEqual([
      { id: "land", label: "Land on main", primary: true, enabled: true, reason: null },
    ]);
  });

  it("greys Land on main with uncommitted work and offers Discard them and land", () => {
    expect(landActions({ ...plan, uncommitted: ["?? notes.txt"] })).toEqual([
      { id: "land", label: "Land on main", primary: true, enabled: false, reason: "Uncommitted work in the card's worktree won't land." },
      { id: "discard-and-land", label: "Discard them and land", primary: false, enabled: true, reason: null },
    ]);
  });

  it("greys both while another card lands", () => {
    const both = landActions({ ...plan, busy: true, uncommitted: ["?? notes.txt"] });
    expect(both.map((a) => a.reason)).toEqual([
      "Another card of this project is landing.", "Another card of this project is landing.",
    ]);
  });
});

describe("LANE_ACTION_CALLS", () => {
  it.each<[LaneActionCall, Parameters<typeof api.good>[1]]>([
    ["good", { skipMockup: false }],
    ["skip-mockup", { skipMockup: true }],
    ["keep", { keep: true }],
    ["dont-keep", { keep: false }],
  ])("calls %s through api.good with its body", async (id, body) => {
    const spy = vi.spyOn(api, "good").mockResolvedValue(undefined as never);
    await LANE_ACTION_CALLS[id]("c1");
    expect(spy).toHaveBeenCalledWith("c1", body);
  });

  it.each<[LaneActionCall, keyof typeof api]>([
    ["review", "review"],
    ["signoff", "signoff"],
    ["retry", "retry"],
    ["back-to-spec", "backToSpec"],
    ["back-to-build", "backToBuild"],
    ["move-on", "moveOn"],
    ["accept", "accept"],
    ["back-to-tryit", "backToTryIt"],
    ["stop", "stop"],
  ])("calls %s through api.%s", async (id, name) => {
    const spy = vi.spyOn(api, name).mockResolvedValue(undefined as never);
    await LANE_ACTION_CALLS[id]("c1");
    expect(spy).toHaveBeenCalledWith("c1");
  });

  it("lands, and lands with a discard", async () => {
    const spy = vi.spyOn(api, "land").mockResolvedValue({ ok: true });
    await LANE_ACTION_CALLS.land("c1");
    expect(spy).toHaveBeenLastCalledWith("c1");
    await LANE_ACTION_CALLS["discard-and-land"]("c1");
    expect(spy).toHaveBeenLastCalledWith("c1", true);
  });
});
