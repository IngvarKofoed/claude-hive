// The runner's activity line, driven through a mocked query(): the tests never call the real Claude API.
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { SdkRunner } from "./sdkRunner";
import type { TurnHandlers, TurnRequest } from "./types";

const script = vi.hoisted(() => ({ messages: [] as unknown[] }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => {
    const messages = script.messages;
    const generator = (async function* () {
      for (const m of messages) yield m;
    })();
    return Object.assign(generator, { interrupt: vi.fn(async () => {}) });
  }),
  getSessionMessages: vi.fn(async () => []),
  createSdkMcpServer: vi.fn(),
  tool: vi.fn(),
}));

const toolUse = (id: string, name: string, input: Record<string, unknown>, parent: string | null = null) =>
  ({
    type: "assistant", parent_tool_use_id: parent, uuid: "u", session_id: "s",
    message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
  }) as unknown as SDKMessage;

const toolUses = (...calls: Array<[string, string, Record<string, unknown>]>) =>
  ({
    type: "assistant", parent_tool_use_id: null, uuid: "u", session_id: "s",
    message: { role: "assistant", content: calls.map(([id, name, input]) => ({ type: "tool_use", id, name, input })) },
  }) as unknown as SDKMessage;

const toolResult = (id: string, parent: string | null = null) =>
  ({
    type: "user", parent_tool_use_id: parent, session_id: "s",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
  }) as unknown as SDKMessage;

const resultMessage = { type: "result", subtype: "success", is_error: false, session_id: "s" } as unknown as SDKMessage;

describe("SdkRunner activity line", () => {
  const request: TurnRequest = {
    sessionId: "s", resume: false, cwd: "/work", message: "hi",
    role: { name: "product-owner", model: "opus", kind: "conversation", instructions: "Be a product owner." },
  };
  let onActivity: Mock<(text: string | null) => void>;

  const run = async (...messages: SDKMessage[]) => {
    script.messages = [...messages, resultMessage];
    const handlers: TurnHandlers = {
      onTextDelta: () => {}, onTextBlock: () => {}, onActivity, onChecklist: () => {}, onSessionCreated: () => {},
      canUseTool: async (_name, input) => ({ behavior: "allow", updatedInput: input }),
    };
    await new SdkRunner().start(request, handlers).done;
    return onActivity.mock.calls.map((c) => c[0]);
  };

  beforeEach(() => {
    onActivity = vi.fn<(text: string | null) => void>();
  });

  it("ends a tool's line with its result", async () => {
    const calls = await run(toolUse("t1", "Read", { file_path: "/work/a.ts" }), toolResult("t1"));
    // The line, its result's null, and the turn's own null.
    expect(calls).toEqual(["reading a.ts…", null, null]);
  });

  it("keeps the line while parallel calls in one message are open, and clears it on the last result", async () => {
    const calls = await run(
      toolUses(["t1", "Read", { file_path: "/work/a.ts" }], ["t2", "Read", { file_path: "/work/b.ts" }]),
      toolResult("t1"),
      toolResult("t2"),
    );
    expect(calls).toEqual(["reading a.ts…", "reading b.ts…", null, null]);
  });

  it("counts parallel calls across messages", async () => {
    const calls = await run(
      toolUse("t1", "Read", { file_path: "/work/a.ts" }),
      toolUse("t2", "Read", { file_path: "/work/b.ts" }),
      toolResult("t1"),
      toolResult("t2"),
    );
    expect(calls).toEqual(["reading a.ts…", "reading b.ts…", null, null]);
  });

  it("ignores a subagent's calls and results, and still clears at the turn's end", async () => {
    const calls = await run(
      toolUse("sub1", "Read", { file_path: "/work/a.ts" }, "parent"),
      toolResult("sub1", "parent"),
    );
    expect(calls).toEqual([null]);
  });
});
