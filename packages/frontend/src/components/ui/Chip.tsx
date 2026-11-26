import type { ReactNode } from "react";
import styles from "./Chip.module.css";

export function Chip({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return (
    <span className={styles.chip} data-mono={mono || undefined}>
      {children}
    </span>
  );
}
