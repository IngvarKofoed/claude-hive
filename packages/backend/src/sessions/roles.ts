// A role is a Markdown file in roles/: settings at the top (front matter), instructions below
// (docs/ARCHITECTURE.md, Roles).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
    model: settings.model,
    kind: settings.kind ?? "conversation",
    instructions: match[2]!.trim(),
  };
}

export function loadRole(name: string, dir: string = ROLES_DIR): Role {
  return parseRole(name, readFileSync(join(dir, `${name}.md`), "utf8"));
}
