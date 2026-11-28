import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChecklistView } from "./ChecklistView";

describe("ChecklistView", () => {
  it("lists the items in order, each with its status for the CSS and for a screen reader", () => {
    render(
      <ChecklistView
        items={[
          { id: "1", text: "Read the plan", status: "completed" },
          { id: null, text: "Write the code", status: "in_progress" },
          { id: null, text: "Run the tests", status: "pending" },
        ]}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["completed", "in_progress", "pending"]);
    expect(rows[0]).toHaveTextContent("Done: Read the plan");
    expect(rows[1]).toHaveTextContent("In progress: Write the code");
    expect(rows[2]).toHaveTextContent("Waiting: Run the tests");
  });
});
