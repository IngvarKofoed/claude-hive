# Send back from Try it, and amendments

Try it's Send to Build is now **Send back**. The spec keeper reads your feedback, and the card goes to Build for a bug,
or to Spec as a numbered **amendment** when it changes the spec, without asking you. The spec writer makes the
amendment and decides on the blind review, the card signs off on its own unless you write in the chat, and the planner
plans only what's left. Check's reviewer and the keeper now see your Try it feedback, so a change you asked for is no
longer undone as a mismatch. Built to `docs/specs/2026-11-28-try-it-send-back.md`.

## Detail
- **Feedback goes to Build or Spec, never to Refine or Mockup** (diverges from CONCEPT as it was; both docs updated).
  The spec writer already holds the Refine chat and the mockup comments.
  - Rejected: amend in place, where the keeper edits the spec and the card skips the Spec lane. It was a third
    destination that wasn't a lane.
  - Rejected: confirming the pick before the card moves. Once an amendment signs off on its own, a wrong pick costs a
    round, not your attention.
  - Rejected: a one-off Sonnet picker. Telling a bug from a change to what you signed off needs the spec writer
    session's reasoning.
- **"Amendment" is back, meaning something else.** `2026-11-28-spec-keeper` dropped the docs' earlier amendment plan,
  which sent keeper code fixes through Plan. This amendment is a round started by your Try it feedback. Keeper code fixes
  still go straight to the developer. The keeper's spec fixes and your own-words answers also add `## Amendments` lines,
  but they aren't rounds.
- **Only Send back makes an amendment.**
  - Back to Spec from Plan, Build or Check outside one is still a full revision with your sign-off.
  - Inside one, Back to Spec stays part of it: `backToSpec` keeps `Card.feedback` and `keeperFixes` then, and runs an
    amendment turn.
- **Two role files ride in the spec writer's session,** as `spec-keeper` does:
  - `feedback-reader` (Try it) and `spec-amender` (Spec);
  - each has a `ROLE_TURNS` entry with its report, `SEND_BACK_SCHEMA` and `AMENDMENT_SCHEMA`;
  - both reports use the codebase's `status` and `blockedReason`, where the spec sketched a single `reason`.
- **The pick is a keeper turn** (`judging: send-back`):
  - It speaks in Try it as the spec keeper, its questions are refused, and it's resumed once after a restart.
  - A failed pick offers Retry, Back to Build and Back to Spec. These reuse the existing error actions:
    `backToBuild` and `backToSpec` accept a Try it card and pass your stored words to `feedback` with a lane.
  - Edit is `DELETE /api/cards/:id/send-back`, a form control, not a lane action.
- **The amendment turn isn't a keeper turn:** it sets no `judging`, and its questions reach the page as Spec chat.
  `Amendment.step` drives the routing:
  - `amending` sends the turn's end, Retry and a restart through the amendment report;
  - `build` picks the amendment's developer message ahead of the plain feedback branch, which the kept
    `Card.feedback` would otherwise win.
- **A skipped review is a review state of its own, `skipped`.** It opens Sign off and leaves Review enabled, so you can
  still ask for a review after taking over.
- **Diffs are embedded, not commands.**
  - The blind reviewer's brief and the planner's message carry `git diff <base> -- <spec>` as text.
  - `base` is the branch's head when the amendment opened, so the keeper's earlier spec commits don't count.
  - The Review button goes through an async `reviewFromPage`, so it can read the diff. `review()` stays synchronous
    for its other callers.
- **An amendment's sign-off commit** is `Spec: <title>, amendment N`.
- **The amendment closes when the card enters Try it.** That covers both ways in: Check's passing round, which moves
  the card itself, and `moveToTryIt`.
- **The reviewer and the keeper see every `feedback` event on the card, oldest first.** A window from the last sign-off
  missed the feedback that started the amendment, since the card had just left Spec.
- **Edit leaves a note in Try it's chat** ("Your feedback is back in the box"). Without it, the failed pick's error line
  stayed last and kept offering Back to Build and Back to Spec, which would send nothing. The browser check found this.
- **The keeper's reading is one paragraph in the chat:** "Spec change: … (why). Bug: … (why)." The chat runs a
  multi-line note into one line.
- **Writing in the chat after a failed amendment turn makes it an ordinary Spec visit.** The amendment leaves `amending`,
  so a review you then start finishes, and you sign off. Without that, the next spec writer turn, even one applying a
  review, was read as the amendment's, and Sign off stayed refused. The code review found this.
- **Known gaps:**
  - Park doesn't exist yet, so "parking ends an open amendment" isn't built.
  - Retry of an amendment turn whose message couldn't be built (a broken `spec-amender.md`) rebuilds it as a Try it
    amendment. After a Back to Spec, the stop reason and the settled issues are lost. Storing the cause on the row would
    fix it.
  - `sendBack` and `amendment` aren't in the live events. The page reloads the card after Send back, Edit and every
    lane change. But the Spec band picks up the amendment's summary only on the next reload; the chat note shows it at
    once.
  - The tester doesn't compare screens with the mockup yet, so "the spec's words win over the mockup" lives only in
    the docs.
  - Ship's reason for sending a card back isn't a `feedback` event, so the reviewer isn't told it (unchanged).
  - Other lanes' histories aren't grouped by amendment; only Try it's lists the rounds.
- **Verified:**
  - 0 type errors. 377 backend tests, 15 of them new in `sendback.test.ts`, covering:
    - the pick to Build and to Spec;
    - a failed pick, with Retry, Back to Spec and Edit;
    - an amendment signing off on its own, with and without a review;
    - an answered question not taking over, and a chat message taking over;
    - a failed amendment turn, chatting after one, and a failed automatic sign-off;
    - Back to Spec inside an amendment, and both restart paths.
  - 393 frontend and 22 shared tests.
  - In a browser, beside the running hive on 4327/5183 with seeded scratch data:
    - the failed pick's line: the words, Retry, Back to Build, Back to Spec and Edit, with Accept greyed;
    - Edit refilling the box and clearing the line;
    - Accept, and Try it's history showing "Amendment 1" as a round;
    - the Spec band, with "Review skipped by the spec writer: you can sign off".
  - No console errors.
- **Not covered:**
  - No real Opus session ran. The pick, the amendment turn and the role files' wording are untested against a model.
  - Pressing Send back, Back to Build or Back to Spec in the browser, since each starts a real session.
