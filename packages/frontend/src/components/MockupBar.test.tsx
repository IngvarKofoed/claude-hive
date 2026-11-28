import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MockupInfo } from "@hive/shared";
import type { CardDetail } from "@hive/shared";

const detail = (over: Partial<CardDetail> = {}): CardDetail =>
  ({
    id: "c1", lane: "mockup", state: "needs-you", turnRunning: false, pending: null, mockup: null, chat: [], issues: [],
    spec: null, landing: false, ...over,
  }) as CardDetail;
import { api } from "../api/client";
import { MockupBar } from "./MockupBar";

afterEach(() => vi.restoreAllMocks());

const pages: MockupInfo = {
  folder: "docs/mockups/c1",
  current: { kind: "pages", page: "docs/mockups/c1/index.html" },
  kept: null,
  files: ["index.html"],
};
const keep = () => screen.getByRole("button", { name: "Good · keep in docs/mockups" });
const dontKeep = () => screen.getByRole("button", { name: "Good · don't keep" });

describe("MockupBar", () => {
  it("disables Keep until the designer has named a mockup, and says why", () => {
    render(<MockupBar detail={detail({ mockup: { ...pages, current: null, files: [] } })} onMoved={() => {}} />);
    expect(keep()).toBeDisabled();
    expect(dontKeep()).toBeEnabled();
    expect(screen.getByText("Keep needs a mockup: the designer hasn't named one yet.")).toBeInTheDocument();
  });

  it("disables both while the designer works or a question waits", () => {
    const { rerender } = render(<MockupBar detail={detail({ mockup: pages, turnRunning: true })} onMoved={() => {}} />);
    expect(keep()).toBeDisabled();
    expect(dontKeep()).toBeDisabled();
    expect(screen.getByText("Wait for the designer to finish")).toBeInTheDocument();
    rerender(<MockupBar detail={detail({ mockup: pages, pending: {} as never })} onMoved={() => {}} />);
    expect(keep()).toBeDisabled();
    expect(dontKeep()).toBeDisabled();
  });

  it("explains a link with no exported files", () => {
    const link: MockupInfo = { ...pages, current: { kind: "link", url: "https://claude.ai/x" }, files: [] };
    render(<MockupBar detail={detail({ mockup: link })} onMoved={() => {}} />);
    expect(
      screen.getByText(
        "The hive can't open this link. Give the designer a path to exported screens, or the spec goes by the chat alone.",
      ),
    ).toBeInTheDocument();
  });

  it("sends keep: true and keep: false, each then reporting the move", async () => {
    const good = vi.spyOn(api, "good").mockResolvedValue({} as never);
    const onMoved = vi.fn();
    render(<MockupBar detail={detail({ mockup: pages })} onMoved={onMoved} />);
    await userEvent.click(keep());
    expect(good).toHaveBeenLastCalledWith("c1", { keep: true });
    await userEvent.click(dontKeep());
    expect(good).toHaveBeenLastCalledWith("c1", { keep: false });
    expect(onMoved).toHaveBeenCalledTimes(2);
  });

  it("shows the error and doesn't report a move", async () => {
    vi.spyOn(api, "good").mockRejectedValue(new Error("The folder is empty"));
    const onMoved = vi.fn();
    render(<MockupBar detail={detail({ mockup: pages })} onMoved={onMoved} />);
    await userEvent.click(keep());
    expect(await screen.findByRole("alert")).toHaveTextContent("The folder is empty");
    expect(onMoved).not.toHaveBeenCalled();
  });
});
