// The spec on disk (docs/specs/2026-11-26-spec-lane-review-gate.md, The spec on disk). The hive reads the file from
// the card's worktree and never trusts a session's account of it: Sign off compares the file's hash with the text
// the last finished review produced.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { dirname, join } from "node:path";
import type { ReviewState } from "@hive/shared";

export interface SpecFile {
  text: string | null;
  hash: string | null;
}

export function readSpec(worktree: string, specPath: string): SpecFile {
  try {
    const text = readFileSync(join(worktree, specPath), "utf8");
    return { text, hash: createHash("sha256").update(text).digest("hex") };
  } catch {
    return { text: null, hash: null };
  }
}

/** Where the spec stands with the review gate, from the card's fields and what is running right now. */
export function reviewState(input: {
  hash: string | null;
  reviewedSpecHash: string | null;
  /** An open amendment's text its spec writer vouched for when it skipped the review; null otherwise. */
  skippedHash?: string | null;
  reviewApplying: boolean;
  reviewerRunning: boolean;
  writerRunning: boolean;
}): ReviewState {
  if (input.reviewerRunning) return "running";
  if (input.reviewApplying) return input.writerRunning ? "applying" : "unfinished";
  if (input.reviewedSpecHash && input.hash === input.reviewedSpecHash) return "fresh";
  // docs/specs/2026-11-28-try-it-send-back.md: Sign off is open on the text a skipped review vouched for.
  if (input.skippedHash && input.hash === input.skippedHash) return "skipped";
  if (input.reviewedSpecHash) return "stale";
  return "none";
}

/** A spec path for the card: docs/specs/<date>-<title slug>.md, numbered if that file already exists. */
export function specPathFor(worktree: string, title: string, date: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "") || "spec";
  for (let n = 1; ; n++) {
    const path = join("docs", "specs", `${date}-${slug}${n === 1 ? "" : `-${n}`}.md`);
    if (!existsSync(join(worktree, path))) return path;
  }
}

/** Watches the spec's folder while a card is in Spec, so a hand edit greys Sign off at once. */
export class SpecWatch {
  private watchers = new Map<string, { watcher: FSWatcher; timer?: NodeJS.Timeout }>();

  watch(cardId: string, worktree: string, specPath: string, onChange: () => void): void {
    if (this.watchers.has(cardId)) return;
    const dir = join(worktree, dirname(specPath));
    mkdirSync(dir, { recursive: true }); // fs.watch can't watch a folder that doesn't exist yet
    const entry: { watcher: FSWatcher; timer?: NodeJS.Timeout } = {
      watcher: watch(dir, () => {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(onChange, 150);
      }),
    };
    entry.watcher.on("error", () => this.unwatch(cardId));
    this.watchers.set(cardId, entry);
  }

  unwatch(cardId: string): void {
    const entry = this.watchers.get(cardId);
    clearTimeout(entry?.timer); // a pending change must not fire after the card has left Spec or the hive closed
    entry?.watcher.close();
    this.watchers.delete(cardId);
  }

  closeAll(): void {
    for (const id of [...this.watchers.keys()]) this.unwatch(id);
  }
}
