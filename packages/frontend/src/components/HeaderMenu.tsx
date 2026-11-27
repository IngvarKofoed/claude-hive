import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import styles from "./HeaderMenu.module.css";

/**
 * The ☰ disclosure at the end of the header (docs/specs/2026-11-27-role-prompts-page.md): one link to Role prompts.
 * It's a disclosure with a link in it, not an ARIA menu. The button looks current while a page behind it is open.
 */
export function HeaderMenu() {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const current = pathname === "/roles" || pathname.startsWith("/roles/");

  // A click anywhere outside closes it.
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className={styles.wrap}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        wrapRef.current?.querySelector("button")?.focus();
      }}
    >
      <button
        type="button"
        className={styles.button}
        aria-label="More"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        data-current={current || undefined}
        onClick={() => setOpen(!open)}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M3 5h14M3 10h14M3 15h14" />
        </svg>
      </button>
      {open && (
        <ul id={listId} className={styles.list}>
          <li>
            <Link to="/roles" className={styles.item} data-current={current || undefined} onClick={() => setOpen(false)}>
              <span className={styles.itemName}>Role prompts</span>
              <span className={styles.itemNote}>What each lane's sessions are told</span>
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}
