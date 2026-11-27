import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "@hive/shared";
import { AddIdea } from "./AddIdea";
import { NewIdeaProvider, useNewIdea } from "./newIdeaContext";

afterEach(() => vi.restoreAllMocks());

const project = { id: "p1", name: "flux", path: "/r/p1", trustWarning: false } as ProjectSummary;

/** Shows what the form was opened with. */
function Probe() {
  const { open, preset } = useNewIdea();
  return <output>{open ? `open ${preset.projectId ?? "-"} [${preset.title ?? "-"}]` : "closed"}</output>;
}

function renderField() {
  render(
    <NewIdeaProvider>
      <AddIdea project={project} />
      <Probe />
    </NewIdeaProvider>,
  );
}

describe("AddIdea", () => {
  it("opens New idea with the project and what was typed as the title, and empties the field", async () => {
    renderField();
    const field = screen.getByPlaceholderText("Add an idea");
    await userEvent.type(field, "  Bigger font {Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("open p1 [Bigger font]");
    expect(field).toHaveValue("");
  });

  it("opens it with just the project when nothing was typed", async () => {
    renderField();
    await userEvent.type(screen.getByPlaceholderText("Add an idea"), "{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("open p1 []");
  });
});
