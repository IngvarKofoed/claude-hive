# Looking back shows every round the later lanes produced

Looking back at Plan, Build, Check or Try it now shows every round, newest on top and open, with older ones folded.
Back in Try it, the panel shows the feedback you gave before. A Done card shows the spec it landed with, read from its
landed commit. It all comes from event rows the hive was already writing, so existing cards have their history.
Spec: `docs/specs/2026-11-27-later-lane-artifacts.md`. Second slice of `2026-11-27-card-lane-artifacts`.

## Detail
- **Read from rows, nothing new written.** The `plan`, `build`, `check`, `feedback` and `accept` rows have been
  written since each lane was built and were never read. Rejected: a lane-visit table, since every move would need
  changing and existing cards would start empty. Also rejected: a copy taken when a card leaves a lane, which misses
  rounds within a lane.
- **The history only refreshes when the card changes lane.** It's sent with every card fetch, and live events don't
  touch it. That holds because a lane's rows are all written before the lane can be looked back at. Showing the
  current lane's rounds live would need a live event first. The Try it panel is the one exception, and it's safe
  because a feedback row is written as the card leaves Try it.
- **Rounds are numbered in order, oldest first,** so headings never repeat. A Check round's number can differ from
  the chat's "Round 2 found 3 bugs": the chat counts toward the round limit, and its count starts over after a new
  plan, your feedback, or Ship sending the card back. Rejected: the chat's numbers, since two folds called "Round 1"
  would be common; also a time beside each heading.
- **One "Accepted", on top, only while it's the last Try it row.** An acceptance that Back to Try it undid isn't
  shown.
- **Only the newest build round lists the files changed.** A `build` row holds the developer's report, and the files
  are worked out after it's stored, onto the card's `build`.
- **A landed card's spec is read with `git show <commit>:<specPath>`** in the project's repo and cached in memory
  per card. A failed read isn't cached, so the next fetch tries again. It fills `spec` with `review: "fresh"`, so the
  Done page shows it too, folded. The spec stays out of the database, as `docs/specs/2026-11-26-spec-lane-review-gate.md` decided.
  `Hive.card()` stays synchronous: the route calls `cardForPage()`, which reads the spec first.
- **The Spec lane still shows only the spec.** `CONCEPT.md` lists its drafts, the review's findings and your sign-off
  under History and Done. None of them is recorded yet, so that line stays ahead of the code.
- **"Finished" is still board order.** A lane ahead of the card isn't a link, even when it has rounds.
