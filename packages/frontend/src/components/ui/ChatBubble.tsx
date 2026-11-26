import type { ReactNode } from "react";
import type { ChatAuthor } from "@hive/shared";
import styles from "./ChatBubble.module.css";

export const AUTHOR_LABEL: Record<ChatAuthor, string> = {
  you: "You",
  "product-owner": "Product owner",
  "spec-writer": "Spec writer",
  planner: "Planner",
  hive: "Hive",
};

interface Props {
  from: ChatAuthor | "error";
  streaming?: boolean;
  children: ReactNode;
}

/** A message bubble with its author's label. The hive's own notes are a quiet line, not a bubble. */
export function ChatBubble({ from, streaming = false, children }: Props) {
  if (from === "hive") {
    return (
      <p className={styles.note} data-from="hive">
        <span className={styles.noteLabel}>{AUTHOR_LABEL.hive}:</span> {children}
      </p>
    );
  }
  return (
    <div className={styles.row} data-from={from}>
      {from !== "error" ? <span className={styles.label}>{AUTHOR_LABEL[from]}</span> : null}
      <div className={styles.bubble} data-from={from} data-streaming={streaming || undefined}>
        {children}
      </div>
    </div>
  );
}
