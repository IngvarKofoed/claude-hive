import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SpecView } from "./SpecView";

describe("SpecView", () => {
  it("says the writer is writing while the text is null", () => {
    render(<SpecView spec={{ path: "docs/specs/x.md", text: null, review: "none" }} brief={null} />);
    expect(screen.getByText("The spec writer is writing the spec…")).toBeInTheDocument();
    expect(screen.getByText("docs/specs/x.md")).toBeInTheDocument();
  });

  it("renders the Markdown, tables included, and a collapsed brief", () => {
    const text = "# Title\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    const { container } = render(
      <SpecView spec={{ path: "docs/specs/x.md", text, review: "fresh" }} brief={null} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });
});
