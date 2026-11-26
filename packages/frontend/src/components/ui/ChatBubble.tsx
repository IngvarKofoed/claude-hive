import type { ReactNode } from "react";
import styles from "./ChatBubble.module.css";

interface Props {
  from: "you" | "product-owner" | "error";
  streaming?: boolean;
  children: ReactNode;
}

export function ChatBubble({ from, streaming = false, children }: Props) {
  return (
    <div className={styles.row} data-from={from}>
      <div className={styles.bubble} data-from={from} data-streaming={streaming || undefined}>
        {children}
      </div>
    </div>
  );
}
