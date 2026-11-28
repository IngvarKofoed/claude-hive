import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
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
import { cameFromForYou } from "../components/fromForYou";
import { ForYou } from "./ForYou";

const base = (id: string, kind: ForYouItem["kind"], lane: ForYouItem["card"]["lane"], text: string): ForYouItem => ({
  card: { id, projectId: "p", title: `Title ${id}`, lane, state: "needs-you", moveError: null },
  projectName: "flux",
  since: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  kind,
  text,
  pending: null,
  actions: [],
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

  it("opens the card from an entry's link with the state that says it came from For you", async () => {
    vi.spyOn(api, "forYou").mockResolvedValue({
      items: [
        base("a", "try-it", "tryit", "Test it by hand"),
        base("b", "sign-off", "spec", "Sign the spec off"),
        base("c", "stuck", "build", "It stopped"),
      ],
    });
    function CardProbe() {
      const location = useLocation();
      return (
        <p>
          at {location.pathname} from for you: {String(cameFromForYou(location.state))}
        </p>
      );
    }
    for (const [name, id] of [
      ["Try it", "a"],
      ["Open the chat", "b"],
      ["Open the card", "c"],
    ] as const) {
      const { unmount } = render(
        <MemoryRouter initialEntries={["/for-you"]}>
          <ForYouProvider>
            <Routes>
              <Route path="/for-you" element={<ForYou />} />
              <Route path="/cards/:id" element={<CardProbe />} />
            </Routes>
          </ForYouProvider>
        </MemoryRouter>,
      );
      fireEvent.click(await screen.findByRole("link", { name }));
      expect(await screen.findByText(`at /cards/${id} from for you: true`)).toBeTruthy();
      unmount();
    }
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

  it("renders actions before a secondary link, greys a disabled one with its reason, and none on question or Try it", async () => {
    const spec = base("s", "sign-off", "spec", "Sign the spec off");
    spec.actions = [
      { id: "review", label: "Review", primary: true, enabled: true, reason: null },
      { id: "signoff", label: "Sign off", primary: false, enabled: false, reason: "Run the review first" },
    ];
    const q = base("q", "question", "build", "Which?");
    q.pending = {
      id: "i1",
      kind: "question",
      questions: [{ question: "Up or down?", header: "Size", multiSelect: false, options: [{ label: "Up", description: "" }] }],
    };
    vi.spyOn(api, "forYou").mockResolvedValue({ items: [spec, q, base("t", "try-it", "tryit", "Try")] });
    show();
    expect(await screen.findByText("Sign the spec off")).toBeTruthy();
    const review = screen.getByRole("button", { name: "Review" });
    const link = screen.getByRole("link", { name: "Open the chat" });
    expect(review.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.hasAttribute("data-secondary")).toBe(true);
    expect(review.getAttribute("data-variant")).toBe("primary");
    const signoff = screen.getByRole("button", { name: "Sign off" }) as HTMLButtonElement;
    expect(signoff.disabled).toBe(true);
    expect(signoff.title).toBe("Run the review first");
    expect(screen.getByText("Sign off: Run the review first")).toBeTruthy();
    // The question entry has only its form's buttons, and the Try it entry none.
    expect(Array.from(document.querySelectorAll("article button")).map((b) => b.textContent)).toEqual(["Review", "Sign off", "Up", "Send"]);
  });

  it("presses an action: disables the entry's buttons while it runs, reloads, and drops the entry", async () => {
    const spec = base("s", "your-turn", "refine", "Say Good");
    spec.actions = [
      { id: "good", label: "Good · on to Mockup", primary: true, enabled: true, reason: null },
      { id: "back-to-spec", label: "Back to Spec", primary: false, enabled: true, reason: null },
    ];
    const forYou = vi.spyOn(api, "forYou").mockResolvedValue({ items: [spec] });
    let finish!: () => void;
    const good = vi.spyOn(api, "good").mockImplementation(() => new Promise((r) => (finish = () => r({} as never))));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Good · on to Mockup" }));
    expect(good).toHaveBeenCalledWith("s", { skipMockup: false });
    expect((screen.getByRole("button", { name: "Good · on to Mockup" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Back to Spec" }) as HTMLButtonElement).disabled).toBe(true);
    forYou.mockResolvedValue({ items: [] });
    finish();
    await waitFor(() => expect(forYou).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Nothing is waiting for you. Everything is running on its own.")).toBeTruthy();
  });

  it("calls the matching api for Back to Spec, and shows a refusal in the entry", async () => {
    const spec = base("s", "stuck", "plan", "Blocked");
    spec.actions = [{ id: "back-to-spec", label: "Back to Spec", primary: false, enabled: true, reason: null }];
    vi.spyOn(api, "forYou").mockResolvedValue({ items: [spec] });
    const back = vi.spyOn(api, "backToSpec").mockRejectedValue(new Error("The card moved on."));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Back to Spec" }));
    expect(back).toHaveBeenCalledWith("s");
    expect(await screen.findByText("The card moved on.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Back to Spec" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the empty state", async () => {
    vi.spyOn(api, "forYou").mockResolvedValue({ items: [] });
    show();
    expect(await screen.findByText("Nothing is waiting for you. Everything is running on its own.")).toBeTruthy();
  });
});
