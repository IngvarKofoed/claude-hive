import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardDetail, MockupInfo } from "@hive/shared";
import { api } from "../api/client";
import { KeepMockupLine } from "./KeepMockupLine";

afterEach(() => vi.restoreAllMocks());

const detail = (mockup: MockupInfo | null) => ({ id: "c1", mockup }) as CardDetail;
const info = (over: Partial<MockupInfo> = {}): MockupInfo => ({
  folder: "docs/mockups/c1",
  current: { kind: "pages", page: "docs/mockups/c1/index.html" },
  kept: false,
  files: ["index.html"],
  ...over,
});
const LINE = "The mockup isn't kept: its pages are deleted at sign-off.";

describe("KeepMockupLine", () => {
  it("shows the line while the mockup isn't kept and its pages exist", () => {
    render(<KeepMockupLine detail={detail(info())} />);
    expect(screen.getByText(LINE)).toBeInTheDocument();
  });

  it("shows a not-kept link with or without files beside it, since Keep writes its README", () => {
    const link = { kind: "link" as const, url: "https://claude.ai/design/p/abc" };
    const { unmount } = render(<KeepMockupLine detail={detail(info({ current: link, files: [] }))} />);
    expect(screen.getByText("The mockup isn't kept: its link isn't saved in docs/mockups.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep it after all" })).toBeInTheDocument();
    unmount();
    render(<KeepMockupLine detail={detail(info({ current: link, files: ["settings.png"] }))} />);
    expect(screen.getByText(
      "The mockup isn't kept: its link isn't saved in docs/mockups, and the files beside it are deleted at sign-off.",
    )).toBeInTheDocument();
  });

  it("shows nothing when Keep would refuse: kept, undecided, skipped, never named, or pages already gone", () => {
    for (const mockup of [
      info({ kept: true }), info({ kept: null }), null, info({ files: [] }), info({ current: null }),
    ]) {
      const { container, unmount } = render(<KeepMockupLine detail={detail(mockup)} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("calls keepMockup from its button", async () => {
    const keep = vi.spyOn(api, "keepMockup").mockResolvedValue({});
    render(<KeepMockupLine detail={detail(info())} />);
    await userEvent.click(screen.getByRole("button", { name: "Keep it after all" }));
    expect(keep).toHaveBeenCalledWith("c1");
  });

  it("shows the error when keeping fails", async () => {
    vi.spyOn(api, "keepMockup").mockRejectedValue(new Error("git said no"));
    render(<KeepMockupLine detail={detail(info())} />);
    await userEvent.click(screen.getByRole("button", { name: "Keep it after all" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("git said no");
  });
});
