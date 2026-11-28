import { useState } from "react";
import type { CardDetail, MockupInfo } from "@hive/shared";
import { api } from "../api/client";
import { Button } from "./ui/Button";
import styles from "./KeepMockupLine.module.css";

/**
 * What the line says about a mockup you didn't keep, or null when Keep it after all would be refused: it refuses what
 * Keep refuses, so a mockup must be named, and pages must still be in the folder. A link needs no files.
 */
export function notKeptLine(mockup: MockupInfo | null): string | null {
  if (!mockup || mockup.kept !== false || !mockup.current) return null;
  if (mockup.current.kind === "pages") {
    return mockup.files.length > 0 ? "The mockup isn't kept: its pages are deleted at sign-off." : null;
  }
  return mockup.files.length > 0
    ? "The mockup isn't kept: its link isn't saved in docs/mockups, and the files beside it are deleted at sign-off."
    : "The mockup isn't kept: its link isn't saved in docs/mockups.";
}

/** In Spec, while a mockup you didn't keep could still be kept: the way to keep it after all. */
export function KeepMockupLine({ detail }: { detail: CardDetail }) {
  const [error, setError] = useState<string | null>(null);
  const line = notKeptLine(detail.mockup);
  if (!line) return null;

  async function keep() {
    setError(null);
    try {
      await api.keepMockup(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not keep the mockup.");
    }
  }

  return (
    <div className={styles.line}>
      <p className={styles.text}>{line}</p>
      <Button compact onClick={() => void keep()}>
        Keep it after all
      </Button>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
