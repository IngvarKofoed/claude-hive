import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { FolderCompletion } from "@hive/shared";
import { api } from "../api/client";
import styles from "./ProjectPathInput.module.css";

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/**
 * The Add project path field, as an ARIA combobox: it lists the folders that match what's typed, and Tab, Enter or a
 * click completes one (docs/specs/2026-11-28-folder-autocomplete-and-git-init-when-ad.md).
 */
export function ProjectPathInput({ id, value, onChange, placeholder }: Props) {
  const [folders, setFolders] = useState<FolderCompletion[]>([]);
  const [more, setMore] = useState(0);
  const [highlight, setHighlight] = useState(-1);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    setHighlight(-1);
    setDismissed(false);
    if (!value) {
      setFolders([]);
      setMore(0);
      return;
    }
    api
      .folders(value)
      .then((answer) => {
        if (ticket !== latest.current) return;
        setFolders(answer.folders);
        setMore(answer.more);
      })
      .catch(() => {
        if (ticket !== latest.current) return;
        setFolders([]);
        setMore(0);
      });
  }, [value]);

  const open = focused && value !== "" && folders.length > 0 && !dismissed;

  function complete(folder: FolderCompletion) {
    setHighlight(-1);
    onChange(folder.value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    const count = folders.length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => (h + 1) % count);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => (h <= 0 ? count - 1 : h - 1));
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
      setHighlight(-1);
    } else if (event.key === "Enter" || event.key === "Tab") {
      const folder = folders[highlight];
      if (folder) {
        event.preventDefault();
        complete(folder);
      } else if (event.key === "Tab" && count === 1 && folders[0]) {
        event.preventDefault();
        complete(folders[0]);
      }
    }
  }

  return (
    <div className={styles.box}>
      <input
        id={id}
        className={styles.input}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && highlight >= 0 ? `${id}-opt-${highlight}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul className={styles.list} role="listbox" id={`${id}-list`}>
          {folders.map((folder, i) => (
            <li
              key={folder.value}
              className={styles.option}
              role="option"
              id={`${id}-opt-${i}`}
              aria-selected={i === highlight}
              onMouseDown={(event) => {
                event.preventDefault();
                complete(folder);
              }}
            >
              {folder.name}
            </li>
          ))}
          {more > 0 ? (
            <li className={styles.more} role="presentation">
              and {more} more — keep typing
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
