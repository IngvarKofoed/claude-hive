# Spec and Plan lanes: Good, spec writer, review gate, sign-off and the planner

A card now goes on from Refine:
- **Good** starts a spec writer, which writes the spec into the worktree's `docs/specs/`.
- **Review** runs a blind Fable reviewer. The writer applies the fixes and asks you the decisions.
- **Sign off** works only on the reviewed text. It commits the spec on the card's branch and starts the planner.
- **The planner** is the first hands-off role. Its schema-checked report is the plan, and Build shows "Not implemented yet".

Built to `docs/specs/2026-11-26-spec-lane-review-gate.md`.

## Detail
- **The reviewed text** is the file's hash when the writer's review turn finishes. Answers you give during that
  turn count as reviewed without a second read, a limit chosen with "Review on request" over two rejected options:
  - reviewing on every change, rejected for the cost of a Fable review per revision;
  - Sign off triggering the review, rejected because you'd approve before seeing what changed.
- **Unfinished review turns:** a stopped, cut-off or failed review turn leaves the review `unfinished`, and Retry
  re-sends the same findings. Rejected: recording it as reviewed, or paying for a new review. A message sent instead
  sets the review aside.
- **The spec is read from disk, never from a session:** after every turn, on every fetch, and by an `fs.watch` on
  its folder while the card is in Spec. Entering Spec creates `docs/specs/` first, because `fs.watch` can't watch a
  missing folder.
- **A blocked or missing plan** keeps the card in Plan with Retry and **Back to Spec**. Back to Spec clears the
  reviewed hash, so a new review and sign-off follow, and the second sign-off resumes the same planner session.
  Rejected: Retry with a note, which leaves the committed spec contradicting itself, and accepting the dead end.
- **The planner's questions come straight to you on the card page** until the manager ladder exists. This
  diverges, for now, from `docs/ARCHITECTURE.md`'s hands-off routing.
- **`LaneInfo.implemented` is temporary.** A lane whose slice isn't built shows "Not implemented yet". Rejected: a
  `waiting` card state.
- **Data changes:**
  - Chat rows now carry their lane. Rows from the first slice have none and count as Refine's.
  - Error rows list `actions` (`retry`, `review`, `back-to-spec`) instead of `retryable`. Old rows are read with
    `retryable` mapped to `retry`.
  - The new card columns are added to an existing database on open.
- **`TurnOutcome` changes:** it now carries the report and whether the turn was stopped. A report only counts as
  `structured_output`, never as the result's `success`.
- **Every lane a card moves to is decided in `packages/backend/src/board/moves.ts`:** `laneAfter` for Good, Sign
  off and Back to Spec, and `laneAfterPlan` for the planner's report status. Each row has a test.
- **Constraints the commit review added:**
  - `turn.ended` goes out only when no turn on the card is still running. Otherwise the page loses Stop while the
    writer applies a review.
  - Chat, Review and Retry are refused while Sign off is committing, so a signed-off spec can't change under the
    commit.
  - A failure handling a turn's end, or restarting a cut-off planner, is logged and becomes an error line with Retry.
    It must never take the hive down.
- **The two owed chat fixes landed:** Enter sends, and the card page buffers events during its first load. Both
  were surfaced by `2026-11-26-board-refine-chat-slice`.
- **Verified end to end** in a browser with real sessions (Opus writer and planner, Fable reviewer) on a database
  from the first slice:
  - Good, the spec rendered as Markdown, and Review with 1 fix and 2 decisions answered;
  - "Reviewed: you can sign off", then a hand edit greying Sign off live, and restoring it;
  - Sign off committing only the spec on `hive/<card>`, with the checkout clean;
  - an 8-step plan staffed as that spec's Implementation strategy said, with no file changed, and the card in Build
    marked "Not implemented yet".
- **Not covered by that run:** a blocked plan and Back to Spec, a cut-off planner or review turn, and a review that
  finds nothing. The fake-runner tests cover those.
