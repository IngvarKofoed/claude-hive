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

  it("doesn't repeat the brief", () => {
    render(<SpecView spec={{ path: "docs/specs/x.md", text: "# Title", review: "fresh" }} />);
    expect(screen.queryByText("Brief")).toBeNull();
  });
});
