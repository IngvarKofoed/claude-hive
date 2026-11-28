/** The spec's chapters shown open above the full spec (docs/changelog/2026-11-28-spec-outcome-and-key-decisions.md). */
export const OPEN_CHAPTERS = ["Outcome", "Key decisions"];

/**
 * The named `##` chapters of a spec's Markdown, each with its own heading, in the order the spec has them. A chapter
 * runs to the next `#` or `##` heading. Names match without regard to case, and a `#` inside a fenced code block
 * isn't a heading.
 */
export function specChapters(text: string, names: string[] = OPEN_CHAPTERS): string[] {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const chapters: string[] = [];
  let current: string[] | null = null;
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (fence !== null) {
      // A closing fence carries no info string: "```ts" inside a ``` block is code.
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
    } else {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (open) fence = open;
      // An empty "##" is a heading too, and ends a chapter.
      const heading = open ? null : /^ {0,3}(#{1,2})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
      if (heading) {
        if (current) chapters.push(current.join("\n").trim());
        current = heading[1] === "##" && wanted.has((heading[2] ?? "").toLowerCase()) ? [line] : null;
        continue;
      }
    }
    current?.push(line);
  }
  if (current) chapters.push(current.join("\n").trim());
  return chapters;
}
