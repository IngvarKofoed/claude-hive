import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SchemaFields } from "./SchemaFields";

describe("SchemaFields", () => {
  it("shows each type in words, with descriptions, ignoring other keywords", () => {
    const { container } = render(
      <SchemaFields
        schema={{
          $schema: "x",
          additionalProperties: false,
          properties: {
            a: { type: "string", description: "The a." },
            b: { type: "number" },
            c: { type: "integer" },
            d: { type: "boolean" },
            e: { type: ["string", "null"] },
            f: { type: "string", enum: ["done", "blocked"] },
            g: { type: "array", items: { type: "string" } },
            h: {},
            i: { type: "weird" },
          },
        }}
      />,
    );
    const text = container.textContent ?? "";
    for (const word of [
      "a text",
      "b number",
      "c whole number",
      "d yes/no",
      "e text or null",
      "f one of done, blocked",
      "g list of text",
      "h any",
      "i weird",
    ]) {
      expect(text).toContain(word);
    }
    expect(screen.getByText("The a.")).toBeTruthy();
  });

  it("nests objects, and the fields of a list's items", () => {
    render(
      <SchemaFields
        schema={{
          properties: {
            steps: {
              type: "array",
              items: { type: "object", properties: { title: { type: "string" }, files: { type: "array", items: { type: "string" } } } },
            },
            where: { type: "object", properties: { path: { type: "string" } } },
          },
        }}
      />,
    );
    const steps = screen.getByText("steps").closest("li")!;
    expect(steps.textContent).toContain("list of");
    expect(within(steps).getByText("title")).toBeTruthy();
    expect(within(steps).getByText("list of text")).toBeTruthy();
    expect(within(screen.getByText("where").closest("li")!).getByText("path")).toBeTruthy();
  });

  it("renders nothing for a schema without properties", () => {
    const { container } = render(<SchemaFields schema={{ type: "object" }} />);
    expect(container.innerHTML).toBe("");
  });
});
