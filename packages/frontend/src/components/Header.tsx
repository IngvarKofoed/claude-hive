import { Link, NavLink } from "react-router";
import { APP_VERSION } from "@hive/shared";
import { useForYou } from "./forYou";
import { HeaderMenu } from "./HeaderMenu";
import { NewIdea } from "./NewIdea";
import styles from "./Header.module.css";

export function Header() {
  const { items } = useForYou();
  const waiting = items.length;
  return (
    <header className={styles.header}>
      <Link to="/" className={styles.name}>
        Claude Hive
      </Link>
      <nav aria-label="Main" className={styles.nav}>
        <NavLink to="/" end className={styles.link}>
          Board
        </NavLink>
        <NavLink
          to="/for-you"
          className={styles.link}
          aria-label={waiting > 0 ? `For you, ${waiting} waiting` : undefined}
        >
          For you
          {waiting > 0 ? <span className={styles.pill}>{waiting}</span> : null}
        </NavLink>
      </nav>
      <span className={styles.version}>{APP_VERSION}</span>
      <NewIdea />
      <HeaderMenu />
    </header>
  );
}
