/**
 * The spec's `## Outcome` section: the lines after that heading up to the next `## ` heading, trimmed. Null when
 * the spec has no such section, or no text.
 */
export function outcomeSection(text: string | null): string | null {
  if (!text) return null;
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^##[ \t]+Outcome[ \t]*$/.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##[ \t]/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join("\n").trim();
  return body === "" ? null : body;
}
