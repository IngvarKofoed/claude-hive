import type { ChecklistItem, ChecklistStatus } from "@hive/shared";
import styles from "./ChecklistView.module.css";

const MARKS: Record<ChecklistStatus, { mark: string; label: string }> = {
  completed: { mark: "✓", label: "Done" },
  in_progress: { mark: "▶", label: "In progress" },
  pending: { mark: "○", label: "Waiting" },
};

export function ChecklistView({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className={styles.list}>
      {items.map((item, index) => (
        // A TodoWrite item has no id: keyed apart from task ids, so "1" and the item at index 1 never collide.
        <li key={item.id !== null ? `id:${item.id}` : `at:${index}`} className={styles.item} data-status={item.status}>
          <span className={styles.mark} aria-hidden="true">
            {MARKS[item.status].mark}
          </span>
          <span className={styles.hidden}>{MARKS[item.status].label}: </span>
          <span className={styles.text}>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}
