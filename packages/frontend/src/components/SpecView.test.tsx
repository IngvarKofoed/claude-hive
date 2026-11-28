import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SpecView } from "./SpecView";

describe("SpecView", () => {
  it("says the writer is writing while the text is null", () => {
    const { container } = render(<SpecView spec={{ path: "docs/specs/x.md", text: null, review: "none" }} />);
    expect(screen.getByText("The spec writer is writing the spec…")).toBeInTheDocument();
    expect(screen.getByText("docs/specs/x.md")).toBeInTheDocument();
    expect(container.querySelector("details")).toBeNull();
  });

  it("folds the rendered Markdown, tables included, under its path, and opens on a click", () => {
    const text = "# Title\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    const { container } = render(<SpecView spec={{ path: "docs/specs/x.md", text, review: "fresh" }} />);
    const fold = container.querySelector("details");
    expect(fold).not.toHaveAttribute("open");
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeInTheDocument();

    fireEvent.click(screen.getByText("docs/specs/x.md"));
    expect(fold).toHaveAttribute("open");
  });

  it("shows Outcome and Key decisions open above the whole spec, which stays folded", () => {
    const text = "# Title\n\n## Outcome\n\n- You get it.\n\n## Key decisions\n\n- Reuse it.\n\n## Goals\n\n- A goal.\n";
    const { container } = render(<SpecView spec={{ path: "docs/specs/x.md", text, review: "none" }} />);
    const fold = container.querySelector("details")!;
    expect(fold).not.toHaveAttribute("open");
    const open = screen.getAllByRole("heading", { level: 2 }).filter((h) => !fold.contains(h));
    expect(open.map((h) => h.textContent)).toEqual(["Outcome", "Key decisions"]);
    expect(screen.getAllByText("You get it.").filter((t) => !fold.contains(t))).toHaveLength(1);
    // The whole spec is still in the fold, as it is in the file.
    expect(fold).toHaveTextContent("Title");
    expect(fold).toHaveTextContent("You get it.");
    expect(fold).toHaveTextContent("A goal.");
    expect(screen.getAllByText("A goal.").filter((t) => !fold.contains(t))).toHaveLength(0);
  });

  it("shows only the fold for a spec without those chapters", () => {
    const { container } = render(<SpecView spec={{ path: "docs/specs/x.md", text: "# Title\n\n## Goals", review: "none" }} />);
    expect(container.firstElementChild?.tagName).toBe("DETAILS");
  });

  it("doesn't repeat the brief", () => {
    render(<SpecView spec={{ path: "docs/specs/x.md", text: "# Title", review: "fresh" }} />);
    expect(screen.queryByText("Brief")).toBeNull();
  });
});
