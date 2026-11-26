import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  compact?: boolean;
}

export function Button({ variant = "secondary", compact = false, className, type = "button", ...rest }: Props) {
  const classes = [styles.button, className].filter(Boolean).join(" ");
  return <button {...rest} type={type} className={classes} data-variant={variant} data-compact={compact || undefined} />;
}
