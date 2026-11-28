import type { AmendmentInfo } from "@hive/shared";
import styles from "./AmendmentView.module.css";

/** How an amendment left Spec, in words: who signed it off, and whether a review read it. */
export function amendmentSignoff(amendment: AmendmentInfo): string | null {
  if (!amendment.signedOff) return null;
  const who = amendment.signedOff === "auto" ? "signed off on its own" : "signed off by you";
  return `${who}, ${amendment.reviewed ? "reviewed" : "review skipped"}`;
}

/** Your Send back words and what the spec writer changed because of them. The heading is the caller's, when it has one. */
export function AmendmentView({ amendment, heading = true }: { amendment: AmendmentInfo; heading?: boolean }) {
  const signoff = amendmentSignoff(amendment);
  return (
    <div className={styles.amendment}>
      {heading ? <h4 className={styles.heading}>Amendment {amendment.n}</h4> : null}
      <p className={styles.words}>{amendment.words}</p>
      {amendment.summary ? <p className={styles.words}>{amendment.summary}</p> : null}
      {signoff ? <p className={styles.muted}>{signoff}</p> : null}
    </div>
  );
}

/** A modest band above the spec while the card carries an amendment. */
export function AmendmentBand({ amendment }: { amendment: AmendmentInfo | null }) {
  if (!amendment) return null;
  return (
    <div className={styles.band} role="note">
      <AmendmentView amendment={amendment} />
    </div>
  );
}
