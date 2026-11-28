import { describe, expect, it } from "vitest";
import { IDEA_DRAFTING, ideaDraftBlock, type IdeaDraftInput } from "./index";

const on: IdeaDraftInput = { hasReply: true, turnRunning: false, asking: false, draftOpen: false };

describe("ideaDraftBlock", () => {
  it("is on once the chat has a reply, nothing runs, nothing asks and no draft is open", () => {
    expect(ideaDraftBlock(on)).toBeNull();
  });

  it("gives each reason on its own", () => {
    expect(ideaDraftBlock({ ...on, asking: true })).toBe("Answer the question first");
    expect(ideaDraftBlock({ ...on, turnRunning: true })).toBe("Wait for Claude to finish");
    expect(ideaDraftBlock({ ...on, draftOpen: true })).toBe("Add or cancel the idea first");
    expect(ideaDraftBlock({ ...on, hasReply: false })).toBe("Say something first");
  });

  it("checks the reasons in order: question, turn, draft, reply", () => {
    const all: IdeaDraftInput = { hasReply: false, turnRunning: true, asking: true, draftOpen: true };
    expect(ideaDraftBlock(all)).toBe("Answer the question first");
    expect(ideaDraftBlock({ ...all, asking: false })).toBe("Wait for Claude to finish");
    expect(ideaDraftBlock({ ...all, asking: false, turnRunning: false })).toBe("Add or cancel the idea first");
    expect(ideaDraftBlock({ ...all, asking: false, turnRunning: false, draftOpen: false })).toBe("Say something first");
  });

  it("names the draft turn in the reply box's words", () => {
    expect(IDEA_DRAFTING).toBe("Claude is drafting the idea");
  });
});
