import type { HTMLAttributes } from "react";
import styles from "./Badge.module.css";

export type BadgeTone = "needs-you" | "working" | "stopped" | "done" | "neutral";

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Less side padding, and wrapping allowed: for a symbol alone, or a Compact tile's words. */
  compact?: boolean;
}

export function Badge({ tone = "neutral", compact = false, children, ...rest }: Props) {
  const classes = [styles.badge, rest.className].filter(Boolean).join(" ");
  return (
    <span {...rest} className={classes} data-tone={tone} data-compact={compact || undefined}>
      {children}
    </span>
  );
}
