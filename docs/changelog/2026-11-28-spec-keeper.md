# The spec keeper judges spec issues before a card moves on

Spec issues are now judged, not only collected: once Check passes, the spec writer's own session judges them as the
spec keeper. Minor spec fixes get a dated `## Amendments` line and minor code fixes go back to the same developer.
What changes your sign-off, or comes back, waits in Try it, and a severe issue stops the card. A blocked build gets one
keeper turn first. Built to `docs/specs/2026-11-28-spec-keeper.md`.

## Detail
- **Code fixes go straight to the same developer, not through Plan** (diverges from the docs' amendment plan, which
  CONCEPT and ARCHITECTURE no longer describe).
  - It reuses `startDeveloper`'s way in for Check's bugs, through `Card.keeperFixes`.
  - Rejected: an Opus planner turn per fix, for fixes that are small by definition, since a large one is `severe`.
- **A third verdict, `no-change`:** neither the spec nor the code changes, for example lint errors already on main.
  Without it, a keeper has to make up an edit to fill the schema.
- **Loop guard: any repeat comes to you, plus a cap in code.**
  - The keeper links a repeated issue to the earlier one (`repeats`), and a repeat becomes a question whatever its
    verdict. Rejected: only a flip, or the docs' second flip. A repeat with the same verdict means the fix didn't take.
  - `KEEPER_FIX_ROUNDS = 2` keeper fix rounds since sign-off, then code fixes come to you as questions. Every fix round
    restarts Check at round 1, so `CHECK_ROUNDS` can't bound this loop, and the `repeats` link is a model's judgment.
  - Your own Change the code answers don't count toward it.
- **The next reviewer verifies keeper fixes, the way it verifies last round's bugs.** It was told not to re-report
  issues already on the card, so an unfixed one would otherwise ship marked fixed. A sent issue becomes `fixed` when a
  round passes.
- **The keeper's instructions are in `roles/spec-keeper.md`, sent at the top of each keeper message.** The session
  keeps the spec writer's system prompt from its first turn (`2026-11-26-worktree-resume-keeper-turn`). `ROLE_TURNS`
  has a `spec-keeper` entry with `KEEPER_SCHEMA`, so the Role prompts page lists it.
- **During keeper turns:**
  - `AskUserQuestion` is refused, since the session's lane is Spec and a question would land in Spec's chat.
  - The keeper's text goes to the chat of the lane the card is in, as "Spec keeper".
  - `Card.judging` holds the turn's kind and issue ids until it succeeds, for Retry and a restart.
- **The report must judge every issue it was given exactly once.** Anything else is a failed turn:
  - In Check it offers Retry and Move on. Move on skips the keeper, and the issues show "Not judged".
  - In Build it offers Retry and Back to Spec. In Try it, Retry.
- **Spec changes are committed alone as `Spec keeper: <title>`,** but not while a merge is unfinished, since git refuses
  a one-file commit then. The edit then goes in with the merge or the next checkpoint.
- **Answering never moves the card.**
  - Keep it as built runs an `answers` turn at once. On a `no-change` issue it runs none.
  - Change the code is held (`held`) until Send to Build, which reuses `POST /feedback` and may now have empty text.
  - Your own words do both: the keeper writes them into the spec without judging, and the developer gets them.
  - Accept and Send to Build wait for the answers.
- **A blocked build gets one keeper turn per Build visit** (`Card.blockJudged`).
  - A `no-change` verdict, or a second block in the visit, falls back to today's Retry and Back to Spec.
  - A blocked report's other issues aren't stored, since the next `done` report lists them again.
- **Back to Spec now works from Check** after a severe verdict, and from any lane it closes every unsettled issue as
  "Settled in Spec". It also withdraws a waiting keeper question.
- **An issue's state is one `status` column** (open, spec-fixed, no-change, sent, fixed, judged, severe, waiting, held,
  kept, settled), not the spec's separate `fix` field. The existing `verdict`, `level`, `reason` and `flips` columns are
  now filled in.
- **A new live event, `issues.updated`,** not in the spec. Judgments and answers land while the card stays in its lane,
  and the page refetches only on a lane change.
- **The bar for an issue** is now in `roles/developer.md`, `roles/reviewer.md` and both schemas' `issues` descriptions:
  report only what would make the keeper change the spec or the code.
- **Known gaps:**
  - Severe offers only Back to Spec and Move on. There's no ■ stopped, and no rethink → Refine, narrow or drop.
  - A severe issue in Try it is asked with Keep it as built / Change the code, which fits "narrow the scope" poorly.
  - Issues on cards already past Check stay unjudged, shown "Not judged".
  - `judged` history events are stored, but no view shows them yet.
  - Try it's Retry line shows for any retryable error last in its chat, not only a keeper's.
- **Verified:**
  - 259 backend tests: 21 new in `keeper.test.ts` and 5 for the routing rules. 233 frontend tests.
  - In a browser, on a scratch database beside the running hive:
    - Try it: the keeper question showed, and Accept and Send to Build were disabled. Change the code was held live,
      Send to Build was enabled with an empty box, and Accept stayed disabled.
    - Check: a severe stop showed Back to Spec and Move on, and Move on put both issues in one question in Try it.
    - No console errors.
- **Not covered:**
  - A real Opus keeper turn: every keeper turn ran on the fake runner.
  - Pressing Send to Build or Keep it as built in the browser, since both start real sessions.
  - A restart during an `answers` turn.
  - Whether the bar actually shortens real developer and reviewer reports.
