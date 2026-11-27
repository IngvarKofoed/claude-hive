// @vitest-environment node
// The styling rules from docs/ARCHITECTURE.md (Frontend), checked over the whole tree so that no session has to
// remember to search its diff: nothing is styled inline, and no raw color, pixel font size or font name appears
// outside tokens.css. Files are read through Vite's glob, since this package's TypeScript has no Node types.
import { describe, expect, it } from "vitest";

const read = (files: Record<string, string>) => Object.entries(files);

const cssFiles = read(
  import.meta.glob<string>(["../**/*.css", "!./tokens.css"], { query: "?raw", import: "default", eager: true }),
);
const componentFiles = read(
  import.meta.glob<string>(["../**/*.tsx", "!../**/*.test.tsx"], { query: "?raw", import: "default", eager: true }),
);
const tokens = import.meta.glob<string>("./tokens.css", { query: "?raw", import: "default", eager: true })["./tokens.css"];

/** Every `property: value` declaration in a stylesheet. Selectors such as `a:hover {` are not declarations. */
function declarations(source: string): [string, string][] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)(?=[;}])/g)].map((m) => [m[1]!, m[2]!.trim()]);
}

/** The raw values in a stylesheet that belong in tokens.css, as `property: value`. */
export function rawValues(source: string): string[] {
  return declarations(source)
    .filter(([property, value]) => {
      if (/#[0-9a-f]{3,8}\b/i.test(value)) return true;
      if (/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i.test(value)) return true;
      if ((property === "font-size" || property === "font") && /\d(?:\.\d+)?px\b/.test(value)) return true;
      if (property === "font-family" && !/^(?:var\(|inherit$|initial$|unset$|revert$)/.test(value)) return true;
      return false;
    })
    .map(([property, value]) => `${property}: ${value}`);
}

/** Inline styles in a component: a `style` prop or a style object. */
export function inlineStyles(source: string): string[] {
  return [...source.matchAll(/\sstyle=\{|\bCSSProperties\b/g)].map((m) => m[0].trim());
}

describe("styling rules", () => {
  it("finds what it is meant to find", () => {
    expect(rawValues(".a { color: #fff; } .b:hover { background: rgb(0 0 0); }")).toEqual([
      "color: #fff",
      "background: rgb(0 0 0)",
    ]);
    expect(rawValues(".a { font-size: 13px; font-family: Inter, sans-serif; }")).toHaveLength(2);
    expect(rawValues(".a:hover { color: var(--color-text); font-family: var(--font-ui); }")).toEqual([]);
    expect(rawValues(".a { font-family: inherit; }")).toEqual([]);
    expect(inlineStyles('<div style={{ color: "red" }} />')).toEqual(["style={"]);
    expect(inlineStyles("<div className={styles.box} />")).toEqual([]);
  });

  it("reads the stylesheets as text", () => {
    expect(tokens).toContain("--color-");
    expect(cssFiles.length).toBeGreaterThan(0);
    expect(componentFiles.length).toBeGreaterThan(0);
  });

  it("keeps raw values in tokens.css", () => {
    const found = cssFiles.flatMap(([file, source]) => rawValues(source).map((value) => `${file}: ${value}`));
    expect(found).toEqual([]);
  });

  it("styles nothing inline", () => {
    const found = componentFiles.flatMap(([file, source]) => inlineStyles(source).map((hit) => `${file}: ${hit}`));
    expect(found).toEqual([]);
  });
});
