import type { MockupInfo } from "@hive/shared";
import { mockupHref, mockupPageHref } from "../api/client";
import styles from "./MockupPanel.module.css";

const OPEN = "Open the mockup ↗";

function OpenLink({ href }: { href: string }) {
  return (
    <a className={styles.open} href={href} target="_blank" rel="noopener">
      {OPEN}
    </a>
  );
}

/** The Mockup lane's panel: a link to the designer's current mockup, which opens in its own tab. */
export function MockupPanel({ cardId, mockup }: { cardId: string; mockup: MockupInfo | null }) {
  const current = mockup?.current ?? null;
  if (!mockup || !current) {
    return <p className={styles.empty}>The designer&apos;s mockup shows here once it has one.</p>;
  }
  if (current.kind === "link") {
    return (
      <div className={styles.panel}>
        <OpenLink href={current.url} />
        <code className={styles.path}>{current.url}</code>
      </div>
    );
  }
  return (
    <div className={styles.panel}>
      <OpenLink href={mockupPageHref(cardId, mockup, current.page)} />
      <code className={styles.path}>{current.page}</code>
      <p className={styles.note}>Reload the tab after the designer&apos;s changes.</p>
    </div>
  );
}

/** A finished Mockup lane's panel: what became of the mockup. Display only, nothing to press. */
export function MockupLookBack({
  cardId,
  mockup,
  hasWorktree,
}: {
  cardId: string;
  mockup: MockupInfo | null;
  hasWorktree: boolean;
}) {
  const current = mockup?.current ?? null;
  if (!mockup || !current) return <p className={styles.empty}>No mockup was made.</p>;
  if (current.kind === "link") {
    return (
      <div className={styles.panel}>
        <a className={styles.open} href={current.url} target="_blank" rel="noopener">
          {current.url}
        </a>
      </div>
    );
  }
  const canOpen = hasWorktree && mockup.files.length > 0;
  const files = canOpen ? (
    <ul className={styles.files}>
      {mockup.files.map((file) => (
        <li key={file}>
          <a href={mockupHref(cardId, file)} target="_blank" rel="noopener">
            {file}
          </a>
        </li>
      ))}
    </ul>
  ) : null;
  if (mockup.kept) {
    return (
      <div className={styles.panel}>
        <p>{hasWorktree ? `Kept in ${mockup.folder}/` : `Kept: on main at ${mockup.folder}/.`}</p>
        {files}
      </div>
    );
  }
  // Not kept: its pages are still in the worktree until sign-off deletes them, so the mockup can still be opened.
  return (
    <div className={styles.panel}>
      <p>{canOpen ? "Not kept." : "Not kept. Its pages were deleted at sign-off."}</p>
      {canOpen ? <OpenLink href={mockupPageHref(cardId, mockup, current.page)} /> : null}
    </div>
  );
}
