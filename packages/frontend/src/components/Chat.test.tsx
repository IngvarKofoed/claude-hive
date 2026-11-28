import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardDetail } from "@hive/shared";
import { api } from "../api/client";
import { Chat, PastChat, isAtBottom } from "./Chat";

const base: CardDetail = {
  id: "c1",
  projectId: "p1",
  projectName: "m",
  title: "T",
  ideaTitle: "i",
  ideaText: "i",
  lane: "refine",
  state: "needs-you",
  moveError: null,
  branch: null,
  worktreePath: null,
  brief: null,
  spec: null,
  specPath: null,
  plan: null,
  build: null,
  check: null,
  setup: null,
  port: null,
  feedback: null,
  shipAfterCheck: false,
  checklist: null,
  apps: [],
  appStopped: false,
  issues: [],
  decisions: [],
  chat: [],
  pastChats: {},
  history: { plans: [], builds: [], checks: [], tryit: [] },
  pending: null,
  turnRunning: false,
  landed: null,
  landing: false,
};
const message = (id: string) => ({ kind: "message", id, at: "t", from: "product-owner", text: `msg ${id}` }) as const;
const withChat = (...ids: string[]): CardDetail => ({ ...base, chat: ids.map(message) });

afterEach(() => vi.restoreAllMocks());

/** jsdom has no layout: give the log a scroll box to follow. */
function boxOf(log: HTMLElement, box: { scrollHeight: number; scrollTop: number; clientHeight: number }) {
  for (const key of ["scrollHeight", "clientHeight"] as const) {
    Object.defineProperty(log, key, { configurable: true, get: () => box[key] });
  }
  Object.defineProperty(log, "scrollTop", {
    configurable: true,
    get: () => box.scrollTop,
    set: (v: number) => {
      box.scrollTop = v;
    },
  });
}

const newMessages = () => screen.queryByRole("button", { name: /New messages/ });

describe("isAtBottom", () => {
  it("counts a few pixels short as the bottom", () => {
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 595, clientHeight: 400 })).toBe(true);
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 })).toBe(false);
  });
});

describe("Chat framing", () => {
  it("marks only a framed chat", () => {
    const { container, rerender } = render(<Chat detail={base} streaming="" activity={null} framed />);
    expect(container.firstElementChild).toHaveAttribute("data-framed");
    rerender(<Chat detail={base} streaming="" activity={null} />);
    expect(container.firstElementChild).not.toHaveAttribute("data-framed");
  });

  it("leaves a look-back chat unframed", () => {
    const { container } = render(<PastChat items={[message("a")]} />);
    expect(container.querySelector("[data-framed]")).toBeNull();
  });

  it("puts the node for the end of the Send row inside it", () => {
    render(<Chat detail={base} streaming="" activity={null} framed sendRowEnd={<button>Good</button>} />);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send.parentElement).toContainElement(screen.getByRole("button", { name: "Good" }));
  });
});

describe("Chat following", () => {
  it("follows from the bottom, and shows New messages when scrolled up", () => {
    const { rerender } = render(<Chat detail={withChat("a")} streaming="" activity={null} framed />);
    const log = screen.getByRole("log");
    const box = { scrollHeight: 1000, scrollTop: 600, clientHeight: 400 };
    boxOf(log, box);

    // At the bottom: new text moves the log to its end.
    box.scrollHeight = 1200;
    rerender(<Chat detail={withChat("a")} streaming="more" activity={null} framed />);
    expect(box.scrollTop).toBe(1200);
    expect(newMessages()).toBeNull();

    // Scrolled up: nothing moves, and the button appears.
    box.scrollTop = 100;
    fireEvent.scroll(log);
    box.scrollHeight = 1400;
    rerender(<Chat detail={withChat("a")} streaming="more text" activity={null} framed />);
    expect(box.scrollTop).toBe(100);
    expect(newMessages()).toBeInTheDocument();

    // Clicking it goes to the bottom and hides it.
    fireEvent.click(newMessages()!);
    expect(box.scrollTop).toBe(1400);
    expect(newMessages()).toBeNull();
  });

  it("doesn't show the button for the activity line or for streamed text clearing", () => {
    const { rerender } = render(<Chat detail={withChat("a")} streaming="text" activity={null} framed />);
    const log = screen.getByRole("log");
    boxOf(log, { scrollHeight: 1000, scrollTop: 0, clientHeight: 400 });
    fireEvent.scroll(log);
    rerender(<Chat detail={withChat("a")} streaming="text" activity="Reading" framed />);
    expect(newMessages()).toBeNull();
    rerender(<Chat detail={withChat("a")} streaming="" activity="Reading" framed />);
    expect(newMessages()).toBeNull();
  });

  it("hides the button when you scroll down to the bottom yourself", () => {
    const { rerender } = render(<Chat detail={withChat("a")} streaming="" activity={null} framed />);
    const log = screen.getByRole("log");
    const box = { scrollHeight: 1000, scrollTop: 0, clientHeight: 400 };
    boxOf(log, box);
    fireEvent.scroll(log);
    rerender(<Chat detail={withChat("a", "b")} streaming="" activity={null} framed />);
    expect(newMessages()).toBeInTheDocument();
    box.scrollTop = 600;
    fireEvent.scroll(log);
    expect(newMessages()).toBeNull();
  });

  it("stays at the bottom when the log's box shrinks, but not when scrolled up", () => {
    let resized: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      render(<Chat detail={withChat("a")} streaming="" activity={null} framed />);
      const log = screen.getByRole("log");
      const box = { scrollHeight: 1000, scrollTop: 600, clientHeight: 400 };
      boxOf(log, box);

      // The footer grows (Stop, a hint, an error line): the log gets shorter with no scroll event.
      box.clientHeight = 360;
      act(() => resized());
      expect(box.scrollTop).toBe(1000);

      box.scrollTop = 100;
      fireEvent.scroll(log);
      box.clientHeight = 320;
      act(() => resized());
      expect(box.scrollTop).toBe(100);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("goes to the bottom when you send", async () => {
    vi.spyOn(api, "sendMessage").mockResolvedValue(undefined as never);
    render(<Chat detail={withChat("a")} streaming="" activity={null} framed />);
    const log = screen.getByRole("log");
    const box = { scrollHeight: 1000, scrollTop: 0, clientHeight: 400 };
    boxOf(log, box);
    fireEvent.scroll(log);
    fireEvent.change(screen.getByLabelText("Your reply"), { target: { value: "hello" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(box.scrollTop).toBe(1000);
  });
});
