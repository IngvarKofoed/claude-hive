# Build lane: one developer turn builds the plan and reports

A done plan now starts Build by itself: the hive merges the local main into the card's branch, and one Opus
developer builds the whole plan in one turn, handing non-Opus chunks to subagents. Its report is stored, the hive
commits a checkpoint, and the card moves to Check. Spec issues and "decided without you" wait on the card for the
spec keeper and Try it. Built to `docs/specs/2026-11-26-build-lane-developer.md`.

## Detail
- **Bringing in main is a merge, never a rebase,** for the reasons in `2026-11-26-ship-squash-then-push`.
  - A clean merge, conflicts or git refusing all go into the developer's first message. There is no separate
    error path.
  - The merge runs with `--no-verify`, as checkpoints do.
  - Only the local `main` is merged; fetching is Ship's business.
- **The developer is always Opus, as the lead.** This narrows `2026-11-26-one-developer-per-card`. Rejected:
  running the session on the strongest model the plan names, which would make a one-chunk Sonnet plan a Sonnet
  session.
- **The checkpoint is `git add -A` with `--no-verify`,** so a project's pre-commit hook can't stop a lane exit.
  - Leftover files are committed rather than bounced back to the developer (rejected: one more turn and failure
    path). Check reviews the whole branch.
  - A checkpoint is never committed over an unfinished merge. A `done` report while `MERGE_HEAD` exists counts as
    not done.
  - Back to Spec from Build runs `git merge --abort` first, and the next Build merges again. Known gap:
    `--abort` resets the index, so build work the developer had staged (`git add`) during the unfinished merge is
    lost; unstaged changes survive and are committed.
- **The report is stored before the checkpoint.** A refused commit keeps the card in Build, and its Retry redoes
  only the commit and the move, without a new developer turn.
  - `Card.build` is cleared each time a card enters Build, so a set `build` on a card in Build means exactly "the
    report is in, the checkpoint isn't".
- **A blocked or missing report gets Retry and Back to Spec,** extending the blocked plan's way out from
  `2026-11-26-spec-and-plan-lanes`. This diverges from the docs' spec keeper judging a blocking issue at once,
  until the keeper exists.
  - Back to Spec commits the partial work as `Build (unfinished): <title>`.
  - After a new sign-off, the planner is resumed and then the same developer.
- **The developer's questions come straight to you** on the card page, as the planner's do, until the manager
  exists.
- **Retry in Build has three paths:**
  - a stored report: redo the checkpoint only;
  - a developer that has had no turn in this Build visit: `startDeveloper`, which merges main again. Each visit
    clears the developer's last message first, so a failed start on a second visit can't re-send the first
    visit's message with its old plan;
  - otherwise: re-send the last message.

  The role starts every turn with `git status`, since a merge note in a re-sent message may be stale.
- **After a restart:**
  - A running developer turn is resumed.
  - A card in Build with nothing running and no Retry line gets one: "Build hasn't started yet", "Build was cut
    off", or "the checkpoint wasn't committed".
  - Nothing starts a build by itself at startup.
- **A report covers everything since the developer's last `done` report.** This relies on the session remembering
  its own earlier reports.
- **Issues are stored with `spec_section` as the column** for the type's `where`, because `where` is reserved in
  SQL.
- **The page:**
  - Build is read-only, like Plan: the developer's chat and questions, with the plan beside it.
  - From Check on, the Build report sits at the top of the right column, above the plan and beside the spec.
    Placed under the spec, it ended up some 5,000px down the page.
  - The report's summary is Markdown, rendered through `components/ui/Markdown`, which the spec view now shares.
- **Verified end to end** with a real Opus developer, on the scratch card planned before this slice:
  - The card showed "Build hasn't started yet" with Retry.
  - Retry merged one new commit from main, and the developer used the merged-in file.
  - The developer gave the plan's Sonnet chunk to a subagent, reviewed it, and reported `done` in about 3.5 minutes.
  - The card reached Check with the report, 15 changed files, 1 issue and 4 decisions.
  - The project's 28 tests pass in the worktree, and the project's own checkout stayed clean.
- **Not covered by that run:** the fake-runner tests cover these.
  - The developer committed its own work, so the hive's leftover checkpoint had nothing to commit.
  - Not run either: a blocked or missing report, Back to Spec from Build, a merge that stops on conflicts, a
    refused checkpoint, and a restart mid-build.
- **Known limits:**
  - No project setup command and no copying of `.env` or other local files into the worktree; the developer
    installs dependencies itself.
  - A turn cut off at every restart is resumed every time, as the planner's is.
  - Error lines keep their buttons after they're resolved, in every lane; the backend refuses a stale click.
