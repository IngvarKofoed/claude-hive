import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForYouItem } from "@hive/shared";

vi.mock("../api/events", () => ({
  useHiveEvents: () => {},
  useStreamOpen: () => {},
  subscribe: () => () => {},
  onStreamOpen: () => () => {},
}));

import { api } from "../api/client";
import { ForYouProvider } from "../components/forYou";
import { ForYouEntry } from "../components/ForYouEntry";
import { ForYou } from "./ForYou";

const base = (id: string, kind: ForYouItem["kind"], lane: ForYouItem["card"]["lane"], text: string): ForYouItem => ({
  card: { id, projectId: "p", title: `Title ${id}`, lane, state: "needs-you", moveError: null },
  projectName: "flux",
  since: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  kind,
  text,
  pending: null,
});

function show() {
  return render(
    <MemoryRouter>
      <ForYouProvider>
        <ForYou />
      </ForYouProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("ForYou page", () => {
  it("renders tag, project and title, text and link label per kind", async () => {
    vi.spyOn(api, "forYou").mockResolvedValue({
      items: [
        base("a", "try-it", "tryit", "Test it by hand"),
        base("b", "sign-off", "spec", "Sign the spec off"),
        base("c", "stuck", "build", "It stopped"),
      ],
    });
    show();
    expect(await screen.findByText("Test it by hand")).toBeTruthy();
    expect(screen.getByText("3 things are holding up a card", { exact: false })).toBeTruthy();
    expect(screen.getByText("Spec · sign off")).toBeTruthy();
    expect(screen.getByText("Build · stuck")).toBeTruthy();
    expect(screen.getByText("flux · Title a")).toBeTruthy();
    expect(screen.getAllByText("2 h ago").length).toBe(3);
    expect(screen.getByRole("link", { name: "Try it" }).getAttribute("href")).toBe("/cards/a");
    expect(screen.getByRole("link", { name: "Open the chat" }).getAttribute("href")).toBe("/cards/b");
    expect(screen.getByRole("link", { name: "Open the card" }).getAttribute("href")).toBe("/cards/c");
  });

  it("renders PendingCard for a question entry", async () => {
    const q = base("q", "question", "build", "Which font size?");
    q.pending = {
      id: "i1",
      kind: "question",
      questions: [
        { question: "Up or down?", header: "Size", multiSelect: false, options: [{ label: "Up", description: "" }] },
      ],
    };
    vi.spyOn(api, "forYou").mockResolvedValue({ items: [q] });
    show();
    expect(await screen.findByText("Up or down?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.getByText("Build · question")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the card" })).toBeTruthy();
  });

  it("drops a failed answer's error once the card asks something else", async () => {
    const question = (id: string): ForYouItem => ({
      ...base("q", "question", "build", "?"),
      pending: {
        id,
        kind: "question",
        questions: [{ question: `Q ${id}`, header: "H", multiSelect: false, options: [{ label: "Up", description: "" }] }],
      },
    });
    vi.spyOn(api, "answer").mockRejectedValue(new Error("That has already been answered."));
    const entry = (item: ForYouItem) => (
      <MemoryRouter>
        <ForYouEntry item={item} nowMs={Date.now()} />
      </MemoryRouter>
    );
    const view = render(entry(question("i1")));
    fireEvent.click(screen.getByRole("button", { name: "Up" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("That has already been answered.")).toBeTruthy();

    // The same entry (keyed by card) now carries the card's next question.
    view.rerender(entry(question("i2")));
    expect(screen.getByText("Q i2")).toBeTruthy();
    expect(screen.queryByText("That has already been answered.")).toBeNull();
  });

  it("shows the empty state", async () => {
    vi.spyOn(api, "forYou").mockResolvedValue({ items: [] });
    show();
    expect(await screen.findByText("Nothing is waiting for you. Everything is running on its own.")).toBeTruthy();
  });
});
