import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForYouItem, ForYouResponse, HiveEvent } from "@hive/shared";

const listeners = new Set<(event: HiveEvent) => void>();
vi.mock("../api/events", () => ({
  useHiveEvents: (handler: (event: HiveEvent) => void) => {
    listeners.add(handler);
  },
  useStreamOpen: () => {},
  subscribe: () => () => {},
  onStreamOpen: () => () => {},
}));

import { api } from "../api/client";
import { ForYouProvider, useForYou } from "./forYou";
import { Header } from "./Header";

const item = (id: string): ForYouItem => ({
  card: { id, projectId: "p", title: `T${id}`, lane: "tryit", state: "needs-you", moveError: null },
  projectName: "proj",
  since: "2026-11-27T10:00:00Z",
  kind: "try-it",
  text: "Try it out",
  pending: null,
  actions: [],
});

beforeEach(() => listeners.clear());
afterEach(() => vi.restoreAllMocks());

function Probe() {
  const { items } = useForYou();
  return <p>count {items.length}</p>;
}

describe("ForYouProvider", () => {
  it("refetches on card.updated and ignores an older response that arrives late", async () => {
    const resolvers: ((r: ForYouResponse) => void)[] = [];
    const spy = vi.spyOn(api, "forYou").mockImplementation(() => new Promise((r) => resolvers.push(r)));
    render(
      <ForYouProvider>
        <Probe />
      </ForYouProvider>,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    act(() => {
      listeners.forEach((l) => l({ type: "card.updated", card: item("a").card }));
    });
    expect(spy).toHaveBeenCalledTimes(2);
    await act(async () => resolvers[1]!({ items: [item("a"), item("b")] }));
    await act(async () => resolvers[0]!({ items: [] }));
    expect(screen.getByText("count 2")).toBeTruthy();
  });

  it("refetches on an error line, which may come with no card.updated, but not on an ordinary message", () => {
    const spy = vi.spyOn(api, "forYou").mockResolvedValue({ items: [] });
    render(
      <ForYouProvider>
        <Probe />
      </ForYouProvider>,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    act(() => {
      listeners.forEach((l) =>
        l({ type: "chat.message", cardId: "a", item: { kind: "message", id: "m", at: "", from: "hive", text: "Hi" } }),
      );
    });
    expect(spy).toHaveBeenCalledTimes(1);
    act(() => {
      listeners.forEach((l) =>
        l({ type: "chat.message", cardId: "a", item: { kind: "error", id: "e", at: "", message: "Failed.", actions: [] } }),
      );
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("is empty and quiet outside a provider", () => {
    render(<Probe />);
    expect(screen.getByText("count 0")).toBeTruthy();
  });

  it("reload() refetches, and does nothing outside a provider", async () => {
    const spy = vi.spyOn(api, "forYou").mockResolvedValue({ items: [] });
    function Reloader() {
      const { reload } = useForYou();
      return <button onClick={reload}>again</button>;
    }
    const { unmount } = render(
      <ForYouProvider>
        <Reloader />
      </ForYouProvider>,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    act(() => screen.getByRole("button", { name: "again" }).click());
    expect(spy).toHaveBeenCalledTimes(2);
    unmount();
    render(<Reloader />);
    act(() => screen.getByRole("button", { name: "again" }).click());
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("Header For you link", () => {
  it("shows the count in the name, and hides the pill at zero", async () => {
    const spy = vi.spyOn(api, "forYou").mockResolvedValue({ items: [item("a"), item("b")] });
    const { unmount } = render(
      <MemoryRouter>
        <ForYouProvider>
          <Header />
        </ForYouProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("link", { name: "For you, 2 waiting" })).toBeTruthy();
    unmount();
    spy.mockResolvedValue({ items: [] });
    render(
      <MemoryRouter>
        <ForYouProvider>
          <Header />
        </ForYouProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("link", { name: "For you" })).toBeTruthy();
  });
});
