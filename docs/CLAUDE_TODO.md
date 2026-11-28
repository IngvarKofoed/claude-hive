# Owed follow-ups

Work this project owes and hasn't done, written and drained by Claude — the rules are
under *Owed follow-ups* in `CLAUDE.md`. Items are deleted when the work lands, so this
is not a record of anything; `docs/changelog/` is. A line you add here is read as a request.

- **Roles are enforced only by their instructions** — every session runs with full access in auto mode, so a
  reviewer told not to edit, or a blind spec reviewer told what to read, can still do otherwise. A per-role
  permissions policy is parked. Surfaced by `2026-11-26-full-access-auto-mode`.
- **Stopped cards have no way out** — Card Moves has no move out of ■ stopped (redesign, rethink, narrow, drop,
  retry), a missing or blocked report has no kind of item waiting for you, and Drop isn't in Card Moves or the
  data model. Surfaced by a design review of the docs.
- **Picking a mockup version is undefined** — how the picked version's code reaches the card's branch, and one
  port per version for comparing side by side, since only the card has a port. Surfaced by a design review of the docs.
- **The `git init` first commit takes everything in the folder** — secrets or build output a `.gitignore` would
  keep out end up committed. Surfaced by `2026-11-26-projects-always-git`.
- **Ship's Approve item isn't built** — the docs make the push at Ship an Approve item (`PendingItem` kind `approve`),
  which For you would list. The code's Land on main button on the card page stands in for it, so For you lists a Ship
  card by its lane and opens the card. Surfaced by `2026-11-27-for-you`.
- **A question cut off by a restart is never closed** — a pending item whose turn the hive cut off keeps
  `answer IS NULL`. `dropOpenPending` only withdraws items that still have a waiter, and nothing closes them when the
  card leaves the lane. So after the resumed session carries on, the card page and For you, which lists a question
  first, can show an old Build question on a card in Try it, and answering it starts a new turn there. Surfaced by
  the commit-time review of `2026-11-27-for-you`.
