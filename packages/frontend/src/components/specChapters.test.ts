import { describe, expect, it } from "vitest";
import { specChapters } from "./specChapters";

const spec = [
  "# Bigger font",
  "",
  "Intro.",
  "",
  "## Outcome",
  "",
  "**What you get:**",
  "",
  "- A size per printer.",
  "",
  "```md",
  "## Key decisions",
  "not a heading: it's inside a fence",
  "```",
  "",
  "## Key Decisions",
  "",
  "- **Per printer** (new).",
  "",
  "### A subsection stays in",
  "",
  "## Goals",
  "",
  "- Readable labels.",
].join("\n");

describe("specChapters", () => {
  it("takes Outcome and Key decisions with their headings, up to the next chapter, in the spec's order", () => {
    expect(specChapters(spec)).toEqual([
      "## Outcome\n\n**What you get:**\n\n- A size per printer.\n\n```md\n## Key decisions\nnot a heading: it's inside a fence\n```",
      "## Key Decisions\n\n- **Per printer** (new).\n\n### A subsection stays in",
    ]);
  });

  it("ends a chapter at the spec's title too, and finds nothing in a spec without them", () => {
    expect(specChapters("## Outcome\n\n- Done.\n# Appendix\n\nMore.")).toEqual(["## Outcome\n\n- Done."]);
    expect(specChapters("# Title\n\n## Goals\n\n- One.")).toEqual([]);
    expect(specChapters("")).toEqual([]);
  });

  it("reads a chapter that runs to the end of the file", () => {
    expect(specChapters("## Goals\n\n- One.\n\n## Outcome\n\n- Last.\n")).toEqual(["## Outcome\n\n- Last."]);
  });

  it("reads a spec with Windows line endings", () => {
    expect(specChapters("# T\r\n\r\n## Outcome\r\n\r\n- A.\r\n\r\n## Goals\r\n- B.\r\n")).toEqual(["## Outcome\n\n- A."]);
  });

  it("keeps a fence open past a line with an info string, and ends a chapter at an empty heading", () => {
    expect(specChapters("## Outcome\n```\n```ts\n## Goals\n```\n## Goals\n- B.")).toEqual([
      "## Outcome\n```\n```ts\n## Goals\n```",
    ]);
    expect(specChapters("## Outcome\n- A.\n##\n- B.")).toEqual(["## Outcome\n- A."]);
  });
});
