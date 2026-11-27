import { describe, expect, it } from "vitest";
import { ago } from "./ago";

const now = Date.parse("2026-11-27T12:00:00Z");
const before = (ms: number) => new Date(now - ms).toISOString();

describe("ago", () => {
  it("says just now under a minute", () => expect(ago(before(30_000), now)).toBe("just now"));
  it("counts minutes", () => expect(ago(before(5 * 60_000), now)).toBe("5 min ago"));
  it("counts hours", () => expect(ago(before(2 * 3_600_000 + 5000), now)).toBe("2 h ago"));
  it("counts days", () => expect(ago(before(3 * 86_400_000), now)).toBe("3 d ago"));
  it("treats a future time as just now", () => expect(ago(before(-5000), now)).toBe("just now"));
});
