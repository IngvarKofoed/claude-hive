// The hive's own tools: their names, descriptions and input shapes, with no SDK in sight. sdkRunner.ts wraps them
// with the SDK's tool(), and the Role prompts page shows the same definitions (docs/specs/2026-11-27-role-prompts-page.md).
import { z } from "zod";
import type { RoleTool } from "@hive/shared";

export const briefShape = {
  title: z.string().describe("A short name for the card"),
  problem: z.string().describe("The problem, in a sentence or two"),
  whoItsFor: z.string().describe("Who it's for"),
  whatDoneLooksLike: z.array(z.string()).describe("What done looks like, as short bullets"),
  outOfScope: z.array(z.string()).describe("What is out of scope, as short bullets"),
  openPoints: z.array(z.string()).describe("What is still open; empty when nothing is"),
};

export const copyShape = {
  paths: z.array(z.string()).describe("Paths relative to the checkout, as the list gave them; a folder ends with /"),
};

export const HIVE_TOOLS = {
  write_brief: {
    description: "Replace the card's brief with this one. Send every section each time; lists may be empty.",
    shape: briefShape,
  },
  copy_local_files: {
    description:
      "Copy git-ignored files or folders from the person's checkout into this worktree. Existing files are kept; " +
      "folders are copied file by file. Returns one line per path: copied, kept, or refused with the reason.",
    shape: copyShape,
  },
} as const;

export type HiveToolName = keyof typeof HIVE_TOOLS;

/** A tool as the page shows it: its inputs as JSON schema, from the same shape the SDK tool is built from. */
export function describeHiveTool(name: HiveToolName): RoleTool {
  const { description, shape } = HIVE_TOOLS[name];
  return { name, description, input: z.toJSONSchema(z.object(shape)) as RoleTool["input"] };
}
