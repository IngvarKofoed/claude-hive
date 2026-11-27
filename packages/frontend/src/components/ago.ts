/** How long ago an ISO time was, as "just now", "5 min ago", "2 h ago" or "3 d ago". */
export function ago(sinceIso: string, nowMs: number): string {
  const since = Date.parse(sinceIso);
  if (Number.isNaN(since)) return "";
  const minutes = Math.floor(Math.max(0, nowMs - since) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
