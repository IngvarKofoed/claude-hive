import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Panel.module.css";

interface Props extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  tone?: "default" | "warning";
}

export function Panel({ title, tone = "default", children, className, ...rest }: Props) {
  return (
    <section {...rest} className={[styles.panel, className].filter(Boolean).join(" ")} data-tone={tone}>
      {title ? <h2 className={styles.title}>{title}</h2> : null}
      {children}
    </section>
  );
}
