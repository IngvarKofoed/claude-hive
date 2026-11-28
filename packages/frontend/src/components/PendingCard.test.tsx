import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingItem } from "@hive/shared";
import { api } from "../api/client";
import { PendingCard } from "./PendingCard";

const question: PendingItem = {
  id: "q1",
  kind: "question",
  questions: [
    {
      question: "Which one?",
      header: "Pick",
      multiSelect: false,
      options: [
        { label: "A", description: "" },
        { label: "B", description: "" },
      ],
    },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe("PendingCard", () => {
  it("sends through the answer function it is given, not api.answer", async () => {
    const answerApi = vi.spyOn(api, "answer").mockResolvedValue(undefined);
    const answer = vi.fn().mockResolvedValue(undefined);
    render(<PendingCard item={question} onError={() => {}} answer={answer} />);
    await userEvent.click(screen.getByRole("button", { name: "B" }));
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(answer).toHaveBeenCalledWith("q1", { answers: { "Which one?": "B" } });
    expect(answerApi).not.toHaveBeenCalled();
  });

  it("sends through api.answer when none is given", async () => {
    const answerApi = vi.spyOn(api, "answer").mockResolvedValue(undefined);
    render(<PendingCard item={question} onError={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "A" }));
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(answerApi).toHaveBeenCalledWith("q1", { answers: { "Which one?": "A" } });
  });

  it("sends a permission answer through the given function too", async () => {
    const answer = vi.fn().mockResolvedValue(undefined);
    const item: PendingItem = { id: "p1", kind: "permission", toolName: "Bash", detail: "ls" };
    render(<PendingCard item={item} onError={() => {}} answer={answer} />);
    await userEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(answer).toHaveBeenCalledWith("p1", { allow: true });
  });
});
