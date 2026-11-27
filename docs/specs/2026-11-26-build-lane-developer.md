# Build lane: the developer builds to the plan

The third slice takes a card from a finished plan, through Build, to the door of Check. When the planner's report
is `done`, the hive merges the latest main into the card's branch. One developer session then builds to the plan in
the card's worktree, in one turn, handing chunks to its own subagents on each chunk's model. It ends with a
fixed-format report: what it built, where it departed from the plan, the spec issues it found, and the decisions it
made without you. The hive commits what's left as a checkpoint, stores the report, its issues and decisions on the
card, and moves the card to Check, which shows as not implemented yet.

## Outcome

**What you get:**

- **Build runs by itself:** a planned card goes straight into Build. The card page shows the developer's messages and
  what it's doing as it works, next to the plan. A question it asks comes to you on the card page.
- **Main comes in first:** the chat says how main was brought in. Any merge conflict is the developer's first job.
- **The result on the card:** when it's done, the card moves to Check, marked "Not implemented yet", and its page
  shows the build report:
  - what was built, and its departures from the plan;
  - the files changed on the branch;
  - the spec issues found, waiting for the spec keeper;
  - the decisions made without you.
- **A way out of a stuck build:** a blocked or missing report keeps the card in Build with the reason, **Retry** and
  **Back to Spec**.

**How to verify:**

- **A real build:** sign off a small spec. After the plan, the card enters Build with a note on how main came in,
  and the developer's activity streams on the page. When it ends, the card sits in Check with the build report.
  `git log hive/<card>` shows the code, `npm test` (or the project's own tests) passes in the worktree, and
  `git status` in your own checkout is still clean.
- **Main comes in:** commit something to main while a card is in Plan. When Build starts, the chat says main was
  merged in with one new commit, and `git log hive/<card>` shows the merge.
- **A blocked build:** a report of `blocked`, or none at all, keeps the card in Build with the reason, Retry and
  Back to Spec. Back to Spec reaches the spec writer with the developer's reason. After a new review and sign-off,
  the planner re-plans and the same developer picks the work up again.
- **An old card:** a card that was already sitting in Build before this slice shows "Build hasn't started" with
  Retry, which starts it.

## Key decisions

- **One turn, one report** (reuses the role-report rules). The developer builds the whole plan in one turn and ends
  with a report through `outputFormat`. Only `structured_output` counts:
  - `status` (`done` / `blocked`) and `blockedReason`;
  - `summary`: what was built, in a few sentences;
  - `departures[]`, each with `step`, `what` and `why`;
  - `issues[]`, each with `where` (the spec's section), `problem` and `guess` (what it did instead);
  - `decisions[]`, each with `what` and `alternative`.

  A `done` report moves the card to Check. A `blocked` or missing one keeps it in Build.
- **The hive merges main into the card's branch each time a card enters Build** (extends `ARCHITECTURE.md`, Git:
  "Build starts: bring in the latest main"). It runs `git merge --no-edit main` in the worktree, and whatever
  happens is told to the developer in its first message, with no separate error path:
  - a clean merge, or main already in;
  - a merge stopped on conflicts, with the files to resolve first;
  - a merge git refused, with git's reason, so the developer brings main in itself.

  Merge, not rebase: a rebase rewrites the checkpoints and replays a conflict once per commit, and Ship squashes
  the branch anyway (`2026-11-26-ship-squash-then-push`).
- **The developer always runs on Opus, as the lead** (extends `ARCHITECTURE.md`, Roles: "As the spec's
  Implementation strategy says").
  - The model is the role file's `opus`, the same on every card.
  - The lead does the Opus chunks itself. Each chunk on another model goes to a subagent through Claude Code's
    Agent tool, with that chunk's model (`sonnet`, `haiku` or `fable`).
  - The lead always merges in main, integrates the chunks, runs the tests and writes the report.
  - The plan's report is unchanged. The developer maps a chunk's model name, such as "Sonnet 5.5", to the Agent
    tool's value itself.
- **A blocked or missing report: Retry and Back to Spec** (extends the blocked plan's way out; diverges from
  `ARCHITECTURE.md`, Card Moves, until the spec keeper exists). The docs have the spec keeper judge a blocking issue
  at once, and the keeper arrives with Check. Until then a blocked build goes back to the spec writer like a
  blocked plan:
  - the partial work is committed as a checkpoint first;
  - the spec writer gets the developer's reason;
  - after a new review and sign-off, the planner is resumed to re-plan, and Build resumes the same developer.
- **The developer's questions come straight to you** (diverges from `ARCHITECTURE.md`, Questions and Permissions,
  as the planner's do). Its instructions tell it to decide where the spec leaves room, note each decision, and ask
  only when it can't go on without an answer.
- **The hive commits a checkpoint when the developer reports** (reuses `ARCHITECTURE.md`, Git: a checkpoint commit
  at each lane exit).
  - It commits everything left in the worktree as `Build: <card title>`, with `git add -A` and `--no-verify`. The
    developer may commit as it goes.
  - It then saves the files changed on the branch against main with the report.
  - `--no-verify` is there because a checkpoint is never what lands on main. A project's pre-commit hook mustn't be
    able to stop a lane exit, and Ship runs the project's checks on the squash.
  - **A checkpoint is never committed over an unfinished merge,** because `git add -A` would conclude it with the
    conflict markers still in the files.
    - A `done` report while a merge of main is unfinished counts as not done.
    - Back to Spec aborts the merge first, since the next Build entry merges main again.
- **Spec issues and decisions get tables of their own** (new; `ARCHITECTURE.md`, Data model: Issue and Decision).
  Each issue is stored with its lane, `where`, `problem` and `guess`. Its verdict, level and reason stay empty until
  the spec keeper judges it. Each decision is stored with its lane, `what`, `alternative`, the deciding session and
  its source (`developer`).
- **Build's chat is read-only** (reuses the Plan lane's chat). There's no reply box. You answer the developer's
  questions, press Stop, and Retry a failed turn.

## Goals

- **Code gets written:** the first lane where the hive changes the project's code. It runs without you and leaves
  a report the board routes on.
- **Nothing found is lost:** every spec issue and decision from Build is stored on the card, ready for the spec
  keeper's batch and for Try it.
- **The branch is always whole:** the card leaves Build with its work committed on `hive/<card>`, on top of the
  latest main.

## Non-goals

- **Lanes:** Check and everything after it. A built card sits in Check, marked "Not implemented yet". Mockup is
  still skipped.
- **Hands-off machinery:**
  - the spec keeper, so issues are stored but not judged;
  - the manager ladder, so the developer's questions come to you;
  - the ■ stopped state, since a stuck build uses Retry and Back to Spec instead;
  - round limits and the loop guard.
- **Project setup:** the setup command and copying local files such as `.env` into the worktree. The developer is
  told to install dependencies itself if they're missing.
- **The page:**
  - a diff viewer, since the page lists the changed files and the code is in the worktree;
  - live progress through the plan's steps;
  - the "commits behind main" count;
  - history tabs.
- **Fetching:** main is the local `main` the worktree was made from. Fetching from a remote is Ship's business.
- **Enforcement:** WIP limits are still not enforced, and the developer's limits are still only in its
  instructions.

## Design

### Moves

All in `packages/backend/src/board/moves.ts`, each with a test:

| From | Event | To |
| --- | --- | --- |
| Plan | The planner's report is `done` | Build, and the developer starts (already Build; the start is new) |
| Build | The developer's report is `done`, and no merge of main is unfinished | Check |
| Build | The report is `blocked` or missing, or the turn failed or was stopped | Stays in Build with the reason and Retry, plus Back to Spec for `blocked` or missing |
| Build | You press **Back to Spec** | Spec, after a checkpoint commit of the partial work |
| Spec | You sign off a card that has a developer | Plan; the planner is resumed, and a `done` plan resumes the developer |

`laneAfterBuild(report)` joins `laneAfterPlan`. `laneAfter(from, "back-to-spec")` accepts Build as well as Plan.

### Starting the developer

`onPlannerEnded` with a `done` plan moves the card to Build, then calls `startDeveloper(cardId)`:

1. **Bring in main.** `git.mergeMain(worktree)` returns one of `clean` (with how many commits came in, possibly 0),
   `conflict` (with the files), or `failed` (with git's reason). A merge already in progress is reported as
   `conflict` without running a new one. The result becomes a hive note in Build's chat:
   - "Brought in main: 3 new commits." or "Main was already in."
   - "Bringing in main stopped on conflicts in a.ts, b.ts. The developer resolves them first."
   - "Bringing in main failed: … The developer was told to bring it in itself."
2. **Start or resume the developer.** A card's first Build creates the `developer` session. A card that has one
   already resumes it. The message gives:
   - the spec's path;
   - the plan as text: the steps with their chunk and check, the chunks with their files and model, and the tests;
   - the merge result, with what to do about it;
   - on a resume, that the spec and plan were revised and signed off again, and to bring the work in line with
     them.

A role file that fails to load leaves an error line in Build with Retry. **Retry on a card whose developer has had no
turn yet** calls `startDeveloper` again, which brings in main afresh. That covers a card with no developer session,
and a session created before its first message failed to start. Any other Retry re-sends the last message, as it
does today.

### The developer's report

`DEVELOPER_SCHEMA` and `parseDeveloperReport` join `spec/reports.ts`, following `PLAN_SCHEMA`. When the turn ends:

- **`done`:**
  1. the hive stores the report on `Card.build`, and adds the issues and decisions to their tables;
  2. it commits the checkpoint;
  3. it reads `git diff --numstat main...HEAD` in the worktree, so the file list covers the whole branch against
     main, spec included, and adds that list to the stored report;
  4. it moves the card to Check.

  The report is stored first, so nothing in it is lost if git refuses the checkpoint. A refused checkpoint keeps
  the card in Build with git's reason and Retry. That Retry redoes only steps 2–4, and the developer isn't run again.
- **`done` over an unfinished merge** (the worktree still has `MERGE_HEAD`): "The developer reported done, but the
  merge of main isn't finished.", with Retry and Back to Spec. Nothing is stored. The next `done` report covers this
  work too.
- **`blocked`:** "The developer couldn't build this: <reason>", with Retry and Back to Spec.
- **Missing:** "The developer didn't return a report.", with Retry and Back to Spec.
- **Failed or stopped:** an error line with Retry. Retry re-sends the turn's last message, as it does today.

The developer's role tells it that a report covers everything since its last `done` report. A blocked turn, a
retried turn and a resumed one are all the same piece of work, and the session remembers its own earlier reports.

### Back to Spec from Build

`backToSpec` accepts a card in Build whose last line offers Back to Spec. If a merge of main is unfinished, it runs
`git merge --abort` first, and the next Build entry merges main again. It commits the partial work, then sends
the spec writer: "The developer couldn't build from the signed-off spec. What it reported: …". The rest is the
existing path: the reviewed hash is cleared, so a new review and sign-off follow. `startPlanner` already resumes
the planner. The plan it reports goes to `startDeveloper`, which resumes the same developer with the revised spec and
plan.

### Restarts

- **A cut-off developer turn** is resumed once at startup, as the planner's is: "Your last turn was cut off when the
  hive stopped. Carry on building to the plan, then report." A start that fails leaves an error line with Retry.
- **A card in Build with no developer session**, such as one planned before this slice, gets one error line: "Build
  hasn't started yet." with Retry, which calls `startDeveloper` (see Starting the developer). Nothing starts
  a build on its own when the hive starts, since that would spend a long Opus turn without anyone asking.

### The role

`roles/developer.md` (`model: opus`, `kind: work`). The instructions:

- **The job:** you're the developer for one card, in Build. Build to the plan in this worktree, and stay in it.
  Change code; don't push, and don't touch main or any other branch.
- **Where you are:** start every turn with `git status`. A merge note in an earlier message may be out of date.
- **Merging:** if the message says the merge stopped on conflicts, resolving them and committing the merge is the
  first job.
- **Chunks:** you're the lead, on Opus. Do the Opus chunks yourself. Give each chunk on another model to a subagent
  through the Agent tool, with that model and the files the chunk owns. Run chunks that own separate files in
  parallel where the plan allows. Subagents never commit; you integrate their work.
- **Tests:** write the tests the plan lists, and run the project's tests before you report. If dependencies are
  missing, install them the way the project's README or CLAUDE.md says.
- **Spec issues** (the spec is silent, unclear or contradicts itself; it doesn't fit the code; something is missing,
  different or extra): note it, make your best guess, and keep going. Report it with your guess.
- **Decisions:** decide wherever the spec leaves room, and report each decision with the alternative you didn't take.
  Ask with `AskUserQuestion` only when you can't go on without an answer.
- **Blocked:** if the spec can't be built as written in this codebase, report `blocked` with the reason. Never fill
  the report with a guess.
- **Leftovers:** everything left in the worktree is committed when you report, so leave nothing you don't mean to
  keep.
- **Fake data:** replace any fake data marked `HIVE-MOCK` with the real thing, and add none.

### Data and API

- **Shared types:**
  - `BuildReport { summary; departures: Departure[]; files: FileChange[] }`;
  - `Departure { step; what; why }`;
  - `FileChange { path; added: number | null; removed: number | null }`, where null means a binary file;
  - `SpecIssue { id; foundIn: Lane; where; problem; guess }`;
  - `Decision { id; lane: Lane; what; alternative; source: string }`.
- **`CardDetail`** gains `build: BuildReport | null`, `issues: SpecIssue[]` and `decisions: Decision[]`.
  `ChatAuthor` gains `developer`. Build's `implemented` turns on.
- **SQLite:**
  - a new `build` column on `cards` (the report, as JSON);
  - an `issues` table: id, card_id, found_in, spec_section (the type's `where`, a reserved word in SQL), problem,
    guess, and verdict, level, reason and flips, empty
    for now;
  - a `decisions` table: id, card_id, lane, what, alternative, session_id, source.

  All three are created on an existing database when it opens.
- **The git service** gains:
  - `mergeMain(worktree)`;
  - `mergeInProgress(worktree)` and `abortMerge(worktree)`;
  - `commitAll(worktree, message)`, which returns false when there's nothing to commit;
  - `changedFiles(worktree)`, the numstat against main.
- **No new events or routes.** The report lands as the card changes lane, and the page already refetches on a lane
  change. Back to Spec and Retry use the routes that exist.

### The page

- **Build:** a Developer panel with the read-only chat (messages, activity, questions, error lines with Retry and
  Back to Spec), next to the Plan panel.
- **Check and later lanes** ("Not implemented yet"): the spec and plan panels as today, plus a **Build** panel
  with four parts:
  - the summary, and the departures (step, what, why);
  - the files changed, each with its added and removed lines;
  - "Spec issues, waiting for the spec keeper", each with where, the problem and the developer's guess;
  - "Decided without you", each with what was decided and the alternative.

  Empty parts say "None."

### Docs that change with this slice

- **`ARCHITECTURE.md`:**
  - Roles: the developer runs on Opus as the lead, with each chunk on its own model through subagents;
  - Card Moves: Build's blocked and missing rows, and Back to Spec from Build (marked as standing in until the spec
    keeper);
  - Git: Build start is a merge, conflicts go to the developer, and lane-exit checkpoints use `--no-verify` and are
    never committed over an unfinished merge;
  - Data model: `Card.build`, and Issue's `where`, `problem` and `guess`.
- **`CONCEPT.md`:** Build's row mentions main coming in first.

## Alternatives considered

- **One turn per plan step, driven by the hive.** It gives exact progress and finer recovery. Rejected: the hive
  would coordinate the build, which the docs give to the developer, chunks couldn't run in parallel, and every step
  would need its own failure path.
- **Live hive tools (`step_done`, `note_issue`, `note_decision`).** These would tick the plan off live and keep
  findings if a turn dies. Deferred: they can be added on top of the one report without undoing anything.
- **Rebasing onto main at Build start.** Rejected, for the reasons in `2026-11-26-ship-squash-then-push`.
- **Refusing Back to Spec while a merge of main is unfinished.** Rejected: a developer blocked on the conflict
  itself would leave the card stuck in Build. Back to Spec aborts the merge instead.
- **Committing over an unfinished merge and leaving it to Check.** Rejected: the conflict markers would sit on the
  branch, and the next Build would think main was already in.
- **Running the session on the strongest model the plan names.** A plan of one Sonnet chunk would then be built by a
  Sonnet session. Rejected for one lead that's the same on every card: the lead merges, integrates, tests and
  reports on every build.
- **Sending the developer back once to commit or delete leftover files.** Rejected: it costs a turn and adds a
  failure path, and Check reviews the whole branch anyway.
- **A diff viewer on the card page.** Deferred: it's a component of its own, and the changed-files list plus the
  worktree cover this slice.
- **Stopping the card on a blocking issue until the spec keeper exists.** Rejected: there's no way out of ■ stopped
  yet, and Back to Spec already exists for plans.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: the lead plus 1 chunk.** The lead settles the shared types first, then builds the backend: moves,
  `hive.ts`, the git service, reports, DB, and the role file. In parallel, once the
  types are settled, a subagent builds the page: the Build lane view and the Build panel in
  `packages/frontend/src/pages/Card.tsx` and new components.
- **Opus 5.5 lead, Sonnet 5.5 for the page.** The backend interprets the `(diverges)` and `(new)` decisions; the page
  renders settled types.
