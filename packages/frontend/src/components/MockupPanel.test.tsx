import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MockupInfo } from "@hive/shared";
import { MockupLookBack, MockupPanel } from "./MockupPanel";

const pages = (over: Partial<MockupInfo> = {}): MockupInfo => ({
  folder: "docs/mockups/c1",
  current: { kind: "pages", page: "docs/mockups/c1/index.html" },
  kept: null,
  files: ["index.html"],
  ...over,
});

describe("MockupPanel", () => {
  it("links a page to the served URL in a new tab, with the path and the reload hint", () => {
    render(<MockupPanel cardId="c1" mockup={pages()} />);
    const link = screen.getByRole("link", { name: "Open the mockup ↗" });
    expect(link).toHaveAttribute("href", "/api/cards/c1/mockup/index.html");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
    expect(screen.getByText("docs/mockups/c1/index.html")).toBeInTheDocument();
    expect(screen.getByText("Reload the tab after the designer's changes.")).toBeInTheDocument();
  });

  it("encodes each path segment but keeps the slashes", () => {
    const page = "docs/mockups/c1/my screens/a#b.html";
    render(<MockupPanel cardId="c1" mockup={pages({ current: { kind: "pages", page } })} />);
    expect(screen.getByRole("link", { name: "Open the mockup ↗" })).toHaveAttribute(
      "href",
      "/api/cards/c1/mockup/my%20screens/a%23b.html",
    );
  });

  it("opens a link in a new tab and shows its URL", () => {
    const url = "https://claude.ai/design/abc";
    render(<MockupPanel cardId="c1" mockup={pages({ current: { kind: "link", url }, files: [] })} />);
    const link = screen.getByRole("link", { name: "Open the mockup ↗" });
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
    expect(screen.getByText(url)).toBeInTheDocument();
    expect(screen.queryByText(/Reload the tab/)).toBeNull();
  });

  it("shows the placeholder until the designer names a mockup", () => {
    const { rerender } = render(<MockupPanel cardId="c1" mockup={pages({ current: null })} />);
    expect(screen.getByText("The designer's mockup shows here once it has one.")).toBeInTheDocument();
    rerender(<MockupPanel cardId="c1" mockup={null} />);
    expect(screen.getByText("The designer's mockup shows here once it has one.")).toBeInTheDocument();
  });
});

describe("MockupLookBack", () => {
  it("lists a kept mockup's files as links while the worktree is there", () => {
    render(
      <MockupLookBack
        cardId="c1"
        hasWorktree
        mockup={pages({ kept: true, files: ["index.html", "my shots/a#1.png"] })}
      />,
    );
    expect(screen.getByText("Kept in docs/mockups/c1/")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "index.html" })).toHaveAttribute("href", "/api/cards/c1/mockup/index.html");
    expect(screen.getByRole("link", { name: "my shots/a#1.png" })).toHaveAttribute(
      "href",
      "/api/cards/c1/mockup/my%20shots/a%231.png",
    );
  });

  it("says where a kept mockup is on main once the worktree is gone", () => {
    render(<MockupLookBack cardId="c1" hasWorktree={false} mockup={pages({ kept: true, files: [] })} />);
    expect(screen.getByText("Kept: on main at docs/mockups/c1/.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says a mockup wasn't kept, with its pages while they exist", () => {
    render(<MockupLookBack cardId="c1" hasWorktree mockup={pages({ kept: false })} />);
    expect(screen.getByText("Not kept.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the mockup ↗" })).toHaveAttribute("href", "/api/cards/c1/mockup/index.html");
  });

  it("says the pages of a mockup that wasn't kept were deleted at sign-off", () => {
    render(<MockupLookBack cardId="c1" hasWorktree mockup={pages({ kept: false, files: [] })} />);
    expect(screen.getByText(/Its pages were deleted at sign-off\./)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows a link mockup's URL as a link", () => {
    const url = "https://claude.ai/design/abc";
    render(
      <MockupLookBack cardId="c1" hasWorktree mockup={pages({ kept: true, current: { kind: "link", url }, files: [] })} />,
    );
    expect(screen.getByRole("link", { name: url })).toHaveAttribute("href", url);
  });

  it("says when nothing was named", () => {
    render(<MockupLookBack cardId="c1" hasWorktree mockup={pages({ kept: false, current: null, files: [] })} />);
    expect(screen.getByText("No mockup was made.")).toBeInTheDocument();
  });
});
