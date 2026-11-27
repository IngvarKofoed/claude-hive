// A role is a Markdown file in roles/: settings at the top (front matter), instructions below
// (docs/ARCHITECTURE.md, Roles).
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Lane } from "@hive/shared";
import type { Role } from "./types";

export const ROLES_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../roles");

export function parseRole(name: string, source: string): Role {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`Role ${name} has no front matter`);
  const settings: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (kv) settings[kv[1]!] = kv[2]!;
  }
  if (!settings.model) throw new Error(`Role ${name} has no model`);
  return {
    name,
    ...(settings.lane ? { lane: settings.lane } : {}),
    model: settings.model,
    kind: settings.kind ?? "conversation",
    instructions: match[2]!.trim(),
  };
}

export function loadRole(name: string, dir: string = ROLES_DIR): Role {
  return parseRole(name, readFileSync(join(dir, `${name}.md`), "utf8"));
}

/** A file in roles/, read as a role, or the reason it can't be. */
export type RoleEntry = { name: string; role: Role } | { name: string; error: string };

/** Every `*.md` file in the folder, read now (docs/specs/2026-11-27-role-prompts-page.md, Backend). */
export function listRoles(dir: string = ROLES_DIR): RoleEntry[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file): RoleEntry => {
      const name = file.slice(0, -".md".length);
      try {
        return { name, role: parseRole(name, readFileSync(join(dir, file), "utf8")) };
      } catch (error) {
        return { name, error: (error as Error).message };
      }
    });
}

/**
 * The roles ARCHITECTURE.md's Roles table names that have no file yet, listed greyed out on the Role prompts page.
 * Temporary, like `implemented: false` in LANES: the slice that writes a role's file removes its entry. A file of the
 * same name always wins.
 */
export const PLANNED_ROLES: readonly { name: string; lane: Lane | null }[] = [
  { name: "designer", lane: "mockup" },
  { name: "tester", lane: "check" },
  { name: "manager", lane: null },
];
