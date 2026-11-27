import { useEffect, useState } from "react";
import { Header } from "../components/Header";
import { ForYouEntry } from "../components/ForYouEntry";
import { useForYou } from "../components/forYou";
import styles from "./ForYou.module.css";

export function ForYou() {
  const { items, loaded, error } = useForYou();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const count = items.length;
  return (
    <>
      <Header />
      <main className={styles.main}>
        <div>
          <h1 className={styles.title}>For you</h1>
          {count > 0 ? (
            <p className={styles.subtitle}>
              {count === 1 ? "1 thing is" : `${count} things are`} holding up a card, oldest first. Everything else is
              running on its own.
            </p>
          ) : null}
        </div>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {loaded && count === 0 && !error ? (
          <p className={styles.empty}>Nothing is waiting for you. Everything is running on its own.</p>
        ) : null}
        {items.map((item) => (
          <ForYouEntry key={item.card.id} item={item} nowMs={nowMs} />
        ))}
      </main>
    </>
  );
}
