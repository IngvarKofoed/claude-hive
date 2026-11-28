import type { ReactNode } from "react";
import styles from "./Rounds.module.css";

export interface Round {
  heading: string;
  content: ReactNode;
}

/** The number for the item at `index` in a newest-first list of `length`: oldest is 1, so headings never repeat. */
export const roundNumber = (length: number, index: number) => length - index;

/** Rounds newest first: the newest open under its heading, every older one folded shut. */
export function Rounds({ rounds }: { rounds: Round[] }) {
  return (
    <div className={styles.rounds}>
      {rounds.map((round, index) =>
        index === 0 ? (
          <section key={round.heading} className={styles.open}>
            <h3 className={styles.heading}>{round.heading}</h3>
            {round.content}
          </section>
        ) : (
          <details key={round.heading} className={styles.fold}>
            <summary className={styles.summary}>{round.heading}</summary>
            {round.content}
          </details>
        ),
      )}
    </div>
  );
}
