import { describe, expect, it } from "vitest";
import { canMove, laneAfter, laneAfterBuild, laneAfterPlan } from "./board/moves";
import { loadRole, parseRole } from "./sessions/roles";
import { describeTool, InputQueue } from "./sessions/sdkRunner";

describe("card moves (docs/ARCHITECTURE.md, Card Moves)", () => {
  it("Refine → Spec on Good, skipping Mockup", () => {
    expect(laneAfter("refine", "good")).toBe("spec");
    expect(laneAfter("spec", "good")).toBeNull();
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
    expect(laneAfter("check", "back-to-spec")).toBeNull();
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
