import styles from "./IdeaView.module.css";

/** An idea, read-only: the title as a heading and the text as paragraphs. */
export function IdeaView({ title, text }: { title: string; text: string }) {
  return (
    <div className={styles.idea}>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.text}>{text}</p>
    </div>
  );
}
