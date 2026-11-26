# Owed follow-ups

Work this project owes and hasn't done, written and drained by Claude — the rules are
under *Owed follow-ups* in `CLAUDE.md`. Items are deleted when the work lands, so this
is not a record of anything; `docs/changelog/` is. A line you add here is read as a request.

- **Roles are enforced only by their instructions** — every session runs with full access in auto mode, so a
  reviewer told not to edit, or a blind spec reviewer told what to read, can still do otherwise. A per-role
  permissions policy is parked. Surfaced by `2026-11-26-full-access-auto-mode`.
- **Work-in-progress limits can deadlock** — a card waiting for a full Check and a card sent back to a full Build
  each hold the slot the other needs, and a card waiting for room has no state. Surfaced by a design review of the docs.
- **Stopped cards have no way out** — Card Moves has no move out of ■ stopped (redesign, rethink, narrow, drop,
  retry), a missing or blocked report has no kind of item waiting for you, and Drop isn't in Card Moves or the
  data model. Surfaced by a design review of the docs.
- **Picking a mockup version is undefined** — how the picked version's code reaches the card's branch, and one
  port per version for comparing side by side, since only the card has a port. Surfaced by a design review of the docs.
- **The `git init` first commit takes everything in the folder** — secrets or build output a `.gitignore` would
  keep out end up committed. Surfaced by `2026-11-26-projects-always-git`.
