import type { SpecInfo } from "@hive/shared";
import { Chip } from "./ui/Chip";
import { Markdown } from "./ui/Markdown";
import styles from "./SpecView.module.css";

interface Props {
  spec: SpecInfo;
}

/**
 * The spec under its path, folded shut: a click on the path opens the rendered Markdown. The brief isn't repeated
 * here, since ✓ Refine shows it (docs/specs/2026-11-27-card-lane-artifacts.md).
 */
export function SpecView({ spec }: Props) {
  if (spec.text === null) {
    return (
      <div className={styles.spec}>
        <p>
          <Chip mono>{spec.path}</Chip>
        </p>
        <p className={styles.waiting}>The spec writer is writing the spec…</p>
      </div>
    );
  }
  return (
    <details className={styles.fold}>
      <summary className={styles.summary}>
        <Chip mono>{spec.path}</Chip>
      </summary>
      <Markdown>{spec.text}</Markdown>
    </details>
  );
}
