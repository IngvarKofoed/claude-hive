import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoleInfo } from "@hive/shared";

vi.mock("../api/events", () => ({
  useHiveEvents: () => {},
  useStreamOpen: () => {},
  subscribe: () => () => {},
  onStreamOpen: () => () => {},
}));

import { api } from "../api/client";
import { ForYouProvider } from "../components/forYou";
import { RolePrompts } from "./RolePrompts";

const role = (over: Partial<RoleInfo> & { name: string }): RoleInfo => ({
  lane: null,
  model: "opus",
  kind: "work",
  instructions: `Instructions of ${over.name}.`,
  extras: [],
  report: null,
  tools: [],
  ...over,
});

const roles: RoleInfo[] = [
  role({ name: "product-owner", lane: "refine", kind: "conversation", instructions: "You are the **owner**." }),
  role({
    name: "setup",
    lane: "refine",
    model: "sonnet",
    report: { properties: { status: { type: "string", enum: ["done", "blocked"] } } },
    tools: [
      {
        name: "copy_local_files",
        description: "Copies files.",
        input: { properties: { paths: { type: "array", items: { type: "string" }, description: "What to copy." } } },
      },
    ],
  }),
  role({ name: "planner", lane: "plan", extras: ["/home/me/.claude/skills/spec-format/format.md"], report: { properties: {} } }),
  role({ name: "developer", lane: "build" }),
  role({ name: "reviewer", lane: "check", error: "Bad front matter", model: null, kind: null, instructions: "" }),
  role({ name: "designer", lane: "mockup", planned: true, model: null, kind: null, instructions: "" }),
  role({ name: "manager", lane: null, model: "sonnet", kind: "one-off" }),
];

function show(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ForYouProvider>
        <Routes>
          <Route path="/roles" element={<RolePrompts />} />
          <Route path="/roles/:name" element={<RolePrompts />} />
        </Routes>
      </ForYouProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

function mockRoles() {
  vi.spyOn(api, "forYou").mockResolvedValue({ items: [] });
  return vi.spyOn(api, "roles").mockResolvedValue({ roles });
}

describe("RolePrompts page", () => {
  it("groups by lane, shows only the names, and selects the first role on /roles", async () => {
    const spy = mockRoles();
    show("/roles");
    const nav = await screen.findByRole("navigation", { name: "Roles" });
    const labels = ["Refine", "Plan", "Build", "Check", "Mockup", "Across lanes"];
    for (const label of labels) expect(within(nav).getByText(label)).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Setup" })).toBeTruthy();
    expect(within(nav).queryByText(/Opus|Sonnet|copy_local_files/)).toBeNull();
    const current = within(nav).getByRole("link", { current: "page" });
    expect(current.textContent).toBe("Product owner");
    expect(screen.getByText(/Added to the end of Claude Code's own system prompt/).closest("nav, section")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Product owner" })).toBeTruthy();
    expect(screen.getByText("owner").tagName).toBe("STRONG");
  });

  it("selects by the URL and shows chips, path and the sections", async () => {
    mockRoles();
    show("/roles/setup");
    const heading = await screen.findByRole("heading", { name: "Setup" });
    const panel = heading.closest("section")!;
    expect(within(panel).getByText("Refine lane")).toBeTruthy();
    expect(within(panel).getByText("Sonnet")).toBeTruthy();
    expect(within(panel).getByText("Work session")).toBeTruthy();
    expect(within(panel).getByText("roles/setup.md")).toBeTruthy();
    expect(within(panel).queryByText(/Added to the end/)).toBeNull();
    expect(within(panel).getByRole("heading", { name: "Report" })).toBeTruthy();
    expect(within(panel).getByText("one of done, blocked")).toBeTruthy();
    expect(within(panel).getByRole("heading", { name: "Hive tools" })).toBeTruthy();
    expect(within(panel).getByText("copy_local_files", { selector: "span" })).toBeTruthy();
    expect(within(panel).getByText("What to copy.")).toBeTruthy();
    expect(within(panel).queryByRole("heading", { name: "Also appended" })).toBeNull();
    expect(screen.getByRole("link", { current: "page" }).textContent).toContain("Setup");
  });

  it("shows the extras with their full path, and leaves out empty sections", async () => {
    mockRoles();
    show("/roles/planner");
    expect(await screen.findByText("/home/me/.claude/skills/spec-format/format.md")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Also appended" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Hive tools" })).toBeNull();
  });

  it("greys out a planned role and explains it in the panel", async () => {
    mockRoles();
    show("/roles/designer");
    const link = (await screen.findAllByRole("link", { name: /Designer/ }))[0]!;
    expect(link).toHaveAttribute("data-planned", "true");
    expect(link.textContent).toContain("Not written yet");
    expect(screen.getByText(/there's no/)).toBeTruthy();
    expect(screen.getByText("Mockup lane")).toBeTruthy();
  });

  it("shows an errored role's error in the list and alone in the panel", async () => {
    mockRoles();
    show("/roles/reviewer");
    await screen.findByRole("heading", { name: "Reviewer" });
    expect(screen.getAllByText("Bad front matter")).toHaveLength(2);
  });

  it("keeps the list for an unknown name", async () => {
    mockRoles();
    show("/roles/nobody");
    expect(await screen.findByText("There's no role called nobody.")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Roles" })).toBeTruthy();
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });

  it("shows a failed fetch as an alert", async () => {
    vi.spyOn(api, "forYou").mockResolvedValue({ items: [] });
    vi.spyOn(api, "roles").mockRejectedValue(new Error("Request failed (500)"));
    show("/roles");
    expect((await screen.findByRole("alert")).textContent).toBe("Request failed (500)");
  });
});
