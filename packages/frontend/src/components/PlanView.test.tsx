import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Plan } from "@hive/shared";
import { PlanView } from "./PlanView";

const plan: Plan = {
  steps: [
    { title: "Add the column", detail: "Migrate the table", chunk: "backend", check: "the migration test" },
    { title: "Show it", detail: "", chunk: "frontend", check: "the page test" },
  ],
  chunks: [
    { name: "backend", owns: ["src/db/schema.ts", "src/db/queries.ts"], model: "opus" },
    { name: "frontend", owns: ["src/pages/*"], model: "sonnet" },
  ],
  tests: ["schema migrates", "page shows the font size"],
};

describe("PlanView", () => {
  it("shows numbered steps with chunk chips and how each is checked", () => {
    render(<PlanView plan={plan} />);
    const steps = screen.getAllByRole("listitem").filter((li) => li.textContent?.includes("Checked by"));
    expect(steps).toHaveLength(2);
    expect(steps[0]!).toHaveTextContent("Add the column");
    expect(steps[0]!).toHaveTextContent("backend");
    expect(screen.getByText("Checked by: the migration test")).toBeInTheDocument();
    expect(screen.getByText("Checked by: the page test")).toBeInTheDocument();
    expect(steps[0]!.closest("ol")).not.toBeNull();
  });

  it("shows each chunk's model and the files it owns, and the tests", () => {
    render(<PlanView plan={plan} />);
    expect(screen.getByText("opus")).toBeInTheDocument();
    expect(screen.getByText("sonnet")).toBeInTheDocument();
    expect(screen.getByText("src/db/schema.ts")).toBeInTheDocument();
    expect(screen.getByText("src/pages/*")).toBeInTheDocument();
    expect(screen.getByText("schema migrates")).toBeInTheDocument();
    expect(screen.getByText("page shows the font size")).toBeInTheDocument();
  });
});
