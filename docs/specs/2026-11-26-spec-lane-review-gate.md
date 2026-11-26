# Spec and Plan lanes: Good, spec writer, review gate, sign-off and planner

The second slice takes a card out of Refine, through Spec and Plan, to the door of Build.
- **Spec:** you say **Good** in Refine, and a spec writer session writes the spec into the card's worktree from the
  brief and the Refine chat. You revise it in chat with the spec writer.
- **Review:** when you think the spec is ready, you press **Review**. A blind reviewer on Fable reads only the spec
  and `review.md`, its fixes are applied and its decisions are put to you.
- **Sign off:** it is enabled only while the spec on disk is the text that review produced. Signing off commits the
  spec on the card's branch and starts the planner.
- **Plan:** the planner is the hive's first hands-off role. It writes the build plan on its own, as a
  fixed-format report. The card then moves to Build, which shows as not implemented yet.

## Outcome

**What you get:**

- **Good:** a Good button in Refine moves the card to Spec. Mockup is skipped. A spec writer opens by writing the
  spec into the card's worktree, and the card page shows the spec next to its chat.
- **Revising:** you change the spec by chatting with the spec writer, and the spec on the page follows every
  change, including edits you make to the file by hand.
- **Review:** a Review button runs a blind Fable review. Its fixes are applied and its decisions come to you as
  questions. Afterwards Sign off is enabled, until the spec changes again.
- **Sign off and plan:** signing off commits the spec on the card's branch and starts the planner. It writes the
  build plan on its own: the steps in order, the chunk each agent owns, the tests, and how each step is checked.
  The card then moves to Build, marked "Not implemented yet".

**How to verify:**

- **Good:** say Good on a card in Refine. It moves to Spec, and the card page shows a spec at
  `docs/specs/<date>-<slug>.md` in the worktree, built from the brief and the chat.
- **Review:** press Review. Sign off stays greyed while it runs. Afterwards the chat says what the review found,
  the spec writer asks its decisions, and once they're answered Sign off is enabled.
- **A change after review:** edit the spec file by hand, or ask the spec writer for a change. Sign off greys out
  with "changed since the review" until you press Review again.
- **Signing off:** sign off. `git log hive/<card>` shows a commit that adds the spec, and the card moves to Plan. A
  plan appears on the card page, then the card sits in Build, marked "Not implemented yet". `git status` in your
  own checkout is still clean.

## Key decisions

- **Review on request, and the end of the review's turn is the reviewed text** (extends the review gate in
  `ARCHITECTURE.md`).
  - Review records the spec's hash and starts the reviewer. Its findings go to the spec writer as one message.
  - The writer applies the fixes, and puts each decision to you with `AskUserQuestion`, using the reviewer's
    options, then updates the spec.
  - When that turn ends, the file's hash is recorded as `reviewedSpecHash`.
  - While the reviewer runs, and while the writer applies the review, you can't send it messages. The only
    exception is answering a question it asks you.
  - The known limit, chosen with Approach A: the answers you give during that turn count as reviewed without being
    read again. So do any edits you make to the file by hand while it runs.
- **The reviewer is a one-off session with a fixed-format report** (reuses the role-report rules). The
  `spec-reviewer` role runs on Fable and isn't kept. It is told only two paths, the spec and `review.md`, and to
  follow `review.md`'s "For the reviewer" part. Its report goes through `outputFormat`:
  - `status` (`done` / `blocked`) and `blockedReason`;
  - `findings[]`, each with `kind` (`decision` / `fix`), `category`, `where`, `stakes` and `options[]`.

  A missing or blocked report is an error line with "Review again", never "nothing to decide".
- **The plan is the planner's report** (reuses the role-report rules). The planner is a hands-off work session
  on Opus. Its report through `outputFormat` is the plan; there is no hive tool and no file in the repo. The
  report holds:
  - `status` (`done` / `blocked`) and `blockedReason`;
  - `steps[]`, each with `title`, `detail`, `chunk` and `check` (how the step is checked);
  - `chunks[]`, each with `name`, `owns` (the files) and `model`;
  - `tests[]`.

  A `done` report is stored as `Card.plan` and moves the card to Build. A blocked or missing report keeps the card
  in Plan with the reason and Retry.
- **The planner's questions come straight to you** (diverges from `ARCHITECTURE.md`, Questions and Permissions,
  until the manager exists). In a hands-off lane, a question should go to the manager ladder, which isn't built.
  The planner's `AskUserQuestion` therefore shows on the card page like a chat lane's question. Its instructions
  tell it to decide for itself where the spec leaves room, and to ask only when the spec contradicts itself or the
  code.
- **The spec is a file in the card's worktree, committed at sign-off** (reuses `ARCHITECTURE.md`, Git: a
  checkpoint commit at each lane exit).
  - The hive picks the path, always `docs/specs/<date>-<title slug>.md`, stores it as `Card.specPath`, and tells
    the writer.
  - Sign off commits only that file on `hive/<card>`. Ship later squashes it with the code, so the spec lands on
    main with the card.
- **The hive reads the spec from disk, never from the session** (new). The backend reads and hashes the file in
  three ways:
  - after every turn;
  - whenever the page fetches the card;
  - on every change, by watching the spec's folder while the card is in Spec.

  Sign off reads the file again at the moment you press it, so a hand edit can never slip through.
- **One chat per lane on the card page** (extends the first slice's chat).
  - Chat rows carry their lane, and the card page shows the current lane's chat. Refine's chat stays stored for
    the history tab. Rows the first slice wrote have no lane, and count as `refine`.
  - `ChatItem.from` gains `spec-writer`, `planner`, and `hive` for the hive's own notes, such as "The review found
    two fixes and one decision".
- **The spec format goes in the spec writer's and the planner's system prompts** (reuses `ARCHITECTURE.md`,
  Roles: "format.md goes to the spec writer and the planner"). The role's instructions plus
  `~/.claude/skills/spec-format/format.md` are appended once, at the first turn. Good is refused with a clear
  message if `format.md` or `review.md` is missing.
- **The spec is rendered as Markdown** (new dependencies). The frontend adds `react-markdown` and `remark-gfm`,
  because specs use headings, lists, tables and code blocks. They're styled with the existing tokens.

## Goals

- **The user-facing path:** carry a card from idea to a signed-off spec, the whole way you're in the conversation.
- **Sign-off is safe:** sign-off is only ever possible on text a blind review read, plus the review's own fixes
  and your answers to its decisions. The docs' review gate works as written.
- **The first hands-off role:** a session that runs without you and hands back a fixed-format report the board
  routes on.

## Non-goals

- **Lanes:** Mockup, which is skipped, and Build. A planned card sits in Build, marked as not implemented yet.
- **Hands-off machinery:**
  - the manager ladder, since the planner's questions come straight to you;
  - the ■ stopped state, since a blocked plan uses Retry instead;
  - the spec keeper.
- **Card moves:** park and drop, and coming back to Spec from Try it. The only way back to Spec is from a blocked
  plan.
- **Spec features:**
  - commenting by selecting text in the spec;
  - choosing a spec location per project;
  - a second review of answers given during the review's own turn.
- **History tabs:** Refine's chat is stored but not shown once the card has left Refine.

## Design

### Moves

| From | Event | To |
| --- | --- | --- |
| Refine | **Good** (`POST /api/cards/:id/good`) | Spec. Mockup is skipped in this slice. |
| Spec | **Sign off** (`POST /api/cards/:id/signoff`), only while the review is fresh | Plan, and the planner starts |
| Plan | The planner's report is `done` | Build, marked as not implemented yet |
| Plan | The report is `blocked` or missing | Stays in Plan, with the reason, Retry and Back to Spec |
| Plan | **Back to Spec** (`POST /api/cards/:id/back-to-spec`) on a blocked plan | Spec. The planner's reason goes to the spec writer, and a new review and sign-off are needed. |

- **Good is refused** while a product owner turn runs or a question waits ("Wait for the product owner to
  finish"). The product owner's session is kept, idle, for Try-it feedback later.
- **Entering Spec:**
  1. The hive sets `Card.specPath` and creates the `spec-writer` session.
  2. It starts the first turn with the idea, the brief and the Refine chat, rendered as "you: …" and
     "product owner: …" lines.
  3. It tells the writer to write the whole spec to `specPath` in one go, following the format in its system
     prompt.

### The spec on disk

- **The `spec` service** in `packages/backend/src/spec/` reads `specPath` from the worktree, hashes it with
  sha256, and works out the review state:

  | State | When |
  | --- | --- |
  | `none` | no review yet |
  | `running` | the reviewer's turn is running |
  | `applying` | the spec writer's review turn is running |
  | `unfinished` | the review turn ended without finishing; Retry re-sends the findings |
  | `fresh` | the hash equals `reviewedSpecHash` |
  | `stale` | the file changed since then |

- **Re-reading:** it re-reads the file after every spec-writer turn, on `GET /api/cards/:id`, and on changes to the
  spec's folder. Entering Spec creates `docs/specs/` in the worktree if it's missing, since `fs.watch` can't watch
  a folder that doesn't exist. It watches while the card is in Spec, debounced, and stops on leaving Spec.
- **Updates:** whenever the text or the state changes, it emits `spec.updated`. Before the writer has written the
  file, the spec is `null`.

### Review

`POST /api/cards/:id/review` checks four things first:
- the card is in Spec;
- the spec file exists;
- no spec-writer turn runs;
- no review is running or applying.

Then:

1. **Start:** record the hash as `H0` and start the `spec-reviewer` one-off in the card's worktree, so it can read
   the code the spec refers to. Its message holds only the spec's absolute path and the path to `review.md`. The
   card is `working`. The reply box is disabled until the review is back, and `POST /api/cards/:id/messages`
   refuses with `409`, so the spec can't change under it.
2. **Report back:** read the file again. If it no longer hashes to `H0`, for example because of a hand edit, drop
   the findings and post a `hive` note: "The spec changed during the review. Press Review again."
3. **No findings:** record `reviewedSpecHash = H0` and post "The review found nothing to change."
4. **Findings:** post a `hive` note with the counts. Then send the spec writer one message listing the findings,
   with these instructions:
   - apply every fix;
   - put every decision to the person with `AskUserQuestion`, offering the reviewer's options. A decision the person
     already settled in this chat is noted in one line, not asked again;
   - write the answers into the spec, and give a rejected suggestion one line in Alternatives considered;
   - change nothing the review didn't raise.

   That turn is marked as the review turn (`Card.reviewApplying`). While it runs, a message is accepted only when
   it answers a question the writer is waiting on. When it ends, the file's hash becomes
   `reviewedSpecHash`, and a note says "You can sign off."
5. **Only a finished review turn counts.** The hash is recorded only when the review turn ends with a result,
   wasn't stopped, and withdrew no question.
   - **A review turn that fails, is stopped or is cut off by a restart** leaves the state `unfinished`. It gets an
     error line with Retry, which re-sends the same findings without a new Fable review.
   - **A message you send instead** abandons the review: the state drops back, and you press Review again later.
6. **A failed reviewer:** a reviewer turn that fails, is stopped or cut off, or returns no report or `blocked`,
   posts an error line with "Review again".

### Sign off

`POST /api/cards/:id/signoff` re-reads the file. It refuses with `409` and the reason in any of these cases:
- no review has run;
- the file doesn't match `reviewedSpecHash`;
- a turn runs.

Otherwise the git service commits only `specPath` on the card's branch: `git add -- <specPath>`, then
`git commit -m "Spec: <title>" -- <specPath>`, run in the worktree. The add is needed because the file is new. If git fails, for example with no identity set, the card stays in Spec with
git's reason. On success:
- the card moves to Plan;
- the folder watch stops;
- the spec writer's session is kept for the spec keeper later;
- the planner starts.

### Plan

1. **Start:** entering Plan creates the `planner` session (work, Opus) and starts its turn in the card's worktree.
   Its message names the signed-off spec's path, and asks for the build plan the spec deliberately leaves out,
   staffed as the spec's Implementation strategy says.
2. **No chat:** the planner runs without you. Plan's card page has no reply box. It shows the planner's text
   blocks and activity line read-only, plus any question it asks you.
3. **A `done` report:** it's stored as `Card.plan` and as a `plan` event, and `plan.updated` is sent. The card moves
   to Build.
4. **A blocked or missing report:** it posts an error line with the reason, and the card stays in Plan,
   `needs-you`, with two ways forward:
   - **Retry** runs the planner's turn again, resuming its session;
   - **Back to Spec** returns the card to the spec writer and sends it the planner's reason as a message. The hive
     clears `reviewedSpecHash`, so the spec needs a new review and sign-off. That sign-off commits the change on
     top of the first, or skips the commit if the file didn't change, and resumes the planner's session with the
     revised spec.
5. **A restart:** a planner turn cut off by a restart is resumed once at startup and told it was cut off, as
   `ARCHITECTURE.md` says for hands-off lanes. If that fails too, it's an error line with Retry.

### Roles

- **`roles/spec-writer.md`** (Opus, conversation):
  - write and edit only the spec at the given path;
  - follow the format;
  - ask with `AskUserQuestion`, never in the reply;
  - when a review's findings arrive, apply the fixes, put the decisions to the person, and touch nothing else.
    A decision the person already settled is noted, not asked again;
  - say when it thinks the spec is ready for review.
- **`roles/spec-reviewer.md`** (Fable, one-off): read the spec and `review.md`, follow "For the reviewer", don't
  change any file, and return the report.
- **`roles/planner.md`** (Opus, work):
  - read the spec and the code, and change nothing;
  - plan the steps in order, which chunk owns which files, the tests, and how each step is checked;
  - decide for itself where the spec leaves room, and ask only when the spec contradicts itself or the code;
  - report `blocked`, with the reason, rather than guess at a plan.

### Session runner

`TurnRequest` gains three optional fields:
- `outputFormat`, whose report comes back on `TurnOutcome`;
- `persist: false`, which maps to `persistSession: false` for one-off sessions;
- `extraInstructions`, used for `format.md`.

`hiveTools` becomes optional.

### Data and API

- **Card:** gains `specPath`, `reviewedSpecHash` (both already in `ARCHITECTURE.md`), `reviewApplying` and `plan`.
- **Shared types:**
  - `CardDetail` gains `spec: { path, text, review } | null` and `plan`;
  - new events `spec.updated` and `plan.updated`;
  - `ChatItem.from` gains `spec-writer`, `planner` and `hive`;
  - `LaneInfo` gains `implemented`. A card in a lane that isn't implemented yet shows "Not implemented yet"
    instead of a badge. After this slice, Ideas, Refine, Spec and Plan are implemented. Each later lane's slice
    turns its own flag on, and the flag goes away once every lane exists.
- **New endpoints:** `good`, `review`, `signoff` and `back-to-spec` under `/api/cards/:id/`. `good` and
  `signoff` are already listed in the docs; `review` and `back-to-spec` are new. The existing `retry` covers a failed turn in any lane.

### The page

- **In Refine:** a **Good** button sits under the chat.
- **In Spec:**
  - the spec writer's chat on the left;
  - the rendered spec on the right, with its path above it, and the brief as a collapsed panel above the spec;
  - a bar with **Review**, **Sign off** and the review state in words:
    - "No review yet"
    - "Review running…"
    - "Applying the review…"
    - "Review not finished: retry"
    - "Reviewed: you can sign off"
    - "Changed since the review"

    Sign off is greyed except in `fresh`, and the reason shows beside it.
- **In Plan:** the planner's read-only notes on the left, with Retry and Back to Spec under a blocked plan's reason.
  On the right:
  - the steps, numbered, each with its chunk and how it's checked;
  - the chunks, each with the files it owns and its model;
  - the tests.
- **In a lane that isn't implemented yet** (Build, after this slice):
  - the card page shows a banner, "This lane isn't implemented yet", with the plan and the spec read-only;
  - the board's tile shows "Not implemented yet" instead of a badge.

### Two chat fixes on the same page

These were owed by the first slice:
- **Enter sends** the reply box. Shift+Enter adds a new line.
- **No events are lost during the first load.** The card page subscribes to the event stream before it fetches
  the card, and holds the events that arrive meanwhile. It applies them once the card has loaded, skipping any
  item the fetch already contains.

### Docs that change with this slice

- **`ARCHITECTURE.md`:**
  - the review gate's trigger (the Review button) and the turn-end rule;
  - the plan as the planner's report;
  - the planner's questions coming to you until the manager exists;
  - the new fields, events and endpoint;
  - lanes not implemented yet are marked as such until their slice lands;
  - the three role files;
  - the frontend's Markdown dependencies.
- **`CONCEPT.md`:** in Where You Come In, Spec gains a sentence on the Review button.
- **`docs/CLAUDE_TODO.md`:** the lines for the two chat fixes are deleted in the same change.

## Alternatives considered

- **Review automatically whenever the spec changes.** Rejected: every small revision would pay for a Fable review,
  and review decisions would keep interrupting while you're still shaping the spec.
- **Sign off triggers the review.** Rejected: you would approve before seeing what the review changed, while the
  docs want sign-off on reviewed text.
- **Keep the spec in the database, like the brief.** Rejected: the spec is a repo document that lands on main
  with the card, and the spec writer edits it with its normal file tools.
- **Stop at Plan and build the planner later.** Rejected by you: building the planner now proves the first
  hands-off role and its fixed-format report.
- **Retry with a note, or accepting the dead end, for a blocked plan** (raised by the review). Rejected: a note
  sent only to the planner leaves the committed spec contradicting itself, and a dead end strands the card.
- **Recording a stopped review turn as reviewed, or starting a new review after one** (raised by the review).
  Rejected: the first blesses half-applied findings, and the second pays for a Fable review that Retry doesn't
  need.
- **A `waiting` card state for a card parked in a lane that doesn't run yet.** Rejected by you in favour of the
  temporary "not implemented" lane marker, which every later slice removes for its own lane.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: the lead plus 1 chunk.** The lead pins the shared types first (`spec`, `plan`, the new events,
  the `from` values and the lanes' `implemented` flag). It then builds the backend:
  - the runner's new options;
  - Good, review and sign-off;
  - the `spec` service with its watch;
  - the git commit;
  - the planner's flow;
  - the three role files and the tests.
- **In parallel, one Sonnet 5.5 subagent builds the frontend** in `packages/frontend/`: the Spec, Plan and Build
  views, the Markdown rendering, the Review and Sign off bar, Good, the chat by lane, and the two chat fixes.
- **Opus 5.5 for the lead, Sonnet 5.5 for the frontend.** The review turn, the reviewed-hash rule and the planner's
  report routing are the parts that need interpreting. The page follows the settled types and the existing card
  page.
