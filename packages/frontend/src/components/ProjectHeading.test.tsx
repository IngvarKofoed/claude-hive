import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProjectChatSummary, ProjectSummary } from "@hive/shared";
import { ProjectHeading } from "./ProjectHeading";

const project: ProjectSummary = { id: "p1", name: "flux", path: "~/work/flux", trustWarning: false };
const chat = (id: string, state: ProjectChatSummary["state"]): ProjectChatSummary => ({
  id,
  projectId: "p1",
  title: id,
  state,
  updatedAt: "t",
});

function renderHeading(chats: ProjectChatSummary[]) {
  const onChat = vi.fn();
  render(<ProjectHeading project={project} onBoard={() => {}} chats={chats} onChat={onChat} />);
  return onChat;
}

describe("ProjectHeading's Chat button", () => {
  it("opens a new chat when none asks, with no ●", async () => {
    const onChat = renderHeading([chat("c1", "idle"), chat("c2", "working")]);
    const button = screen.getByRole("button", { name: "Chat" });
    expect(button).not.toHaveTextContent("●");
    await userEvent.click(button);
    expect(onChat).toHaveBeenCalledWith("/projects/p1/chat");
  });

  it("opens the chat that asks, with ● and 'Chat, a question waits'", async () => {
    const onChat = renderHeading([chat("c1", "idle"), chat("c2", "asking")]);
    const button = screen.getByRole("button", { name: "Chat, a question waits" });
    expect(button).toHaveAttribute("title", "Chat, a question waits");
    expect(button).toHaveTextContent("●");
    await userEvent.click(button);
    expect(onChat).toHaveBeenCalledWith("/projects/p1/chat/c2");
  });
});
