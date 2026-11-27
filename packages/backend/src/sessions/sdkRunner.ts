// The real session runner on the Claude Agent SDK. Each turn is one query() call with the options
// docs/ARCHITECTURE.md fixes (Sessions); the options here were checked against the SDK's own type definitions.
import { createSdkMcpServer, getSessionMessages, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { relative } from "node:path";
import { HIVE_TOOLS } from "./hiveTools";
import type { HiveTools, RunningTurn, SessionRunner, TurnHandlers, TurnOutcome, TurnRequest } from "./types";

export const SETTING_SOURCES = ["user", "project", "local"] as const;

/** An async iterable the query reads its prompt from; messages pushed mid-turn join the running turn. */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  private ended = false;

  /** Queue a message; false once the input has ended, when nothing will read it any more. */
  push(text: string): boolean {
    if (this.ended) return false;
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    };
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: message, done: false });
    } else {
      this.items.push(message);
    }
    return true;
  }

  end(): void {
    this.ended = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}

/** The hive's tools a session is offered: only those its role was given. */
function hiveToolList(tools: HiveTools) {
  const list = [];
  if (tools.writeBrief) {
    const writeBrief = tools.writeBrief;
    const { description, shape } = HIVE_TOOLS.write_brief;
    list.push(tool(
      "write_brief",
      description,
      shape,
      async (args) => ({ content: [{ type: "text" as const, text: await writeBrief(args) }] }),
    ));
  }
  if (tools.copyLocalFiles) {
    const copy = tools.copyLocalFiles;
    const { description, shape } = HIVE_TOOLS.copy_local_files;
    list.push(tool(
      "copy_local_files",
      description,
      shape,
      async (args) => ({ content: [{ type: "text" as const, text: await copy(args.paths) }] }),
    ));
  }
  return list;
}

/** The allowed tool names for a set of hive tools, so they never wait on a permission check. */
export function hiveToolNames(tools: HiveTools): string[] {
  return [
    ...(tools.writeBrief ? ["mcp__hive__write_brief"] : []),
    ...(tools.copyLocalFiles ? ["mcp__hive__copy_local_files"] : []),
  ];
}

export function hiveServer(tools: HiveTools) {
  return createSdkMcpServer({ name: "hive", version: "0.1.0", tools: hiveToolList(tools) });
}

/** The passing activity line for a tool call, or null for calls that show up some other way. */
export function describeTool(name: string, input: Record<string, unknown>, cwd: string): string | null {
  const path = (p: unknown) => (typeof p === "string" ? relative(cwd, p) || p : "");
  switch (name) {
    case "AskUserQuestion":
      return null;
    case "mcp__hive__write_brief":
      return "updating the brief…";
    case "mcp__hive__copy_local_files":
      return "copying local files…";
    case "Read":
      return `reading ${path(input.file_path)}…`;
    case "Glob":
    case "Grep":
      return `searching for ${String(input.pattern ?? "")}…`;
    case "Bash":
      return `running ${String(input.command ?? "").slice(0, 80)}…`;
    default:
      return `using ${name}…`;
  }
}

async function sessionHasMessages(sessionId: string, cwd: string): Promise<boolean> {
  try {
    return (await getSessionMessages(sessionId, { dir: cwd })).length > 0;
  } catch {
    return false;
  }
}

export class SdkRunner implements SessionRunner {
  start(request: TurnRequest, handlers: TurnHandlers): RunningTurn {
    const input = new InputQueue();
    input.push(request.message);
    let current: ReturnType<typeof query> | null = null;
    let interruptRequested = false;

    const done = (async (): Promise<TurnOutcome> => {
      // A first turn that failed before creating the session can still start; one that got as far as
      // writing the transcript must resume it (spec: Failures).
      const kept = request.persist !== false;
      const resume = kept && (request.resume || (await sessionHasMessages(request.sessionId, request.cwd)));
      const append = request.extraInstructions
        ? `${request.role.instructions}\n\n${request.extraInstructions}`
        : request.role.instructions;
      const q = query({
        prompt: input,
        options: {
          cwd: request.cwd,
          model: request.role.model,
          systemPrompt: { type: "preset", preset: "claude_code", append },
          permissionMode: "auto",
          settingSources: [...SETTING_SOURCES],
          includePartialMessages: true,
          ...(request.hiveTools
            ? { mcpServers: { hive: hiveServer(request.hiveTools) }, allowedTools: hiveToolNames(request.hiveTools) }
            : {}),
          ...(request.outputFormat ? { outputFormat: { type: "json_schema", schema: request.outputFormat } } : {}),
          ...(kept ? {} : { persistSession: false }),
          canUseTool: (toolName, toolInput, { signal }) =>
            handlers.canUseTool(toolName, toolInput, signal),
          ...(resume ? { resume: request.sessionId } : { sessionId: request.sessionId }),
        },
      });
      current = q;
      if (interruptRequested) q.interrupt().catch(() => {}); // the turn ends either way; don't crash on a late reject
      let created = false;
      const markCreated = () => {
        if (!created) {
          created = true;
          handlers.onSessionCreated();
        }
      };
      let outcome: TurnOutcome = { kind: "error", message: "The turn ended without a result." };
      try {
        for await (const m of q as AsyncIterable<SDKMessage>) {
          if (m.type === "stream_event") {
            const e = m.event as { type: string; delta?: { type: string; text?: string } };
            if (m.parent_tool_use_id === null && e.type === "content_block_delta" && e.delta?.type === "text_delta") {
              handlers.onTextDelta(e.delta.text ?? "");
            }
          } else if (m.type === "assistant") {
            if (m.parent_tool_use_id !== null) continue; // a subagent's message, not the session's
            markCreated();
            for (const block of m.message.content) {
              if (block.type === "text" && block.text.trim()) handlers.onTextBlock(block.text);
              if (block.type === "tool_use") {
                handlers.onActivity(describeTool(block.name, block.input as Record<string, unknown>, request.cwd));
              }
            }
          } else if (m.type === "result") {
            if (interruptRequested) {
              outcome = { kind: "ok", interrupted: true };
            } else if (m.subtype === "success") {
              markCreated();
              // Only structured_output counts as a report: a session that can't fill the schema still ends in
              // "success" with none (docs/ARCHITECTURE.md, Role reports).
              outcome = { kind: "ok", report: m.structured_output };
            } else {
              outcome = { kind: "error", message: m.errors?.join("; ") || m.subtype };
            }
            // Messages sent mid-turn may still be queued, each producing its own result.
            if (!m.queued_turn_count) input.end();
          }
        }
      } catch (error) {
        outcome = interruptRequested
          ? { kind: "ok", interrupted: true }
          : { kind: "error", message: error instanceof Error ? error.message : String(error) };
      } finally {
        input.end();
        handlers.onActivity(null);
      }
      return outcome;
    })();

    return {
      push: (text) => input.push(text),
      interrupt: async () => {
        interruptRequested = true;
        if (current) await current.interrupt();
      },
      done,
    };
  }
}
