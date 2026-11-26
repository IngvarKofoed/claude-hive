import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Brief, SpecInfo } from "@hive/shared";
import { BriefPanel } from "./BriefPanel";
import { Chip } from "./ui/Chip";
import styles from "./SpecView.module.css";

interface Props {
  spec: SpecInfo;
  brief: Brief | null;
}

/** The spec as rendered Markdown, under its path and a collapsed brief. */
export function SpecView({ spec, brief }: Props) {
  return (
    <div className={styles.spec}>
      <details className={styles.brief}>
        <summary className={styles.summary}>Brief</summary>
        <BriefPanel brief={brief} />
      </details>
      <p>
        <Chip mono>{spec.path}</Chip>
      </p>
      {spec.text === null ? (
        <p className={styles.waiting}>The spec writer is writing the spec…</p>
      ) : (
        <div className={styles.markdown}>
          <Markdown remarkPlugins={[remarkGfm]}>{spec.text}</Markdown>
        </div>
      )}
    </div>
  );
}
