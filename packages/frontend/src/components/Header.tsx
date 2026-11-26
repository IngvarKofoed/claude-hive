import { Link } from "react-router";
import { APP_VERSION } from "@hive/shared";
import styles from "./Header.module.css";

export function Header() {
  return (
    <header className={styles.header}>
      <Link to="/" className={styles.name}>
        Claude Hive
      </Link>
      <span className={styles.version}>{APP_VERSION}</span>
    </header>
  );
}
