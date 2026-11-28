import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BuildReport, Decision, IssueStatus, Lane, SpecIssue } from "@hive/shared";
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
  { id: "i1", foundIn: "build", where: "Key decisions", problem: "Silent on order", guess: "Alphabetical", status: "open", judgment: null, answer: null },
];
const decisions: Decision[] = [
  { id: "d1", lane: "build", what: "Rounded up", alternative: "Rounded down", source: "developer" },
];

describe("BuildView", () => {
  it("renders the summary as Markdown, since the developer writes it that way", () => {
    const summary = "What was built:\n\n- **Font range:** `src/fonts.ts` allows 8–48 pt\n- **Lookup:** by id first";
    render(<BuildView build={{ ...build, summary, departures: [] }} issues={[]} decisions={[]} lane="build" />);
    expect(screen.getByText("Font range:").tagName).toBe("STRONG");
    expect(screen.getByText("src/fonts.ts").tagName).toBe("CODE");
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it("renders every part of a full report", () => {
    render(<BuildView build={build} issues={issues} decisions={decisions} lane="build" />);
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
    render(<BuildView build={null} issues={[]} decisions={[]} lane="build" />);
    expect(screen.getAllByText("None.")).toHaveLength(4);
  });

  it("says None. for empty departures and files of a report", () => {
    render(<BuildView build={{ summary: "Done.", departures: [], files: [] }} issues={[]} decisions={[]} lane="build" />);
    expect(screen.getAllByText("None.")).toHaveLength(4);
  });

  const issue = (over: Partial<SpecIssue> = {}): SpecIssue => ({
    id: "i1",
    foundIn: "build",
    where: "Key decisions",
    problem: "Silent on order",
    guess: "Alphabetical",
    status: "open",
    judgment: null,
    answer: null,
    ...over,
  });
  const judgment = { verdict: "spec-wrong" as const, level: "minor" as const, reason: "The spec was silent", recommendation: "", repeats: null };

  it("labels every status", () => {
    const labels: Record<IssueStatus, string> = {
      open: "Waiting for the spec keeper",
      "spec-fixed": "Spec fixed",
      "no-change": "No change",
      sent: "Sent to the developer",
      fixed: "Code fixed",
      judged: "Judged",
      severe: "Severe",
      waiting: "Waits for you",
      held: "You: Change the code",
      kept: "You: Keep it as built",
      settled: "Settled in Spec",
    };
    for (const [status, label] of Object.entries(labels)) {
      const { unmount } = render(
        <BuildView build={null} issues={[issue({ status: status as IssueStatus })]} decisions={[]} lane="check" />,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("says Not judged for an open issue once the card has moved on", () => {
    for (const lane of ["tryit", "ship", "done"] as Lane[]) {
      const { unmount } = render(<BuildView build={null} issues={[issue()]} decisions={[]} lane={lane} />);
      expect(screen.getByText("Not judged")).toBeInTheDocument();
      expect(screen.queryByText("Waiting for the spec keeper")).toBeNull();
      unmount();
    }
  });

  it("shows the keeper's reason, its recommendation when there is one, and your words", () => {
    const answered = issue({
      status: "held",
      judgment: { ...judgment, recommendation: "Change the code" },
      answer: { choice: "change", words: "Sort by date" },
    });
    render(<BuildView build={null} issues={[answered]} decisions={[]} lane="tryit" />);
    expect(screen.getByText("Spec keeper: The spec was silent")).toBeInTheDocument();
    expect(screen.getByText("Recommends: Change the code")).toBeInTheDocument();
    expect(screen.getByText("You said: Sort by date")).toBeInTheDocument();
  });

  it("leaves out an empty recommendation and no words", () => {
    render(<BuildView build={null} issues={[issue({ status: "spec-fixed", judgment })]} decisions={[]} lane="tryit" />);
    expect(screen.queryByText(/Recommends/)).toBeNull();
    expect(screen.queryByText(/You said/)).toBeNull();
  });
});
