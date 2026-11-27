import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IdeaView } from "./IdeaView";

describe("IdeaView", () => {
  it("shows the title as a heading and the text with its line breaks", () => {
    render(<IdeaView title="Bigger font" text={"Line one.\nLine two."} />);
    expect(screen.getByRole("heading", { name: "Bigger font" })).toBeInTheDocument();
    expect(screen.getByText(/Line one\./).textContent).toBe("Line one.\nLine two.");
  });
});
