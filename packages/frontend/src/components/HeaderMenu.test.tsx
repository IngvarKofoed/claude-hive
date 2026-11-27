import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { HeaderMenu } from "./HeaderMenu";

const show = (path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <HeaderMenu />
      <button>outside</button>
    </MemoryRouter>,
  );

describe("HeaderMenu", () => {
  it("opens to one link and reports it through aria-expanded", async () => {
    show();
    const button = screen.getByRole("button", { name: "More" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link")).toBeNull();
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const link = screen.getByRole("link", { name: /Role prompts/ });
    expect(link).toHaveAttribute("href", "/roles");
    expect(link.textContent).toContain("What each lane's sessions are told");
  });

  it("closes on Escape, with focus back on the button", async () => {
    show();
    const button = screen.getByRole("button", { name: "More" });
    await userEvent.click(button);
    screen.getByRole("link").focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("link")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("closes on a click outside, and on choosing the link", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("link")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("link"));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("looks current on /roles and /roles/*, and not elsewhere", () => {
    const { unmount } = show("/roles/developer");
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute("data-current", "true");
    unmount();
    show("/for-you");
    expect(screen.getByRole("button", { name: "More" })).not.toHaveAttribute("data-current");
  });
});
