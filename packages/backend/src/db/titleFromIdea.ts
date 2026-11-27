/** The idea's first sentence, cut to 60 characters. Only the startup backfill of `idea_title` uses it. */
export function titleFromIdea(text: string): string {
  const first = text.trim().split(/(?<=[.!?])\s|\n/)[0]!.trim();
  return first.length > 60 ? `${first.slice(0, 59).trimEnd()}…` : first;
}
