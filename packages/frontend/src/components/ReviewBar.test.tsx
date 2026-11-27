import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardDetail, ReviewState } from "@hive/shared";
import { api } from "../api/client";
import { REVIEW_TEXT, ReviewBar } from "./ReviewBar";

function detail(review: ReviewState, over: Partial<CardDetail> = {}, text: string | null = "# Spec"): CardDetail {
  return {
    id: "c1",
    projectId: "p1",
    projectName: "m",
    title: "T",
    ideaTitle: "i",
    ideaText: "i",
    lane: "spec",
    state: "needs-you",
    moveError: null,
    branch: null,
    worktreePath: null,
    brief: null,
    spec: { path: "docs/specs/x.md", text, review },
    specPath: "docs/specs/x.md",
    plan: null,
    build: null,
    check: null,
    setup: null,
    port: null,
    feedback: null,
    apps: [],
    appStopped: false,
    issues: [],
    decisions: [],
    chat: [],
    pastChats: {},
    pending: null,
    turnRunning: false,
    landed: null,
    landing: false,
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

const cases: Array<[ReviewState, string, boolean, boolean]> = [
  // state, text, Review enabled, Sign off enabled
  ["none", "No review yet", true, false],
  ["running", "Review running…", false, false],
  ["applying", "Applying the review…", false, false],
  ["unfinished", "Review not finished: retry", false, false],
  ["fresh", "Reviewed: you can sign off", false, true],
  ["stale", "Changed since the review", true, false],
];

describe("ReviewBar", () => {
  it.each(cases)("%s: says %s", (state, text, review, signoff) => {
    render(<ReviewBar detail={detail(state)} onMoved={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(text);
    expect(REVIEW_TEXT[state]).toBe(text);
    expect(screen.getByRole("button", { name: "Review" })).toHaveProperty("disabled", !review);
    expect(screen.getByRole("button", { name: "Sign off" })).toHaveProperty("disabled", !signoff);
  });

  it("gives a reason beside a greyed Sign off, and none when it is enabled", () => {
    const { rerender } = render(<ReviewBar detail={detail("stale")} onMoved={() => {}} />);
    expect(screen.getByText(/Review the changed spec again/)).toBeInTheDocument();
    rerender(<ReviewBar detail={detail("fresh")} onMoved={() => {}} />);
    expect(screen.queryByText(/first$/)).not.toBeInTheDocument();
  });

  it("greys both buttons while a turn runs, and Review while the spec isn't written", () => {
    const { rerender } = render(<ReviewBar detail={detail("fresh", { turnRunning: true })} onMoved={() => {}} />);
    expect(screen.getByRole("button", { name: "Sign off" })).toBeDisabled();
    rerender(<ReviewBar detail={detail("none", { turnRunning: true })} onMoved={() => {}} />);
    expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
    rerender(<ReviewBar detail={detail("none", {}, null)} onMoved={() => {}} />);
    expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
  });

  it("calls review and signoff, calls onMoved after sign-off and shows a refusal", async () => {
    const review = vi.spyOn(api, "review").mockResolvedValue({ ok: true });
    const signoff = vi.spyOn(api, "signoff").mockResolvedValue({} as never);
    const onMoved = vi.fn();
    const { rerender } = render(<ReviewBar detail={detail("none")} onMoved={onMoved} />);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(review).toHaveBeenCalledWith("c1");
    rerender(<ReviewBar detail={detail("fresh")} onMoved={onMoved} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign off" }));
    expect(signoff).toHaveBeenCalledWith("c1");
    expect(onMoved).toHaveBeenCalled();

    signoff.mockRejectedValue(new Error("The spec changed since the review"));
    await userEvent.click(screen.getByRole("button", { name: "Sign off" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The spec changed since the review");
  });

  it("renders nothing without a spec", () => {
    const { container } = render(<ReviewBar detail={{ ...detail("none"), spec: null }} onMoved={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
