# Delete a card: stop it, remove its worktree and branch, and erase it from the hive

A card can now be deleted, from its page or its tile on the board, after you confirm. Deleting is final and complete:
- whatever the card runs is stopped: its session turns, a background setup, the app the hive runs in Try it, and
  anything on its ports from inside its worktree;
- its worktree and its branch `hive/<card>` are removed;
- the card and everything the hive stored about it are deleted from the database;
- the board drops the tile, and a card page that's open goes back to the board.

It's meant for clearing out test cards and dead ideas. It's not the docs' Drop, which keeps the branch for a while.

## Outcome

**What you get:**

- **Delete from the card or the board:** a Delete button on the card page, and on each tile of the board, including
  Ideas cards, which have no page. Both ask first, naming what goes.
- **Everything goes:**
  - the running turns, setup and app are stopped;
  - the worktree folder and the `hive/<card>` branch are removed;
  - the card's chat, history, questions, issues and decisions are deleted.

  Nothing about the card is left on the board or in the hive's database.
- **Your work on main is untouched.** Only what's on the card's own branch is lost, and the confirmation says so.

**How to verify:**

- **A card mid-work:** delete a card in Build while its developer runs. The turn stops, `git worktree list` no longer
  shows its worktree, `git branch` no longer shows `hive/<card>`, and the tile is gone. Your checkout and main are
  unchanged.
- **A card in Try it:** delete it while its app runs. The app stops, and its port is free.
- **An idea:** delete an Ideas card from its tile. It's gone, with no git involved.
- **Refused while landing:** while a card is landing on main, Delete is refused with "Wait for the landing to finish".
- **Another tab:** with the card's page open in another tab, deleting it there sends that page back to the board.

## Key decisions

- **A hard delete** (new; diverges from `CONCEPT.md`'s Drop, which keeps the branch for a while). Every row that
  belongs to the card is deleted in one transaction, children first, since they reference the card: pending items,
  events, issues, decisions, sessions, and then the card. You chose this over hiding the card and keeping its
  history.
- **Stop first, then delete,** in this order, with only one refusal: a card that's landing on main, or that has a
  move in flight, is refused.
  1. The card is marked as being deleted.
  2. Every running turn of every session of the card is interrupted: its lane roles, a review, the setup, and any
     earlier session still running.
  3. The hive's app is cleared, and the card's ports are swept, as on leaving a lane, but with no note.
  4. The spec folder's watcher stops.
  5. `git worktree remove --force <worktree>`, then `git branch -D hive/<card>`.
  6. The rows go in one transaction.
  7. The in-memory state goes: reviews, timers, the starting and moving marks, follow-ups, the previous setup.
  8. `card.deleted` is sent.
- **Late callbacks stand down** (new). A turn interrupted in step 2 ends a moment later. Its end handling, and any
  background work for the card (a developer starting, a setup, an app starting), checks the being-deleted mark and
  stops, instead of writing to a card that's gone.
  - The delete doesn't wait for interrupted turns to end. You chose speed over waiting.
  - The mark stays until every interrupted turn has ended, so even a late one finds it.
  - Accepted risk: a session or subagent still writing for a moment after the interrupt can leave a stray folder at
    the worktree's old path, `<repo>/.claude/worktrees/<card>`. It's git-ignored and harmless, and you can delete it
    by hand.
- **A git step that fails doesn't stop the delete** (new). If the worktree or branch can't be removed (a folder
  already gone, a branch git refuses to delete), the card is still deleted. The response lists what was left
  behind, with git's reason, and the page shows it on the way back to the board, so you can clean it up by hand. A
  card that never had a worktree (Ideas) or already lost it (Done) skips the git steps.
- **The page asks inline, in its own look,** on the card page and on the tile, never with a browser dialog.
  - **The card page** names the branch, says the worktree goes, and says "Work that isn't on main is lost."
  - **The tile,** which has less room, says "Delete this card and its branch? Work that isn't on main is lost.", or
    "Delete this idea?" for an Ideas card.
  - **A Done card,** whose worktree and branch went when it landed, says "Delete this card's history? Its commit on
    main stays." in both places. Its `Hive-Card:` trailer on main then points at a card that's gone.
  - Both have **Delete** and **Cancel**. Cancel, or Escape, closes the question with nothing done.

## Goals

- **A clean board while testing:** test cards and abandoned ideas can be removed, with nothing left behind in git or
  the database.
- **No surprises:** deleting never touches main or your checkout, and never leaves a process running.

## Non-goals

- **The docs' Park and Drop,** which keep the branch. Delete is the only way off the board for now.
- **Undo.** A deleted card is gone.
- **Claude Code's own session transcripts** under `~/.claude/projects`. They aren't the hive's to delete.
- **Deleting several cards at once,** or a whole project.

## Design

### Backend

- **`Hive.deleteCard(cardId): Promise<{ left: string[] }>`** runs the steps above. `left` holds a line for each git
  step that failed.
- **The being-deleted mark** is a `deleting` set. It's checked:
  - at the top of the turn-end handler, which skips straight to dropping its bookkeeping;
  - in `startDeveloper`, `startSetup`, `startApp` and `startReviewer` before each write. `landFlow` needs no check,
    since a card that's landing can't be deleted;
  - at the public entry points, the methods the routes call, which answer 404 for a card being deleted, so the page
    and its buttons see it gone at once.

  `requireCard` itself, the internal lookup, is left alone. `deleteCard` reads the card row once, before step 1, and
  works from that row throughout.
- **Git service:** three steps of their own, so each failure can be reported apart:
  - `removeWorktree` (`git worktree remove --force`), or `pruneWorktrees` (`git worktree prune`) when the folder is
    already gone;
  - then `deleteBranch` (`git branch -D`) when the branch exists.

  `removeCardWorktree`, which does both and stops at the first failure, isn't reused.
- **Database:** `HiveDb.deleteCard(id)` deletes the rows in that order, inside `transaction`.
- **API:** `DELETE /api/cards/:id` returns `{ left }`.
  - A card that's landing gets 409 "Wait for the landing to finish.".
  - A card with a move in flight gets 409 "This card is moving. Try again in a moment.".

  The page and the tile show either like any other failure.
- **Event:** a new `{ type: "card.deleted"; cardId }`.

### Frontend

- **Card page:** a quiet **Delete card** button in the header, beside the title. Pressing it puts a confirm row under
  the title, in the warning panel style: "Delete this card? Its worktree and the branch `hive/…` are removed, and its
  history is deleted. Work that isn't on main is lost." with **Delete** and **Cancel**.
  - Delete calls `api.deleteCard` and shows "Deleting…".
  - With `left` empty it goes to the board. Otherwise it shows "Deleted. Left behind: …" with a link back.
- **Board tile:** a small **Delete** button, shown on hover and on keyboard focus.
  - Pressing it turns the tile into its confirm, with the tile's text above, and **Delete** and **Cancel** until one
    is pressed.
  - The button and the confirm don't open the card or start a drag.
  - A failure shows on the tile.
- **Events:** the board removes a tile on `card.deleted`. A card page showing that card goes back to the board.

### Docs that change

- **`CONCEPT.md`, Worktrees:** a bullet saying that deleting a card stops what it runs, removes its worktree and
  branch, and erases it from the hive. It's for test cards and dead ideas; Drop keeps the branch.
- **`ARCHITECTURE.md`:**
  - **Card Moves:** a row "any | You delete it | Gone, after everything it runs is stopped. Refused while it lands".
  - **Git:** a row "Delete | `git worktree remove --force` and `git branch -D hive/<card>`".
  - **API:** `DELETE /api/cards/:id`.

## Alternatives considered

- **A soft delete,** hiding the card and keeping its history: you asked for everything to go.
- **Keeping the branch,** as the docs' Drop does: you chose to delete it.
- **Waiting for interrupted turns to end before removing the worktree,** for up to 15 seconds: it closes the
  stray-folder risk, but every delete of a running card would take that much longer.
- **The browser's confirm dialog:** one line of code, but it doesn't look like the rest of the page. You chose an
  inline confirm.
- **Delete on the card page only:** Ideas cards have no page, so test ideas couldn't be deleted.
- **Refusing to delete when git cleanup fails:** a card stuck on the board because of a branch git won't delete is
  worse than a stray branch, which the page names so you can remove it.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.5.** The backend steps and the frontend buttons are small and touch each other's types and
  event, and a fresh agent would need most of this spec to do either half. Tests cover each step on a throwaway repo:
  - a card deleted mid-turn, with its late turn end standing down;
  - in Try it, with its app;
  - in Ideas;
  - refused while landing;
  - git leftovers reported.
