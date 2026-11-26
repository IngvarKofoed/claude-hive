# Owed follow-ups

Work this project owes and hasn't done, written and drained by Claude — the rules are
under *Owed follow-ups* in `CLAUDE.md`. Items are deleted when the work lands, so this
is not a record of anything; `docs/changelog/` is. A line you add here is read as a request.

- **The packages don't run `scripts/gen-version.mjs` yet** — when the backend and frontend
  `package.json` files are created, their `predev` and `prebuild` must call it, or the app has no
  version. Surfaced by `2026-11-26-git-describe-version`.
