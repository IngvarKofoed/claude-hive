import { describe, expect, it } from "vitest";
import { canMove } from "./board/moves";
import { loadRole, parseRole } from "./sessions/roles";
import { describeTool, InputQueue } from "./sessions/sdkRunner";

describe("card moves", () => {
  it("allows only Ideas → Refine in this slice", () => {
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
