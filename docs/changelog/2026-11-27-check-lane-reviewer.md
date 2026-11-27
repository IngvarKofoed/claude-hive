# Check lane: an Opus reviewer per round, one fix on its own, then you

A built card now goes through Check by itself. Each round, a new Opus reviewer reads the whole branch against main and
the spec, and reports bugs and spec issues. Round 1's bugs go back to the same developer; a round without bugs moves
the card to Try it. If round 2 still finds bugs, the card stops in Check with Back to Build and Move on.
Built to `docs/specs/2026-11-27-check-lane-reviewer.md`.

## Detail
- **The reviewer runs on Opus,** not the docs' "Strongest": Fable costs twice as much to read one branch. It's a new
  session each round, kept so a restart can resume a cut-off turn.
- **The report has `bugs` and `issues`,** not findings marked `bug`, `spec-gap` or `extra`. Spec gaps and extras are
  both spec issues for the spec keeper, stored like the developer's. Only bugs fail a round, and something the spec
  clearly asks for that's missing counts as a bug.
- **Round limit: `CHECK_ROUNDS = 2`** in `board/moves.ts`.
  - Rejected three or five rounds on their own: each one is an Opus review plus a developer turn without you.
  - Back to Build gives one more round, and the card stops again if that round finds bugs too.
  - Until ■ stopped and the For you view exist, the limit is an error line with two buttons, and the card needs you.
- **A blocked or missing reviewer report offers Retry and Move on,** so a reviewer that fails the same way every time
  can't leave the card stuck. A stopped or failed one offers only Retry. Retry starts a new reviewer for the same
  round rather than re-sending to the old one.
- **A passing round goes straight to Try it** until the spec keeper exists, with its issues unjudged.
- **The round and the move are stored in one transaction.**
  - Going back to Build clears `Card.build` and the developer's last message in that transaction. A restart before the
    developer starts then offers "Build hasn't started yet", and Retry starts it with the bugs.
  - `startDeveloper` reads why the card is entering Build from what's stored: `Card.check` holding bugs means it came
    from Check, since a new plan clears it and a round without bugs moves the card on.
- **The developer's report now describes the whole build:** its `summary` and `departures` cover the build as it
  stands, since each `done` report replaces `Card.build`. Its `issues` and `decisions` are only the new ones. This
  revises "covers everything since your last `done` report" from `2026-11-26-build-lane-developer`.
- **A disputed bug:** the developer leaves the code and ends its summary with why. The next reviewer reports it again
  only if it still holds after reading that.
- **The next reviewer gets the last round's bugs** to check each one is fixed. Rejected a fully blind read, which
  could miss a fix that didn't happen.
- **Check makes no checkpoint,** since the reviewer changes nothing. Known gap: a card that passes can reach Try it
  with files a test run left uncommitted, until Try it's exit makes a checkpoint.
- **The column is `cards.check_round`,** since `check` is reserved in SQL. It holds the last finished round and is
  cleared when a new plan is done.
- **A `check.updated` event** carries each finished round and the card's issues. A round that stops the card leaves
  it in Check, so the page, which refetches only on a lane change, would otherwise go on showing the last round.
- **A hands-off turn cut off before Claude Code created its session is sent its first message again** after a
  restart, not told to carry on: there's nothing to resume, and the new session wouldn't know its card. A developer
  that is resumed is told to carry on with what it was doing, no longer "building to the plan", since it may have
  been fixing Check's bugs.
- **Move on leaves a note in Check's history.** Known gap: it keeps `Card.check`, bugs and all, so once Try it's
  feedback can send a card to Build, `startDeveloper` would take those old bugs for a fresh Check round.
- **The spec reviewer's constant is now `SPEC_REVIEWER`,** so it doesn't read like Check's `reviewer` role.
- **The fake-data marker went with this slice:** see `2026-11-27-mockups-designers-call`.
- **The fix-round message repeats the "whole build" rule,** since a session keeps the instructions of its first
  turn. Found in the run below: a developer that started before the rule existed reported only its fix, and that
  summary replaced the card's build report.
- **Verified end to end** with real Opus sessions, on the scratch card built in the Build slice:
  - After the restart, the card in Check showed "Check hasn't started yet". Retry ran round 1, which found no bugs,
    added 4 spec issues, and moved the card to Try it. Its page shows the Check panel above the build report.
  - With a rounding bug committed by hand (`Math.round` to `Math.floor`) and the card put back in Check, round 1
    found it in about a minute, and the card went back to Build.
  - The same developer was resumed with the bug. It fixed it, added a test, and reported `done`.
  - A new reviewer ran round 2: it confirmed the fix, found no bugs, and the card moved to Try it.
- **Not covered by that run:** the fake-runner tests cover these.
  - the round limit, Back to Build and Move on;
  - a blocked or missing reviewer report;
  - a restart in the middle of a review.

  The "Check found" panel in Build was never on screen either, since the fix took under half a minute.
- **Known limits:**
  - No tester yet, so nobody runs the spec's How-to-verify checks before Try it.
  - Local files such as `.env` aren't copied into the worktree yet. The reviewer is told that a test failing only for
    a missing local file isn't a bug.
