import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BuildReport, Decision, SpecIssue } from "@hive/shared";
import { BuildView } from "./BuildView";

const build: BuildReport = {
  summary: "Added the per-printer font size.",
  departures: [{ step: "Show it", what: "Used a dropdown", why: "The panel had no room" }],
  files: [
    { path: "src/a.ts", added: 12, removed: 3 },
    { path: "logo.png", added: null, removed: null },
  ],
};
const issues: SpecIssue[] = [
  { id: "i1", foundIn: "build", where: "Key decisions", problem: "Silent on order", guess: "Alphabetical" },
];
const decisions: Decision[] = [
  { id: "d1", lane: "build", what: "Rounded up", alternative: "Rounded down", source: "developer" },
];

describe("BuildView", () => {
  it("renders the summary as Markdown, since the developer writes it that way", () => {
    const summary = "What was built:\n\n- **Font range:** `src/fonts.ts` allows 8–48 pt\n- **Lookup:** by id first";
    render(<BuildView build={{ ...build, summary, departures: [] }} issues={[]} decisions={[]} />);
    expect(screen.getByText("Font range:").tagName).toBe("STRONG");
    expect(screen.getByText("src/fonts.ts").tagName).toBe("CODE");
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it("renders every part of a full report", () => {
    render(<BuildView build={build} issues={issues} decisions={decisions} />);
    expect(screen.getByText("Added the per-printer font size.")).toBeInTheDocument();
    expect(screen.getByText("Show it")).toBeInTheDocument();
    expect(screen.getByText("Used a dropdown")).toBeInTheDocument();
    expect(screen.getByText("Why: The panel had no room")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("+12 −3")).toBeInTheDocument();
    expect(screen.getByText("binary")).toBeInTheDocument();
    expect(screen.getByText("Key decisions")).toBeInTheDocument();
    expect(screen.getByText("Silent on order")).toBeInTheDocument();
    expect(screen.getByText("Built as: Alphabetical")).toBeInTheDocument();
    expect(screen.getByText("Rounded up")).toBeInTheDocument();
    expect(screen.getByText("Instead of: Rounded down")).toBeInTheDocument();
    expect(screen.queryByText("None.")).toBeNull();
  });

  it("says None. for each empty part", () => {
    render(<BuildView build={null} issues={[]} decisions={[]} />);
    expect(screen.getAllByText("None.")).toHaveLength(4);
  });

  it("says None. for empty departures and files of a report", () => {
    render(<BuildView build={{ summary: "Done.", departures: [], files: [] }} issues={[]} decisions={[]} />);
    expect(screen.getAllByText("None.")).toHaveLength(4);
  });
});
