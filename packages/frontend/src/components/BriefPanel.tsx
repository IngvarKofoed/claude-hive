import type { Brief } from "@hive/shared";
import styles from "./BriefPanel.module.css";

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{heading}</h3>
      {children}
    </section>
  );
}

function List({ items }: { items: string[] }) {
  if (items.length === 0) return <p className={styles.none}>Nothing yet.</p>;
  return (
    <ul className={styles.list}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function BriefPanel({ brief }: { brief: Brief | null }) {
  if (!brief) {
    return <p className={styles.empty}>The brief appears here once the product owner writes it.</p>;
  }
  return (
    <div className={styles.brief}>
      <h2 className={styles.title}>{brief.title}</h2>
      <Section heading="Problem">
        <p>{brief.problem}</p>
      </Section>
      <Section heading="Who it's for">
        <p>{brief.whoItsFor}</p>
      </Section>
      <Section heading="What done looks like">
        <List items={brief.whatDoneLooksLike} />
      </Section>
      <Section heading="Out of scope">
        <List items={brief.outOfScope} />
      </Section>
      <Section heading="Open points">
        <List items={brief.openPoints} />
      </Section>
    </div>
  );
}
