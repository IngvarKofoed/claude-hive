// The trust probe (spec: Board and moves): a short throwaway Haiku session in the repo that reports which
// CLAUDE.md files load. In a folder Claude Code doesn't trust, none do, and nothing else says so.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { realpathSync } from "node:fs";
import { sep } from "node:path";
import { InputQueue, SETTING_SOURCES } from "./sdkRunner";
import type { TrustProbe } from "./types";

export class SdkTrustProbe implements TrustProbe {
  async loadsProjectClaudeMd(root: string): Promise<boolean> {
    const input = new InputQueue();
    input.push('Reply only "ok".');
    const q = query({
      prompt: input,
      options: {
        cwd: root,
        model: "haiku",
        persistSession: false,
        tools: [],
        permissionMode: "auto",
        settingSources: [...SETTING_SOURCES],
        systemPrompt: { type: "preset", preset: "claude_code" },
      },
    });
    let files: string[] = [];
    try {
      for await (const m of q) {
        if (m.type === "result") {
          // The Claude Code process exits when the turn's input ends, so ask while the query is still open.
          const usage = await q.getContextUsage({ detail: "summary" });
          files = usage.memoryFiles.map((f) => f.path);
          input.end();
        }
      }
    } finally {
      input.end();
    }
    const realRoot = realpathSync(root);
    return files.some((f) => {
      let p = f;
      try {
        p = realpathSync(f);
      } catch {}
      return p.startsWith(realRoot + sep);
    });
  }
}
