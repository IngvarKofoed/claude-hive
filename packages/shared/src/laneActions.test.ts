import { describe, expect, it } from "vitest";
import {
  LANE_ACTIONS, LANE_ACTION_LABEL, laneActions,
  type ChatItem, type ErrorAction, type LaneActionId, type LaneActionInput, type LaneActionState, type MockupInfo,
  type ReviewState, type ShipPlan,
} from "./index";

/** A mockup the designer has named, with its pages in the folder. */
const named: MockupInfo = {
  folder: "docs/mockups/c1", current: { kind: "pages", page: "docs/mockups/c1/index.html" }, kept: null, files: ["index.html"],
};

const base: LaneActionInput = {
  lane: "refine",
  turnRunning: false,
  pending: false,
  lastChat: null,
  spec: null,
  issues: [],
  landing: false,
  shipPlan: null,
  hasFeedback: false,
};

const plan: ShipPlan = {
  base: "origin/main", uncommitted: [], unpushed: 0, tests: "npm test", noTestsReason: null, checkoutBlocks: false, busy: false,
};

function error(actions: ErrorAction[]): ChatItem {
  return { kind: "error", id: "e1", at: "2026-11-28T10:00:00Z", message: "It failed.", actions };
}

function actions(input: Partial<LaneActionInput>): LaneActionState[] {
  return laneActions({ ...base, ...input });
}

function one(id: LaneActionId, input: Partial<LaneActionInput>): LaneActionState | undefined {
  return actions(input).find((a) => a.id === id);
}

/** The reason an action is greyed with, or "enabled". */
function why(id: LaneActionId, input: Partial<LaneActionInput>): string | null {
  const action = one(id, input);
  if (!action) throw new Error(`${id} isn't offered`);
  return action.enabled ? "enabled" : action.reason;
}

describe("LANE_ACTIONS", () => {
  it("lists each lane's actions in the spec's order", () => {
    expect(LANE_ACTIONS).toEqual({
      ideas: ["start"],
      refine: ["good", "skip-mockup", "retry", "stop"],
      mockup: ["keep", "dont-keep", "retry", "stop"],
      spec: ["review", "signoff", "retry", "stop"],
      plan: ["retry", "back-to-spec", "stop"],
      build: ["retry", "back-to-spec", "stop"],
      check: ["retry", "back-to-build", "move-on", "back-to-spec", "stop"],
      tryit: ["send-back", "accept", "retry", "back-to-build", "back-to-spec"],
      ship: ["land", "discard-and-land", "back-to-tryit", "retry", "back-to-build", "stop"],
      done: [],
    });
  });

  it("has every error action among the lane action ids", () => {
    const errorActions: ErrorAction[] = ["retry", "review", "back-to-spec", "back-to-build", "move-on"];
    for (const id of errorActions) expect(Object.keys(LANE_ACTION_LABEL)).toContain(id);
  });

  it("labels Review once, as Review", () => {
    expect(LANE_ACTION_LABEL.review).toBe("Review");
  });
});

describe("laneActions", () => {
  it("returns the offered actions in the lane's order, with their labels and primary flags", () => {
    const check = actions({
      lane: "check", turnRunning: true, lastChat: error(["move-on", "retry", "back-to-spec", "back-to-build"]),
    });
    expect(check.map((a) => a.id)).toEqual(["retry", "back-to-build", "move-on", "back-to-spec", "stop"]);
    expect(check.map((a) => a.label)).toEqual(["Retry", "Back to Build", "Move on", "Back to Spec", "Stop"]);

    const primary = (input: Partial<LaneActionInput>) => actions(input).filter((a) => a.primary).map((a) => a.label);
    expect(primary({ lane: "refine" })).toEqual(["Good · on to Mockup"]);
    expect(primary({ lane: "mockup", mockup: named })).toEqual(["Good · keep in docs/mockups"]);
    expect(primary({ lane: "spec" })).toEqual(["Sign off"]);
    expect(primary({ lane: "tryit" })).toEqual(["Send back"]);
    expect(primary({ lane: "ship" })).toEqual(["Land on main"]);
    expect(actions({ lane: "ideas" })).toEqual([
      { id: "start", label: "Start", primary: false, enabled: true, reason: null },
    ]);
    expect(actions({ lane: "refine" }).map((a) => a.label)).toEqual(["Good · on to Mockup", "Good · skip to Spec"]);
    expect(actions({ lane: "mockup", mockup: named }).map((a) => a.label)).toEqual([
      "Good · keep in docs/mockups", "Good · don't keep",
    ]);
    expect(actions({ lane: "done" })).toEqual([]);
  });

  it("greys both of Refine's Goods while the product owner works or a question is open", () => {
    for (const id of ["good", "skip-mockup"] as const) {
      expect(why(id, {})).toBe("enabled");
      expect(why(id, { turnRunning: true })).toBe("Wait for the product owner to finish");
      expect(why(id, { pending: true })).toBe("Wait for the product owner to finish");
    }
  });

  it("greys Keep as the server refuses it: while the designer works, before a mockup is named, and with no pages", () => {
    const mockup = (over: Partial<MockupInfo>): Partial<LaneActionInput> => ({ lane: "mockup", mockup: { ...named, ...over } });
    expect(why("keep", mockup({}))).toBe("enabled");
    expect(why("keep", { ...mockup({}), turnRunning: true })).toBe("Wait for the designer to finish");
    expect(why("keep", { ...mockup({}), pending: true })).toBe("Wait for the designer to finish");
    expect(why("keep", mockup({ current: null }))).toBe("Keep needs a mockup: the designer hasn't named one yet.");
    expect(why("keep", { lane: "mockup" })).toBe("Keep needs a mockup: the designer hasn't named one yet.");
    expect(why("keep", mockup({ files: [] }))).toBe("There's nothing to keep: the mockup's folder is empty.");
    // A link needs no files: Keep writes its README.
    expect(why("keep", mockup({ current: { kind: "link", url: "https://claude.ai/design/p/1" }, files: [] }))).toBe("enabled");
  });

  it("greys Don't keep only while the designer works or a question is open", () => {
    expect(why("dont-keep", { lane: "mockup" })).toBe("enabled");
    expect(why("dont-keep", { lane: "mockup", turnRunning: true })).toBe("Wait for the designer to finish");
    expect(why("dont-keep", { lane: "mockup", pending: true })).toBe("Wait for the designer to finish");
  });

  it("greys Review with the first matching reason", () => {
    const spec = (review: ReviewState, hasText = true) => ({
      lane: "spec" as const, spec: { review, hasText },
    });
    expect(why("review", spec("none"))).toBe("enabled");
    expect(why("review", spec("stale"))).toBe("enabled");
    expect(why("review", { ...spec("none"), turnRunning: true })).toBe("Wait for the spec writer to finish");
    expect(why("review", { ...spec("running", false), turnRunning: true })).toBe("Wait for the spec writer to finish");
    expect(why("review", spec("none", false))).toBe("Wait for the spec writer to write the spec");
    expect(why("review", { lane: "spec", spec: null })).toBe("Wait for the spec writer to write the spec");
    expect(why("review", spec("running"))).toBe("Wait for the review");
    expect(why("review", spec("applying"))).toBe("Wait for the review");
    expect(why("review", spec("unfinished"))).toBe("Finish the review first");
    expect(why("review", spec("fresh"))).toBe("Already reviewed");
    // An amendment's spec writer skipped the review: you may still run one (docs/specs/2026-11-28-try-it-send-back.md).
    expect(why("review", spec("skipped"))).toBe("enabled");
  });

  it("greys Sign off with the card page's old sentences", () => {
    const spec = (review: "none" | "stale" | "unfinished" | "running" | "applying" | "fresh" | "skipped", turnRunning = false) => ({
      lane: "spec" as const, turnRunning, spec: { review, hasText: true },
    });
    expect(why("signoff", spec("fresh"))).toBe("enabled");
    expect(why("signoff", spec("skipped"))).toBe("enabled");
    expect(why("signoff", spec("skipped", true))).toBe("Wait for the spec writer to finish");
    expect(why("signoff", spec("fresh", true))).toBe("Wait for the spec writer to finish");
    expect(why("signoff", spec("none"))).toBe("Run the review first");
    expect(why("signoff", { lane: "spec", spec: null })).toBe("Run the review first");
    expect(why("signoff", spec("stale"))).toBe("Review the changed spec again first");
    expect(why("signoff", spec("unfinished"))).toBe("Finish the review first");
    expect(why("signoff", spec("running"))).toBe("Wait for the review");
    expect(why("signoff", spec("applying"))).toBe("Wait for the review");
  });

  it("offers Review in Spec with or without an error line", () => {
    const spec = { review: "none" as const, hasText: true };
    expect(one("review", { lane: "spec", spec })).toBeDefined();
    expect(actions({ lane: "spec", spec, lastChat: error(["review"]) }).map((a) => a.id)).toEqual(["review", "signoff"]);
    expect(actions({ lane: "spec", spec, lastChat: error(["retry"]) }).map((a) => a.id)).toEqual(["review", "signoff", "retry"]);
  });

  it("offers an error action only when the last chat line is an error that lists it, and its lane lists it", () => {
    expect(one("retry", { lane: "build" })).toBeUndefined();
    const message: ChatItem = { kind: "message", id: "m", at: "", from: "developer", text: "Done." };
    expect(one("retry", { lane: "build", lastChat: message })).toBeUndefined();
    expect(actions({ lane: "build", lastChat: error(["retry", "back-to-spec"]) }).map((a) => a.id)).toEqual(["retry", "back-to-spec"]);
    expect(actions({ lane: "build", lastChat: error(["retry"]) }).map((a) => a.id)).toEqual(["retry"]);
    // Refine doesn't list Back to Spec, so a line that carries it offers nothing.
    expect(actions({ lane: "refine", lastChat: error(["back-to-spec"]) }).map((a) => a.id)).toEqual(["good", "skip-mockup"]);
    expect(actions({ lane: "plan", lastChat: error(["move-on"]) })).toEqual([]);
  });

  it("greys error actions while a turn runs", () => {
    const input = { lane: "check" as const, lastChat: error(["retry", "move-on"]) };
    expect(why("retry", input)).toBe("enabled");
    expect(why("move-on", { ...input, turnRunning: true })).toBe("Wait for the running turn to finish");
  });

  it("offers Stop only while a turn runs, in a lane that lists it", () => {
    expect(one("stop", { lane: "plan" })).toBeUndefined();
    expect(one("stop", { lane: "plan", turnRunning: true })).toEqual({
      id: "stop", label: "Stop", primary: false, enabled: true, reason: null,
    });
    expect(one("stop", { lane: "tryit", turnRunning: true })).toBeUndefined();
    expect(one("stop", { lane: "ideas", turnRunning: true })).toBeUndefined();
  });

  it("greys Send back and Accept with Try it's reasons", () => {
    const tryit = (input: Partial<LaneActionInput>) => ({ lane: "tryit" as const, ...input });
    expect(why("send-back", tryit({ pending: true, hasFeedback: true }))).toBe("Answer the spec keeper's question first.");
    expect(why("send-back", tryit({ issues: ["waiting"], hasFeedback: true }))).toBe("Answer the spec keeper's question first.");
    expect(why("send-back", tryit({ turnRunning: true, hasFeedback: true }))).toBe("The spec keeper is working. Wait for it to finish.");
    expect(why("send-back", tryit({ pending: true, turnRunning: true }))).toBe("Answer the spec keeper's question first.");
    // An empty box with nothing held: greyed like any empty form, with no reason.
    expect(one("send-back", tryit({}))).toMatchObject({ enabled: false, reason: null });
    expect(why("send-back", tryit({ hasFeedback: true }))).toBe("enabled");
    expect(why("send-back", tryit({ issues: ["held"] }))).toBe("enabled");
    // New words after a failed pick start a new one.
    expect(why("send-back", tryit({ hasFeedback: true, sendBack: true }))).toBe("enabled");

    expect(why("accept", tryit({}))).toBe("enabled");
    expect(why("accept", tryit({ hasFeedback: true }))).toBe("enabled");
    expect(why("accept", tryit({ issues: ["waiting", "held"] }))).toBe("Answer the spec keeper's question first.");
    expect(why("accept", tryit({ turnRunning: true, issues: ["held"] }))).toBe("The spec keeper is working. Wait for it to finish.");
    expect(why("accept", tryit({ issues: ["held"] }))).toBe("Changes you asked for go to Build with Send back.");
    expect(why("accept", tryit({ sendBack: true, issues: ["held"] }))).toBe("Send your feedback, or edit it away first.");
  });

  it("offers Try it's Retry from the error line, and a failed pick's Back to Build and Back to Spec", () => {
    expect(actions({ lane: "tryit" }).map((a) => a.id)).toEqual(["send-back", "accept"]);
    expect(actions({ lane: "tryit", lastChat: error(["retry"]) }).map((a) => a.id)).toEqual(["send-back", "accept", "retry"]);
    const failed = actions({ lane: "tryit", sendBack: true, lastChat: error(["retry", "back-to-build", "back-to-spec"]) });
    expect(failed.map((a) => a.label)).toEqual(["Send back", "Accept", "Retry", "Back to Build", "Back to Spec"]);
    expect(failed.find((a) => a.id === "back-to-spec")).toMatchObject({ enabled: true, primary: false });
  });

  it("greys Land on main with the first matching reason", () => {
    const ship = (input: Partial<LaneActionInput>) => ({ lane: "ship" as const, ...input });
    expect(why("land", ship({ shipPlan: plan }))).toBe("enabled");
    expect(why("land", ship({ landing: true, shipPlan: { ...plan, busy: true } }))).toBe("Landing…");
    expect(why("land", ship({}))).toBe("Reading what landing will do…");
    expect(why("land", ship({ shipPlan: { ...plan, busy: true, unpushed: 2 } }))).toBe("Another card of this project is landing.");
    expect(why("land", ship({ shipPlan: { ...plan, unpushed: 2, checkoutBlocks: true } }))).toBe(
      "Your local main has 2 commits that aren't on origin. Push them first.",
    );
    expect(why("land", ship({ shipPlan: { ...plan, checkoutBlocks: true, uncommitted: ["?? a"] } }))).toBe(
      "Your checkout has main checked out with uncommitted changes. Commit or stash them first.",
    );
    expect(why("land", ship({ shipPlan: { ...plan, uncommitted: ["?? a"] } }))).toBe(
      "Uncommitted work in the card's worktree won't land.",
    );
  });

  it("offers Discard them and land only with uncommitted work, with Land on main's reasons but the last", () => {
    const ship = (input: Partial<LaneActionInput>) => ({ lane: "ship" as const, ...input });
    expect(one("discard-and-land", ship({}))).toBeUndefined();
    expect(one("discard-and-land", ship({ shipPlan: plan }))).toBeUndefined();
    const dirty = { ...plan, uncommitted: ["?? notes.txt"] };
    expect(why("discard-and-land", ship({ shipPlan: dirty }))).toBe("enabled");
    expect(why("discard-and-land", ship({ shipPlan: dirty, landing: true }))).toBe("Landing…");
    expect(why("discard-and-land", ship({ shipPlan: { ...dirty, busy: true } }))).toBe("Another card of this project is landing.");
    expect(why("discard-and-land", ship({ shipPlan: { ...dirty, unpushed: 1 } }))).toBe(
      "Your local main has 1 commits that aren't on origin. Push them first.",
    );
    expect(why("discard-and-land", ship({ shipPlan: { ...dirty, checkoutBlocks: true } }))).toBe(
      "Your checkout has main checked out with uncommitted changes. Commit or stash them first.",
    );
    expect(actions({ lane: "ship", shipPlan: dirty }).map((a) => a.id)).toEqual(["land", "discard-and-land", "back-to-tryit"]);
  });

  it("greys Back to Try it while the card lands", () => {
    expect(why("back-to-tryit", { lane: "ship" })).toBe("enabled");
    expect(why("back-to-tryit", { lane: "ship", landing: true })).toBe("The card is landing.");
  });

  it("offers Ship's Retry and Back to Build from the error line", () => {
    expect(actions({ lane: "ship", shipPlan: plan, lastChat: error(["retry", "back-to-build"]) }).map((a) => a.id)).toEqual([
      "land", "back-to-tryit", "retry", "back-to-build",
    ]);
  });
});
