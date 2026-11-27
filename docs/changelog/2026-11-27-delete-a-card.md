# Delete a card: stop it, remove its worktree and branch, and erase it

A card can now be deleted from its page or its board tile, ideas included, after an inline confirm that names what
goes. The delete:
- stops everything the card runs: its session turns, a background setup, its app, and what's on its ports;
- removes its worktree and its `hive/<card>` branch;
- deletes its rows in one transaction.

It's for test cards and dead ideas, and is separate from the docs' Drop, which keeps the branch. Built to
`docs/specs/2026-11-27-delete-a-card.md`.

## Detail
- **A hard delete.** Rejected hiding the card and keeping its history, and keeping the branch: you asked for
  everything to go.
- **It doesn't wait for interrupted turns to end.** A "being deleted" mark makes their late end handling, and any
  background start for the card, stand down without writing. The mark stays until the last interrupted turn has
  ended. Rejected waiting up to 15 seconds before removing the worktree, which would slow every delete of a running
  card.
  - Accepted risk: a session still writing for a moment can leave a stray, git-ignored folder at the worktree's old
    path.
  - The background starts check `gone()`, the mark or a missing row, not the mark alone: with no turn to interrupt
    the mark lifts when the delete ends, while a developer start or setup awaiting git is still on its way.
- **The routes answer 404 for a card being deleted** (an `r.use` check). The internal `requireCard` is left alone, so
  the delete's own steps still find the card; `deleteCard` reads the row once up front.
- **A git step that fails doesn't stop the delete.** The response's `left` names what was left behind, with git's
  reason, and the page shows it instead of going back to the board.
  - A worktree folder that's already gone is pruned, so its branch can be deleted.
  - Ideas and Done cards have no git to remove.
- **Refused only while the card lands on main or a move is in flight,** with their 409s.
- **The confirm is inline,** in the page's warning style, not a browser dialog. Its text depends on the card:
  - the card page names the branch;
  - the tile says "Delete this card and its branch? Work that isn't on main is lost.";
  - an idea gets "Delete this idea?";
  - a Done card gets "Delete this card's history? Its commit on main stays.".

  Escape or Cancel closes it.
- **The tile's Delete shows on hover and keyboard focus.** The tile isn't draggable while it asks.
- **A new `card.deleted` event** removes the tile and sends an open card page back to the board.
- **Not deleted:** Claude Code's own session transcripts under `~/.claude/projects`.
- **Verified in the browser** on the scratch board:
  - An idea was deleted from its tile; Delete showed on hover, and the confirm read "Delete this idea?".
  - A card in Refine was deleted from its page within seconds, while its real product owner and setup sessions ran.
    Its worktree and branch were gone with no stray folder, the checkout stayed clean, its rows were gone, and the
    backend logged no errors.
  - A landed card was deleted from its tile, and its commit stayed on `origin/main`.

  The console was clean throughout.
- **Not covered by that run:** the fake-runner tests cover these.
  - a card with the hive's app running;
  - a git step that fails;
  - a worktree folder that's already gone;
  - the refusals while landing or moving.
- **The git steps are separate helpers** (`removeWorktree`, `pruneWorktrees`, `deleteBranch`), not Ship's
  `removeCardWorktree`, so a worktree whose folder is already gone can be pruned and each failure reported. The spec
  was updated to match.
- **Known gap:** deleting from a board tile ignores `left`. If git leaves a worktree or branch behind, the tile
  vanishes and nothing says so. The card page does show it. Where a board-level notice would go is still to decide.
