import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDEA_DRAFTING, type HiveEvent, type ProjectChatDetail, type ProjectChatSummary } from "@hive/shared";

const listeners = new Set<(event: HiveEvent) => void>();
vi.mock("../api/events", () => ({
  subscribe: (l: (event: HiveEvent) => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  onStreamOpen: () => () => {},
  useHiveEvents: () => {},
  useStreamOpen: () => {},
}));

import { api } from "../api/client";
import { ProjectChat } from "./ProjectChat";

const summary = (id: string, title: string, state: ProjectChatSummary["state"] = "idle"): ProjectChatSummary => ({
  id,
  projectId: "p1",
  title,
  state,
  updatedAt: new Date().toISOString(),
});

const detail = (over: Partial<ProjectChatDetail> = {}): ProjectChatDetail => ({
  ...summary("c1", "How does the market work"),
  projectName: "flux",
  chat: [
    { kind: "message", id: "m1", at: "t", from: "you", text: "How does the market work?" },
    { kind: "message", id: "m2", at: "t", from: "project-chat", text: "It matches orders." },
  ],
  pending: null,
  turnRunning: false,
  draft: null,
  ...over,
});

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:projectId/chat" element={<ProjectChat />} />
        <Route path="/projects/:projectId/chat/:chatId" element={<ProjectChat />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const open = (over?: Partial<ProjectChatDetail>) => {
  vi.spyOn(api, "projectChat").mockResolvedValue(detail(over));
  return renderAt("/projects/p1/chat/c1");
};

beforeEach(() => {
  listeners.clear();
  vi.spyOn(api, "board").mockResolvedValue({ projects: [], cards: [], chats: [] });
  vi.spyOn(api, "projectChats").mockResolvedValue({
    projectName: "flux",
    chats: [summary("c1", "How does the market work"), summary("c2", "Why is the sync slow", "asking")],
  });
});
afterEach(() => vi.restoreAllMocks());

describe("ProjectChat page", () => {
  it("lists the chats with the project's name, and ● on the one that asks", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "flux" })).toBeInTheDocument();
    const asking = (await screen.findByText("Why is the sync slow")).closest("li")!;
    expect(within(asking).getByLabelText("A question waits")).toBeInTheDocument();
    const idle = screen.getByText("How does the market work", { selector: "li *" }).closest("li")!;
    expect(within(idle).queryByLabelText("A question waits")).toBeNull();
    // New chat sits on the "Chats" title line, after the title.
    const heading = screen.getByRole("heading", { name: "Chats" });
    const newChat = screen.getByRole("button", { name: "New chat" });
    expect(newChat.parentElement).toBe(heading.parentElement);
    expect([...heading.parentElement!.children]).toEqual([heading, newChat]);
    expect(heading.compareDocumentPosition(newChat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("makes a new chat from its first Send and goes to its URL", async () => {
    const make = vi.spyOn(api, "newProjectChat").mockResolvedValue(summary("c9", "Where is auth"));
    renderAt("/projects/p1/chat");
    expect(await screen.findByText("Ask about the project's code, docs or history.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Your message"), "Where is auth?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(make).toHaveBeenCalledWith("p1", { text: "Where is auth?" });
    expect(screen.getByTestId("where")).toHaveTextContent("/projects/p1/chat/c9");
  });

  it("sends Enter in an open chat, and shows Stop while a turn runs", async () => {
    const sendMessage = vi.spyOn(api, "sendChatMessage").mockResolvedValue(undefined);
    const stop = vi.spyOn(api, "stopChat").mockResolvedValue(undefined);
    open({ turnRunning: true, state: "working" });
    await userEvent.type(await screen.findByLabelText("Your message"), "and prices?{Enter}");
    expect(sendMessage).toHaveBeenCalledWith("c1", { text: "and prices?" });
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stop).toHaveBeenCalledWith("c1");
  });

  it("greys Make it an idea with the reason for each state", async () => {
    const { unmount } = renderAt("/projects/p1/chat");
    expect(await screen.findByRole("button", { name: "Make it an idea" })).toHaveAttribute("title", "Say something first");
    unmount();

    const cases: [Partial<ProjectChatDetail>, string][] = [
      [{ chat: [{ kind: "message", id: "m1", at: "t", from: "you", text: "hi" }] }, "Say something first"],
      [{ turnRunning: true }, "Wait for Claude to finish"],
      [{ pending: { id: "q1", kind: "question", questions: [] } }, "Answer the question first"],
      [{ draft: { status: "ready", title: "T", text: "X", reason: "" } }, "Add or cancel the idea first"],
    ];
    for (const [over, reason] of cases) {
      vi.spyOn(api, "projectChat").mockResolvedValue(detail(over));
      const view = renderAt("/projects/p1/chat/c1");
      const button = await screen.findByRole("button", { name: "Make it an idea" });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", reason);
      view.unmount();
    }
  });

  it("starts the draft turn when Make it an idea is on", async () => {
    const draft = vi.spyOn(api, "draftIdea").mockResolvedValue(undefined);
    open();
    const button = await screen.findByRole("button", { name: "Make it an idea" });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(draft).toHaveBeenCalledWith("c1");
  });

  it("closes the reply box while drafting, with the hint, and disables the fields", async () => {
    open({ draft: { status: "drafting", title: "", text: "", reason: "" }, turnRunning: true, state: "working" });
    expect(await screen.findByText(IDEA_DRAFTING)).toBeInTheDocument();
    // The draft turn is quiet: no thinking line in the log.
    expect(screen.queryByText(/thinking/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Your message")).toBeDisabled();
    expect(screen.getByText("Drafting…")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByLabelText("Idea")).toBeDisabled();
  });

  it("fills the form from a ready draft, and Add sends the chat's id", async () => {
    const add = vi.spyOn(api, "newCard").mockResolvedValue(undefined);
    open({ draft: { status: "ready", title: "Per-printer font", text: "Make the font adjustable.", reason: "" } });
    const title = await screen.findByLabelText("Title");
    expect(title).toHaveValue("Per-printer font");
    expect(screen.getByLabelText("Idea")).toHaveValue("Make the font adjustable.");
    await userEvent.clear(title);
    await userEvent.type(title, "Font size per printer");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(add).toHaveBeenCalledWith({
      projectId: "p1",
      title: "Font size per printer",
      text: "Make the font adjustable.",
      chatId: "c1",
    });
  });

  it("shows a failed draft's reason above empty fields, and Cancel closes the form", async () => {
    const close = vi.spyOn(api, "closeDraft").mockResolvedValue(undefined);
    open({ draft: { status: "failed", title: "", text: "", reason: "The chat holds no idea yet." } });
    expect(await screen.findByText("The chat holds no idea yet.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Idea")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledWith("c1");
  });

  it("shows the project's name as the page's title, with no breadcrumb band", async () => {
    open();
    const title = await screen.findByRole("heading", { level: 1, name: "flux" });
    const main = screen.getByRole("main");
    expect(main).toContainElement(title);
    expect(within(main).queryByText("Project chat")).toBeNull();
    expect(within(main).queryByRole("link", { name: "Board" })).toBeNull();
    expect(screen.queryByText("Ideas from this chat")).toBeNull();
  });

  it("links a note to its card, and a note without a card has no link", async () => {
    open({
      chat: [
        { kind: "message", id: "m1", at: "t", from: "hive", text: "Made an idea: Font size", cardId: "k1" },
        { kind: "message", id: "m2", at: "t", from: "hive", text: "Made an idea: Old one" },
      ],
    });
    const link = await screen.findByRole("link", { name: "Made an idea: Font size" });
    expect(link).toHaveAttribute("href", "/cards/k1");
    expect(screen.getByText("Made an idea: Old one", { selector: "p *, p" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Made an idea: Old one" })).toBeNull();
  });

  it("puts the draft form between the log and the reply box", async () => {
    open({ draft: { status: "ready", title: "T", text: "X", reason: "" } });
    const title = await screen.findByLabelText("Title");
    const log = screen.getByRole("log");
    const reply = screen.getByLabelText("Your message");
    expect(log.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("gives each chat's title its full text for hover, with Delete in the same row", async () => {
    open();
    const title = await screen.findByText("Why is the sync slow");
    expect(title).toHaveAttribute("title", "Why is the sync slow");
    const row = title.closest("li")!;
    expect(within(row).getByRole("button", { name: "Delete Why is the sync slow" })).toBeInTheDocument();
    expect(title.closest("a")).not.toBeNull();
    expect(within(row).getByRole("button", { name: "Delete Why is the sync slow" }).closest("a")).toBeNull();
  });

  it("asks inline before deleting, and deleting the open chat goes to a new chat", async () => {
    const remove = vi.spyOn(api, "deleteChat").mockResolvedValue(undefined);
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Delete How does the market work" }));
    expect(screen.getByText("Delete this chat? Ideas made from it keep their copy.")).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("group", { name: "Delete this chat" })).getByRole("button", { name: "Delete" }));
    expect(remove).toHaveBeenCalledWith("c1");
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/projects\/p1\/chat$/);
  });

  it("goes to a new chat when the open one is deleted elsewhere", async () => {
    open();
    await screen.findByLabelText("Your message");
    act(() => listeners.forEach((l) => l({ type: "projectChat.deleted", chatId: "c1" })));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/projects\/p1\/chat$/);
  });

  it("sends a question's answer to the chat's own endpoint", async () => {
    const answer = vi.spyOn(api, "answerChat").mockResolvedValue(undefined);
    open({
      pending: {
        id: "q1",
        kind: "question",
        questions: [{ question: "Which?", header: "H", multiSelect: false, options: [{ label: "A", description: "" }] }],
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: "A" }));
    await userEvent.click(within(screen.getByRole("log")).getByRole("button", { name: "Send" }));
    expect(answer).toHaveBeenCalledWith("c1", { itemId: "q1", answers: { "Which?": "A" } });
  });
});
