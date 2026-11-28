import { describe, expect, it } from "vitest";
import {
  CHECK_ROUNDS, KEEPER_FIX_ROUNDS, afterBlocking, canMove, fateOf, laneAfter, laneAfterBuild, laneAfterCheck, laneAfterJudging,
  laneAfterPlan,
} from "./board/moves";
import { loadRole, parseRole } from "./sessions/roles";
import { describeTool, InputQueue } from "./sessions/sdkRunner";

describe("the spec keeper's routing (docs/specs/2026-11-28-spec-keeper.md)", () => {
  const j = (verdict: "spec-wrong" | "code-wrong" | "no-change", level: "minor" | "changes-signoff" | "severe" = "minor", repeats: string | null = null) =>
    ({ verdict, level, repeats });

  it("settles minor issues, asks changes-signoff and every repeat, and stops on severe", () => {
    expect(fateOf(j("spec-wrong"), "batch", 0)).toBe("spec-fixed");
    expect(fateOf(j("no-change"), "batch", 0)).toBe("no-change");
    expect(fateOf(j("code-wrong"), "batch", 0)).toBe("fix");
    expect(fateOf(j("spec-wrong", "changes-signoff"), "batch", 0)).toBe("waits");
    expect(fateOf(j("spec-wrong", "minor", "earlier"), "batch", 0)).toBe("waits");
    expect(fateOf(j("code-wrong", "minor", "earlier"), "batch", 0)).toBe("waits");
    expect(fateOf(j("code-wrong", "severe", "earlier"), "batch", 0)).toBe("severe");
  });

  it("asks a code fix judged as built, or past the fix rounds", () => {
    expect(fateOf(j("code-wrong"), "as-built", 0)).toBe("waits");
    expect(fateOf(j("code-wrong"), "batch", KEEPER_FIX_ROUNDS - 1)).toBe("fix");
    expect(fateOf(j("code-wrong"), "batch", KEEPER_FIX_ROUNDS)).toBe("waits");
  });

  it("Check → Check on severe, Build on a code fix, else Try it, or Ship for a card Ship sent back when nothing waits", () => {
    expect(laneAfterJudging(["fix", "severe"], false, false)).toBe("check");
    expect(laneAfterJudging(["fix", "waits"], false, false)).toBe("build");
    expect(laneAfterJudging(["spec-fixed", "no-change"], false, false)).toBe("tryit");
    expect(laneAfterJudging(["spec-fixed"], true, false)).toBe("ship");
    expect(laneAfterJudging(["waits"], true, false)).toBe("tryit");
    expect(laneAfterJudging(["spec-fixed"], true, true)).toBe("tryit");
  });

  it("a blocked build: severe stops, no-change falls back, changes-signoff or a repeat asks, else the developer carries on", () => {
    expect(afterBlocking(j("no-change", "severe"))).toBe("stop");
    expect(afterBlocking(j("no-change", "changes-signoff"))).toBe("fall-back");
    expect(afterBlocking(j("code-wrong", "changes-signoff"))).toBe("ask");
    expect(afterBlocking(j("code-wrong", "minor", "earlier"))).toBe("ask");
    expect(afterBlocking(j("spec-wrong"))).toBe("spec-fixed");
    expect(afterBlocking(j("code-wrong"))).toBe("carry-on");
  });

  it("Check → Try it instead of Ship while a keeper question waits", () => {
    expect(laneAfterCheck("done", 0, 1, true)).toBe("ship");
    expect(laneAfterCheck("done", 0, 1, true, true)).toBe("tryit");
  });

  it("Check stays in Check while open spec issues wait for the keeper, but only on a round without bugs", () => {
    expect(laneAfterCheck("done", 0, 1, false, false, 2)).toBe("check");
    expect(laneAfterCheck("done", 0, 1, true, false, 1)).toBe("check");
    expect(laneAfterCheck("done", 1, 1, false, false, 2)).toBe("build");
  });
});

describe("card moves (docs/ARCHITECTURE.md, Card Moves)", () => {
  it("Refine → Mockup on Good, and Mockup → Spec on Good", () => {
    expect(laneAfter("refine", "good")).toBe("mockup");
    expect(laneAfter("mockup", "good")).toBe("spec");
    expect(laneAfter("spec", "good")).toBeNull();
    expect(laneAfter("ideas", "good")).toBeNull();
  });

  it("Refine → Spec on Good · skip to Spec, and nowhere else", () => {
    expect(laneAfter("refine", "skip-mockup")).toBe("spec");
    expect(laneAfter("mockup", "skip-mockup")).toBeNull();
    expect(laneAfter("spec", "skip-mockup")).toBeNull();
  });

  it("Spec → Plan on Sign off", () => {
    expect(laneAfter("spec", "signoff")).toBe("plan");
    expect(laneAfter("refine", "signoff")).toBeNull();
  });

  it("Plan → Build when the planner's report is done, and stays in Plan when it's blocked or missing", () => {
    expect(laneAfterPlan("done")).toBe("build");
    expect(laneAfterPlan("blocked")).toBe("plan");
    expect(laneAfterPlan("missing")).toBe("plan");
  });

  it("Plan → Spec on Back to Spec", () => {
    expect(laneAfter("plan", "back-to-spec")).toBe("spec");
    expect(laneAfter("check", "back-to-spec")).toBe("spec");
    expect(laneAfter("tryit", "back-to-spec")).toBeNull();
  });

  it("Build → Check when the developer's report is done, and stays in Build when it's blocked or missing", () => {
    expect(laneAfterBuild("done")).toBe("check");
    expect(laneAfterBuild("blocked")).toBe("build");
    expect(laneAfterBuild("missing")).toBe("build");
  });

  it("stays in Build when the report is done but the merge of main is unfinished", () => {
    expect(laneAfterBuild("done", true)).toBe("build");
  });

  it("Build → Spec on Back to Spec, until the spec keeper exists", () => {
    expect(laneAfter("build", "back-to-spec")).toBe("spec");
  });

  it("Check → Try it when the reviewer's report is done with no bugs", () => {
    expect(laneAfterCheck("done", 0, 1)).toBe("tryit");
    expect(laneAfterCheck("done", 0, 5)).toBe("tryit");
  });

  it("Check → Build when round 1 finds bugs", () => {
    expect(CHECK_ROUNDS).toBe(2);
    expect(laneAfterCheck("done", 3, 1)).toBe("build");
  });

  it("stays in Check when round 2 or later still finds bugs (the round limit)", () => {
    expect(laneAfterCheck("done", 1, 2)).toBe("check");
    expect(laneAfterCheck("done", 1, 3)).toBe("check");
  });

  it("stays in Check when the reviewer's report is blocked or missing", () => {
    expect(laneAfterCheck("blocked", 0, 1)).toBe("check");
    expect(laneAfterCheck("missing", 0, 1)).toBe("check");
  });

  it("Check → Build on Back to Build, and Check → Try it on Move on", () => {
    expect(laneAfter("check", "back-to-build")).toBe("build");
    expect(laneAfter("check", "move-on")).toBe("tryit");
    expect(laneAfter("build", "back-to-build")).toBeNull();
    expect(laneAfter("build", "move-on")).toBeNull();
  });

  it("Try it → Build on Send to Build, Try it → Ship on Accept, and Ship → Try it until Ship is built", () => {
    expect(laneAfter("tryit", "feedback")).toBe("build");
    expect(laneAfter("tryit", "accept")).toBe("ship");
    expect(laneAfter("ship", "back-to-tryit")).toBe("tryit");
    expect(laneAfter("check", "feedback")).toBeNull();
    expect(laneAfter("build", "accept")).toBeNull();
    expect(laneAfter("tryit", "back-to-tryit")).toBeNull();
  });

  it("allows dragging only Ideas → Refine", () => {
    expect(canMove("ideas", "refine")).toBe(true);
    expect(canMove("ideas", "mockup")).toBe(false);
    expect(canMove("refine", "mockup")).toBe(false);
    expect(canMove("refine", "ideas")).toBe(false);
  });
});

describe("roles", () => {
  it("reads settings from the front matter and the instructions below it", () => {
    const role = parseRole("x", "---\nmodel: opus\nkind: conversation\n---\nDo the thing.\n");
    expect(role).toEqual({ name: "x", model: "opus", kind: "conversation", instructions: "Do the thing." });
    expect(() => parseRole("x", "no front matter")).toThrow();
  });

  it("loads the product owner, told to ask with AskUserQuestion and to keep the brief through write_brief", () => {
    const role = loadRole("product-owner");
    expect(role.model).toBe("opus");
    expect(role.instructions).toContain("AskUserQuestion");
    expect(role.instructions).toContain("write_brief");
  });
});

describe("the SDK runner's helpers", () => {
  it("queues messages in order and ends", async () => {
    const q = new InputQueue();
    q.push("one");
    const it = q[Symbol.asyncIterator]();
    expect((await it.next()).value?.message.content).toBe("one");
    const waiting = it.next();
    q.push("two");
    expect((await waiting).value?.message.content).toBe("two");
    q.end();
    expect((await it.next()).done).toBe(true);
  });

  it("describes tool calls as passing activity lines", () => {
    expect(describeTool("Read", { file_path: "/w/src/a.ts" }, "/w")).toBe("reading src/a.ts…");
    expect(describeTool("AskUserQuestion", {}, "/w")).toBeNull();
    expect(describeTool("mcp__hive__write_brief", {}, "/w")).toBe("updating the brief…");
  });
});
