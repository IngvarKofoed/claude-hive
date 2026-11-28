// The Role prompts page's backend: reading roles/, and what ROLE_TURNS adds to each role
// (docs/specs/2026-11-27-role-prompts-page.md).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LANES } from "@hive/shared";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { Hive } from "./hive";
import { listRoles, parseRole, PLANNED_ROLES, type RoleEntry } from "./sessions/roles";
import { CHECK_SCHEMA, COMMIT_SCHEMA, PLAN_SCHEMA } from "./spec/reports";
import { FakeProbe, FakeRunner } from "./testing";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hive-roles-"));
  temps.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

const role = (lane: string, model = "opus", kind = "work") =>
  `---\nname: x\nlane: ${lane}\nmodel: ${model}\nkind: ${kind}\n---\nYou are the ${lane} role.\n`;

function hiveWith(entries: RoleEntry[]): Hive {
  return new Hive({
    db: new HiveDb(":memory:"), hub: new EventHub(), git, runner: new FakeRunner(), probe: new FakeProbe(),
    role: (name) => ({ name, model: "opus", kind: "conversation", instructions: "" }),
    listRoles: () => entries,
    specFormatDir: "/formats",
  });
}

describe("reading roles/", () => {
  it("keeps the front matter's lane", () => {
    expect(parseRole("developer", role("build")).lane).toBe("build");
  });

  it("reads every .md file, by name, and gives a broken one its error instead of failing", () => {
    const dir = folder({
      "planner.md": role("plan"),
      "broken.md": "no front matter here",
      "nomodel.md": "---\nlane: build\n---\nHi\n",
      "notes.txt": "not a role",
    });
    mkdirSync(join(dir, "sub.md"), { recursive: true }); // a folder named like a role is not one
    const entries = listRoles(dir);
    expect(entries.map((e) => e.name)).toEqual(["broken", "nomodel", "planner", "sub"]);
    expect(entries[0]).toEqual({ name: "broken", error: "Role broken has no front matter" });
    expect(entries[1]).toEqual({ name: "nomodel", error: "Role nomodel has no model" });
    expect(entries[2]).toMatchObject({ name: "planner", role: { lane: "plan", model: "opus", kind: "work" } });
    expect(entries[3]).toMatchObject({ name: "sub", error: expect.any(String) });
  });

  it("finds every real role file readable, in a known lane, and none of them still planned", () => {
    const entries = listRoles();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty("error");
      if ("role" in entry) expect(LANES.map((l) => l.id)).toContain(entry.role.lane);
    }
    const names = entries.map((e) => e.name);
    for (const planned of PLANNED_ROLES) expect(names).not.toContain(planned.name);
  });
});

describe("Hive.roles()", () => {
  const files = (names: Record<string, string>): RoleEntry[] =>
    Object.entries(names).map(([name, lane]) => ({ name, role: parseRole(name, role(lane)) }));

  it("orders lanes as the board does, each lane's own role first, and roles with no lane last", () => {
    const hive = hiveWith(files({
      committer: "ship", reviewer: "check", "spec-reviewer": "spec", setup: "refine", "spec-writer": "spec",
      "product-owner": "refine", designer: "mockup", developer: "build", planner: "plan", stray: "nowhere",
    }));
    expect(hive.roles().roles.map((r) => `${r.lane ?? "-"}:${r.name}`)).toEqual([
      "refine:product-owner", "refine:setup",
      "mockup:designer",
      "spec:spec-writer", "spec:spec-reviewer",
      "plan:planner",
      "build:developer",
      "check:reviewer", "check:tester",
      "ship:committer",
      "-:manager", "-:stray",
    ]);
  });

  it("adds the spec-format files, the report and the hive tools each role's sessions get", () => {
    const roles = hiveWith(files({
      planner: "plan", "product-owner": "refine", reviewer: "check", committer: "ship", "spec-writer": "spec",
    })).roles().roles;
    const by = (name: string) => roles.find((r) => r.name === name)!;

    expect(by("planner")).toMatchObject({
      model: "opus", kind: "work", instructions: "You are the plan role.",
      extras: [join("/formats", "format.md")], tools: [],
    });
    expect(by("planner").report).toBe(PLAN_SCHEMA);
    expect(by("reviewer").report).toBe(CHECK_SCHEMA);
    expect(by("committer").report).toBe(COMMIT_SCHEMA);
    expect(by("spec-writer")).toMatchObject({ extras: [join("/formats", "format.md")], report: null, tools: [] });

    const [brief] = by("product-owner").tools;
    expect(brief!.name).toBe("write_brief");
    expect(brief!.description).toContain("Replace the card's brief");
    const input = brief!.input as { properties: Record<string, { type: string; description?: string }> };
    expect(Object.keys(input.properties)).toEqual([
      "title", "problem", "whoItsFor", "whatDoneLooksLike", "outOfScope", "openPoints",
    ]);
    expect(input.properties.whatDoneLooksLike).toMatchObject({ type: "array", description: expect.any(String) });
    expect(by("product-owner").report).toBeNull();
  });

  it("lists the designer under Mockup, with the set_mockup tool (docs/specs/2026-11-28-mockup-lane-and-designer-role.md)", () => {
    const real = listRoles().find((e) => e.name === "designer");
    expect(real).toMatchObject({ role: { lane: "mockup", model: "opus", kind: "conversation" } });
    expect(PLANNED_ROLES.map((p) => p.name)).not.toContain("designer");

    const designer = hiveWith([real!]).roles().roles.find((r) => r.name === "designer")!;
    expect(designer).toMatchObject({ lane: "mockup", model: "opus", kind: "conversation", report: null, extras: [] });
    expect(designer).not.toHaveProperty("planned");
    expect(designer.tools.map((t) => t.name)).toEqual(["set_mockup"]);
    const input = designer.tools[0]!.input as { properties: Record<string, unknown> };
    expect(Object.keys(input.properties)).toEqual(["page", "link"]);
  });

  it("says which roles get Claude Code's task-list tools: only the developer", () => {
    const roles = hiveWith(files({ developer: "build", planner: "plan" })).roles().roles;
    expect(roles.find((r) => r.name === "developer")!.taskTools).toBe(true);
    expect(roles.find((r) => r.name === "planner")!.taskTools).toBe(false);
  });

  it("lists a broken file with its error and nothing else, even when ROLE_TURNS names it", () => {
    const [entry] = hiveWith([{ name: "planner", error: "Role planner has no front matter" }])
      .roles().roles.filter((r) => !r.planned);
    expect(entry).toEqual({
      name: "planner", lane: null, model: null, kind: null, instructions: "", extras: [], report: null, tools: [],
      taskTools: false, error: "Role planner has no front matter",
    });
  });

  it("lists the roles still to be written, unless a file of that name exists, and gives an unknown lane none", () => {
    const roles = hiveWith(files({ tester: "check", odd: "somewhere" })).roles().roles;
    expect(roles.filter((r) => r.planned).map((r) => r.name)).toEqual(["manager"]);
    expect(roles.find((r) => r.name === "manager")).toEqual({
      name: "manager", lane: null, model: null, kind: null, instructions: "", extras: [], report: null, tools: [],
      taskTools: false, planned: true,
    });
    expect(roles.find((r) => r.name === "tester")).not.toHaveProperty("planned");
    expect(roles.find((r) => r.name === "odd")!.lane).toBeNull();
  });
});
