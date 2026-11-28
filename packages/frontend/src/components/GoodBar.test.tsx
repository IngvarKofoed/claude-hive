import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardDetail } from "@hive/shared";

const detail = (over: Partial<CardDetail> = {}): CardDetail =>
  ({
    id: "c1", lane: "refine", state: "needs-you", turnRunning: false, pending: null, mockup: null, chat: [], issues: [],
    spec: null, landing: false, fromChat: null, ...over,
  }) as CardDetail;
import { api } from "../api/client";
import { GoodBar } from "./GoodBar";

afterEach(() => vi.restoreAllMocks());

describe("GoodBar", () => {
  it("sends skipMockup: false from 'on to Mockup', then reports the move", async () => {
    const good = vi.spyOn(api, "good").mockResolvedValue({} as never);
    const onMoved = vi.fn();
    render(<GoodBar detail={detail()} onMoved={onMoved} />);
    await userEvent.click(screen.getByRole("button", { name: "Good · on to Mockup" }));
    expect(good).toHaveBeenCalledWith("c1", { skipMockup: false });
    expect(onMoved).toHaveBeenCalledOnce();
  });

  it("sends skipMockup: true from 'skip to Spec'", async () => {
    const good = vi.spyOn(api, "good").mockResolvedValue({} as never);
    const onMoved = vi.fn();
    render(<GoodBar detail={detail()} onMoved={onMoved} />);
    await userEvent.click(screen.getByRole("button", { name: "Good · skip to Spec" }));
    expect(good).toHaveBeenCalledWith("c1", { skipMockup: true });
    expect(onMoved).toHaveBeenCalledOnce();
  });

  it("disables both while a turn runs or a question waits", () => {
    const { rerender } = render(<GoodBar detail={detail({ turnRunning: true })} onMoved={() => {}} />);
    expect(screen.getByRole("button", { name: "Good · on to Mockup" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Good · skip to Spec" })).toBeDisabled();
    expect(screen.getByText("Wait for the product owner to finish")).toBeInTheDocument();
    rerender(<GoodBar detail={detail({ pending: {} as never })} onMoved={() => {}} />);
    expect(screen.getByRole("button", { name: "Good · on to Mockup" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Good · skip to Spec" })).toBeDisabled();
  });

  it("shows the error and doesn't report a move", async () => {
    vi.spyOn(api, "good").mockRejectedValue(new Error("Nope"));
    const onMoved = vi.fn();
    render(<GoodBar detail={detail()} onMoved={onMoved} />);
    await userEvent.click(screen.getByRole("button", { name: "Good · skip to Spec" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope");
    expect(onMoved).not.toHaveBeenCalled();
  });
});
