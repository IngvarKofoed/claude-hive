/**
 * The first sentence of a text, cut to 60 characters. The startup backfill of `idea_title` uses it, and so does a new
 * project chat, which is titled from its first message.
 */
export function titleFromIdea(text: string): string {
  const first = text.trim().split(/(?<=[.!?])\s|\n/)[0]!.trim();
  return first.length > 60 ? `${first.slice(0, 59).trimEnd()}…` : first;
}
