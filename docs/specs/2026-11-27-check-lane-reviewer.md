# Check lane: a reviewer per round, and the loop back to Build

The fourth slice takes a built card through Check. When the developer's report is `done`, a reviewer session on Opus
reads the whole branch against main and the spec, and ends with a fixed-format report: the bugs it found, and the
spec issues. A round with bugs sends the card back to the same developer, which fixes them and reports again, and
Check runs its next round. A round without bugs moves the card on to Try it, which shows as not implemented yet.
The developer gets one fix on its own: if the second round still finds bugs, the card stops in Check and waits for
you. The tester, and with it the
spec's How-to-verify checks, come later with the preview service. The `HIVE-MOCK` fake-data marker is dropped from
the design: the hive leaves how to make a mockup to the designer.

## Outcome

**What you get:**

- **Check runs by itself:** a built card goes straight into Check. The card page shows the reviewer's messages as
  it reads, next to the build report.
- **Bugs go back to the same developer:** if the first round finds bugs, the card goes back to Build on its own,
  with main merged in again. The developer is resumed with the bugs, and when it reports `done`, Check runs a
  second round.
- **A clean round moves on:** a round without bugs moves the card to Try it, marked "Not implemented yet". The spec
  issues the reviewer found wait on the card, next to Build's.
- **One fix on its own, then you:** if the second round still finds bugs, the card stays in Check, waiting for you,
  with **Back to Build** and **Move on**.
- **No fake-data marker:** `HIVE-MOCK` is gone from the docs and the developer's instructions. How to make a mockup
  is the designer's call.

**How to verify:**

- **A clean card:** sign off a small spec and let it build. The card enters Check with a note that round 1 has
  started, and the reviewer's activity streams on the page. When the reviewer ends without bugs, the card sits in
  Try it, and its page shows "Round 1: no bugs" above the build report.
- **A bug found:** while a card is in Check, press Stop. Commit a bug by hand on `hive/<card>` that breaks something
  the spec asks for, then press Retry. The new reviewer reports it, and the card goes back to Build. The developer's
  chat says what Check found, and after its report the card is back in Check for round 2.
- **The limit:** with the backend's fake session runner scripted to report a bug every round, the second round
  leaves the card in Check with Back to Build and Move on. Move on takes it to Try it. Back to Build gives the developer
  one more round, and the card stops again if that round finds bugs too.
- **An old card:** a card that was already sitting in Check before this slice shows "Check hasn't started yet" with
  Retry, which starts round 1.
- **No marker left:** `grep -rn HIVE-MOCK` over the repo finds only changelog entries and specs.

## Key decisions

- **A new reviewer session for each round, on Opus** (reuses `ARCHITECTURE.md`, Roles: "Work, new for each round";
  diverges on the model, which the docs give as "Strongest").
  - The new role `roles/reviewer.md` is `model: opus`, `kind: work`, lane `check`.
  - A fresh session means each round is read with fresh eyes. It gets the developer's report, never its working.
  - It's a different session from the developer's, though on the same model. Fable would cost twice as much to read
    one branch.
  - The session is kept, so a turn cut off by a restart can be resumed.
- **The reviewer's report** (reuses the role-report rules: `outputFormat`, and only `structured_output` counts).
  - `status` (`done` / `blocked`), `blockedReason` and `summary`.
  - `bugs[]`, each with `where` (`file:line`) and `problem`.
  - `issues[]`, each with `where` (the spec's section), `problem` and `guess` (what the code does). This is the
    developer's issue shape, stored the same way.

  Only bugs fail a round. This replaces the docs' "findings marked `bug`, `spec-gap` or `extra`": a spec gap and an
  extra are both spec issues for the spec keeper, and the board routes only on bugs.
- **What counts as a bug.** The code doesn't do what the spec clearly says, including something the spec asks for
  that's missing. Or it's broken: a crash, a wrong result, a failing test, a security hole, lost data. Style,
  naming and taste are never bugs. Where the spec is silent, unclear or contradicts itself, or the code does more
  than it asks, that's a spec issue.
- **A failed round goes back through the normal way into Build** (reuses `startDeveloper`).
  - Main is merged again, `Card.build` is cleared, and the same developer session is resumed with the round's bugs.
  - Its `done` report is checkpointed as before, and the card returns to Check for the next round.
  - If the developer thinks a bug isn't one, it leaves the code and ends its summary with the bugs it left and why.
    The next reviewer reports such a bug again only if it still holds after reading that reason.
- **The developer's report describes the whole build** (extends the role's rule: "covers everything since your last
  `done` report").
  - `summary` and `departures` describe the build as it stands now, because each `done` report replaces `Card.build`.
  - `issues` and `decisions` list only what's new since its last `done` report, since they're added to the card's
    tables.
- **Two rounds, then you** (new; diverges from `ARCHITECTURE.md`, Card Moves: "marked ■ stopped, with a card
  waiting for you", until those exist).
  - `CHECK_ROUNDS = 2` lives in `board/moves.ts`. A round counts once its reviewer reports `done`.
  - Round 1's bugs go back to the developer on their own. A second round with bugs keeps the card in Check, needing
    you, with **Back to Build** (one more round, after which it stops again) and **Move on** (to Try it as built).
  - The count starts over when the planner finishes a new plan.
- **A passing round moves straight to Try it** (diverges from `ARCHITECTURE.md`, Card Moves, until the spec keeper
  exists). Its issues wait on the card unjudged, as Build's do.
- **No `HIVE-MOCK`, and mockups are the designer's call** (diverges from `CONCEPT.md`, "The Mockup Becomes the
  Build"). There's no marker search in Check or in Ship's re-run of the checks. The docs stop saying how a mockup is
  built, and with that, that its code becomes the start of the build ("Docs that change", below).

## Goals

- **An independent read before you try it:** every build is read against the spec by a session that didn't write
  it, before it reaches you.
- **One fix without you, then you:** the first round's bugs go back to Build on their own. If the next round still
  finds bugs, whether unfixed or new, you decide.
- **The hive stays out of how mockups are made:** nothing in the hive depends on a mockup's form, so the designer
  can pick it, and the docs stop prescribing one.

## Non-goals

- **The tester:** the spec's How-to-verify checks, screenshots, comparing screens with the mockup, and the preview
  service they need.
- **Local files and project setup:** copying `.env` and local data into the worktree is the next slice. Until then,
  the reviewer is told that a test failing only for a missing local file isn't a bug.
- **Hands-off machinery:**
  - the spec keeper and its batch, so issues stay unjudged;
  - the ■ stopped state and the For you view;
  - the loop guard on single issues.
- **Ship's way back:** a card that Ship sent back returning straight to Ship, since Ship doesn't exist yet.
- **The rest of the Mockup lane:** versions, their worktrees, the ◆ badge and picking a version stay in the docs for
  the Mockup spec to decide. This spec only removes what tells the designer how to build a mockup.
- **The page:** history tabs. Each round is kept as an event, for when they come.
- **Enforcement:** WIP limits are still not enforced, and the reviewer's limits are only in its instructions.

## Design

### Moves

All in `packages/backend/src/board/moves.ts`, each with a test. The reviewer's report is routed by
`laneAfterCheck(report, bugs, round)`, and your two buttons by `laneAfter("check", "back-to-build" | "move-on")`.

| From | Event | To |
| --- | --- | --- |
| Plan | The planner's report is `done` | As before. The card's check rounds start over. |
| Build | The developer's report is `done` | Check, as before, and the reviewer for the next round starts. |
| Check | The reviewer reports `done` with no bugs | Try it. Its issues are stored. |
| Check | `done` with bugs, in round 1 | Build. Its issues and the round's bugs are stored, and the developer is resumed with the bugs. |
| Check | `done` with bugs, in round 2 or later | Stays in Check, needing you, with Back to Build and Move on. |
| Check | The report is `blocked` or missing | Stays in Check, with Retry and Move on. |
| Check | The reviewer is stopped or fails | Stays in Check, with Retry. |
| Check | You press Back to Build | Build, as for a failed round, with the last round's bugs. |
| Check | You press Move on | Try it. |

### A round

1. **The start.** Entering Check calls `startReviewer(cardId)`:
   - It loads the role first. A broken role file gives "Check couldn't start: …" with Retry.
   - It creates a new reviewer session and adds a note to Check's chat: "Round N: the reviewer is reading the branch."
   - N is the last finished round plus one: `(card.check?.round ?? 0) + 1`.
2. **The message.** The reviewer's first message holds:
   - the round, the spec's path, and the instruction to review the whole branch against main (`git diff main...HEAD`);
   - the developer's report: its summary and departures;
   - the spec issues already on the card, so it doesn't report them again;
   - the decisions made without you, which aren't bugs unless they break something;
   - from round 2 on, the last round's bugs, to check that each one is fixed, along with the rest of the branch.
3. **The end.** `laneAfterCheck` routes a `done` report, and everything it decides is stored in one transaction, so a
   restart can't land between storing the round and moving the card:
   - its issues, with `foundIn: "check"`;
   - `Card.check = { round, summary, bugs }`;
   - a `check` event;
   - and one of:
     - **Try it:** the move, and a note "Round N: no bugs."
     - **Build:** the move, the developer session's `lastMessage` cleared, and a note in Check: "Round N found K bugs.
       Back to the developer." After the transaction, `startDeveloper` runs. If the hive stops before it does, the
       card is in Build with no last message, so the restart offers "Build hasn't started yet" with Retry, which
       starts the developer with the bugs.
     - **Stays in Check:** an error line "Round N still found K bugs, and Check stops after 2 rounds. Back to Build
       gives the developer one more round; Move on takes the card to Try it as built." Its actions are
       `back-to-build` and `move-on`.
4. **Stopped, failed, blocked or missing.**
   - "The reviewer was stopped." and "The reviewer failed: …" offer Retry, since these are usually passing problems.
   - "The reviewer couldn't review this: …" and "The reviewer didn't return a report." offer Retry and Move on. A
     reviewer that fails the same way every time would otherwise leave the card with no way out of Check. Move on
     takes it to Try it unreviewed, where you test it yourself.

   Retry starts a new reviewer for the same round: a review is a fresh read, so only the cut-off reading is lost.

Check makes no checkpoint, although the docs commit one at every lane exit. The reviewer changes nothing. Anything
it leaves anyway, such as a test run's output that isn't git-ignored, waits for the next checkpoint: Build's after a
failed round, or Try it's exit once that lane exists. Until then a card can reach Try it with such files uncommitted.

### Back to the developer

`startDeveloper` works out why the card is entering Build from what's stored, so Retry and a restart get it right too:

- `Card.check` holds bugs: the card came from Check. A new plan clears `Card.check`, and a passing round leaves the
  card in Try it, so stored bugs only ever mean that.
- Otherwise, a developer session that exists means a new sign-off.
- Otherwise, it's the first time.

From Check, everything stays as it is (the merge, the report, the `Build: <title>` checkpoint, the move to Check),
and only the message changes:

> Check round N found bugs in the branch. Fix them, then end with your report.
>
> Bringing in main: …
>
> The bugs:
> - `where`: problem
>
> If you think one isn't a bug, leave the code as it is, and end your summary with the bugs you left and why. The
> next round's reviewer reads it.
>
> Your report replaces the card's build report, so its summary and departures describe the whole build as it stands
> now. List only the issues and decisions that are new since your last report.

The last paragraph repeats the developer role's rule, because a session keeps the instructions of its first turn: a
developer that started before the rule existed would never see it otherwise.

Build's chat gets a note: "Check round N found K bugs. The developer is fixing them."

### The role

`roles/reviewer.md` tells the reviewer:

- **Its job:** it's the reviewer for one card in Check, running without the person. It reads the spec and the whole
  branch against main, and ends with its report.
- **Read-only:** it may run the project's tests, type checks and linters, but it changes, creates or deletes no file,
  and never commits.
- **Bugs:** as defined above, each with `file:line` and what's wrong. Only what it would hold up a merge for.
- **Spec issues:** as defined above, with the spec's section, the problem, and what the code does. Not the ones
  already on the card.
- **Disputed bugs:** a bug from the last round that the developer's summary says it left on purpose is reported
  again only if it still holds after reading the developer's reason.
- **Not bugs:**
  - the decisions listed in its message, unless they break something;
  - a test that fails only because a local file such as `.env` or a local database is missing. It says so in its
    summary instead.
- **No questions:** nobody is there to answer. What it would ask goes into a bug or an issue.
- **Blocked:** only if it can't review at all, for example because the spec or the branch can't be read.

The developer's role changes too:
- its "Fake data" line goes;
- its "Your report" line says what the "whole build" decision above says;
- a summary after a fix round ends with any bugs it left on purpose, and why.

### Retry, Stop, restarts and questions

- **Retry in Check** starts a new reviewer for the same round.
- **Stop** interrupts the reviewer, as in every lane.
- **After a restart:**
  - A cut-off reviewer turn is resumed once with "Your last turn was cut off when the hive stopped. Finish the review
    and report", as for the planner and the developer.
  - A card in Check with nothing running, whose last chat line offers no action, gets "Check hasn't started yet."
    with Retry. Nothing starts a review by itself at startup.
- **The reviewer's questions** come straight to you on the card page, as the planner's and developer's do, until the
  manager exists. Its instructions say not to ask.

### Data and API

- **Shared types:**
  - `Bug { where, problem }` and `CheckRound { round, summary, bugs }`;
  - `CardDetail.check: CheckRound | null`;
  - `ChatAuthor` gains `reviewer`, and `ErrorAction` gains `back-to-build` and `move-on`;
  - Check becomes `implemented: true`.
- **Database:**
  - a `cards.check` JSON column: the last finished round, cleared when a new plan is done;
  - issues with `found_in = 'check'`;
  - a `check` event per round.
- **API:** `POST /api/cards/:id/back-to-build` and `POST /api/cards/:id/move-on`. Each is refused unless the card is
  in Check, nothing is running, and the last chat line offers that action.
- **Turns:** `LANE_ROLE.check = "reviewer"` and `turnOptions` gives the reviewer `outputFormat: CHECK_SCHEMA`. The
  spec reviewer's `REVIEWER` constant is renamed `SPEC_REVIEWER`, so the two don't read alike.

### The page

- **Check:** a read-only "Reviewer" chat on the left. On the right, the last finished round sits above the Build
  panel.
- **Build after a failed round:** the developer's chat, with "Check found" (the round's bugs) above the plan.
- **Try it and later**, still "This lane isn't implemented yet": the last round sits at the top of the right column,
  above the Build panel and the plan.
- **`CheckView`** shows "Round N", the reviewer's summary as Markdown, and the bugs with where and what, or "No bugs."
- **The chat** labels the reviewer "Reviewer" and adds the buttons **Back to Build** and **Move on**.

### Docs that change

- **`CONCEPT.md`:**
  - The Mockup row: "A clickable mockup built in the real app, with fake data" becomes a mockup made however the
    designer thinks best.
  - The Build row loses "Replaces the mockup's fake data with the real thing."
  - The Check row loses "Check fails if any fake data is left."
  - "The Mockup Becomes the Build" becomes a short "Mockups" section: how a mockup is made is the designer's call,
    and the approved mockup is the visual reference the tester compares with. Its other lines go with it: Check
    reviewing the whole branch "because the mockup code is never reviewed on its own" (the Check row keeps the whole
    branch), and the spec pointing at mockup code.
  - Ship's step 2 loses "the search for fake data".
- **`ARCHITECTURE.md`:**
  - **Overview and project tree:** "the fake-data marker check" and "marker check" go.
  - **Roles:** the reviewer runs on Opus. The designer may change "Code, in the card's worktree, if its mockup needs
    it".
  - **Role reports:** the reviewer line becomes bugs and spec issues.
  - **Questions:** the reviewer joins the planner and developer whose questions come to you.
  - **Card Moves:** the rows above. The marker leaves the "Check → Build" row, and the round-limit and pass rows note
    that they apply until ■ stopped and the spec keeper exist.
  - **Git:** the Check row goes, and Ship loses the marker search.
  - **Data model:** `Card.check`.
  - **API:** the two new endpoints.
- **`roles/developer.md`:** the two changes above.
- **`docs/mockups/`:** the "No fake data left" line in `CardTryIt.dc.html`, the "fake data marked `HIVE-MOCK`" chip
  in `CardMockup.dc.html`, and the plan step in `CardDone.dc.html` that removes `HIVE-MOCK` markers go.

The changelog entry cites `2026-11-26-ship-squash-then-push`, whose re-run of the checks loses the marker search.

## Alternatives considered

- **A reviewer plus a command-line tester:** it would run the How-to-verify checks now. Rejected: two sessions and
  two reports per round, and a tester starting servers with no preview service to give it a port or stop what's
  left after a restart.
- **A Fable reviewer,** the docs' "Strongest": twice the price of Opus for reading one branch.
- **Keeping `HIVE-MOCK` for a future mockup built in the app:** rejected, because the hive leaves how to make a
  mockup to the designer, and the reviewer would catch a hardcoded value as a bug against the spec anyway.
- **The ■ stopped state for the round limit:** it belongs with the For you view and the manager. A line with two
  buttons covers the same ground until then.
- **More rounds on their own (three or five):** each extra round is another Opus review and developer turn spent
  without you. One fix on its own covers the common case. A second round with bugs comes to you, whether they're
  unfixed or new.
- **A fully fresh reviewer each round:** it would know nothing of the last round's bugs, so a fix could go
  unchecked if it happened to look elsewhere.
- **A fix round's report of only the fixes:** the card's build report would then describe only the last fix, unless
  the page kept every round's report.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: an Opus lead plus a Sonnet page chunk,** as in the Build slice.
- **The lead (Opus 5.5)** builds the backend and settles the shared types first: `moves.ts`, `CHECK_SCHEMA`, the db
  column, `hive.ts` (the round, `startDeveloper` from Check, the two actions, Retry and restarts), the routes,
  `roles/reviewer.md`, the developer's role and the docs.
- **The Sonnet 5.5 subagent** then builds the page against the finished types, in `packages/frontend`: `CheckView`,
  the three layouts in `Card.tsx`, the chat's buttons and labels, the API client, and their tests.
