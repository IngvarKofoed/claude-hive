# Worktree setup and Try it: a card you can run, accept or send back

The fifth slice makes a card's worktree run like your own checkout, and builds Try it on top of that. When a card
enters Refine, a setup session on Sonnet starts in the background. It picks the git-ignored local files the app needs
from your checkout, such as `.env` files and local databases, and the hive's code copies them. It installs
dependencies, and works out how to start the app and run its tests on the card's own ports. Build and Check use what
it found. A card that passes Check lands in Try it, where the page tells you how to start it, gives you the spec's
Outcome as a test guide, and offers **Accept** (on to Ship) and **Send to Build** (your words to the same developer).
When a card leaves Build, Check or Try it, whatever is still listening on its ports from inside its worktree is
stopped. The hive still doesn't
start the app for you: that's the preview service, later.

## Outcome

**What you get:**

- **The worktree is set up while you chat:** a card entering Refine gets a background setup. It copies the local
  files the app needs, installs dependencies, and finds how to start the app and its tests on the card's own ports.
  The Refine chat lists what was copied and left out, and anything the worktree still shares with your checkout.
- **Build and Check run things the same way:** the developer and the reviewer are told the card's ports and the
  start and test commands.
- **Try it shows how to try the card:**
  - the commands to start it in the worktree, and the address to open;
  - the spec's Outcome as your test guide;
  - Check's last round, the build report, the spec issues, and the decisions made without you.
- **Accept or send it back:** **Accept** moves the card to Ship, marked "Not implemented yet", where **Back to Try it**
  brings it back until Ship is built. **Send to Build** takes your words to the same developer. Check then runs again
  from round 1, and the card comes back to Try it.
- **Servers stop when the card moves on:** when a card leaves Build, Check or Try it, anything still listening on its
  ports from inside its worktree is stopped, whether you started it or a session did. Your own copy, and any other
  program, is never touched.
- **Set up again:** Try it can run the setup again at any time, for example after you add a local file to your
  checkout.

**How to verify:**

- **A new card:** in a project with a git-ignored `.env` and a local database, drag an idea to Refine. While you chat
  with the product owner, a note says the worktree is set up and lists what was copied (the `.env`, the database)
  and left out (`node_modules`, `dist`). The files are in the worktree, `git status` in your checkout is unchanged,
  and the card's badge follows your chat, not the setup.
- **Run it beside your own copy:** with your own copy of the app running, start the card's app in its worktree with
  the commands Try it shows. It comes up on the card's port, and your copy keeps running on its usual one.
- **Send to Build:** with the card's app running from Try it's commands, write a bug and press Send to Build. The
  card's app stops, and your own copy keeps running. The developer's chat shows your words. After its report, Check
  runs round 1, and the card comes back to Try it.
- **Accept:** the card moves to Ship, marked "Not implemented yet". Back to Try it returns it.
- **An old card:** a card in Try it whose worktree was made before this slice shows "Set up the worktree". Pressing
  it runs the setup, and the page then shows how to start the card.

## Key decisions

- **A setup session per card, on Sonnet** (new; extends `ARCHITECTURE.md`, Git: "Card enters Refine … then the
  project's setup").
  - The new role `roles/setup.md` is `model: sonnet`, `kind: work`. Each setup run is a new session.
  - It picks the files, installs dependencies, and works out how to run the app on the card's ports.
  - Rules in code were measured on 11 of your repos. They sorted junk from data well, but they can't work out ports or
    how to start an app. A per-project list would need a settings page there isn't.
- **The hive's code lists and copies; the session only chooses** (new; reuses the `write_brief` pattern: a hive
  tool in the in-process `hive` MCP server).
  - **Listing:** code runs `git ls-files --others --ignored --exclude-standard --directory` in your checkout and drops
    obvious junk by name: dependencies, build output, caches, logs, OS and editor junk, `.claude/` and
    `.playwright-mcp/`. The session gets the rest, with sizes.
  - **Copying:** the session calls `copy_local_files(paths)`, and the hive's code copies:
    - only git-ignored paths inside your checkout, never `.git` or `.claude/worktrees`;
    - never over a file the worktree already has. A folder is copied file by file, so setting up again adds the files
      that are new and leaves the rest;
    - a symlink as a link, never following it;
    - as copy-on-write clones where the disk supports them (`cp -c` on APFS), so a big data folder costs no space;
    - changing nothing in your checkout.

    Auto mode never sees a session copying secrets, because the session never copies anything itself.
- **Each card gets a block of 10 ports** (new; `ARCHITECTURE.md`, Data model: `Card.port`).
  - The block comes from 5200–5999, isn't used by another card, and all 10 ports are checked free when it's assigned.
  - A card keeps its block until it reaches Done or is parked, and neither exists yet. The range holds 80 blocks.
    With none free, setup ends as `failed` with that reason.
  - The setup session works out how to start the app and tests on those ports through environment variables or
    flags, never by editing tracked files. Where the project's `CLAUDE.md` says how to run a second copy, it follows
    that.
- **The setup's report** (reuses the role-report rules):
  - `status` (`done` / `blocked`) and `blockedReason`;
  - `installed`: what it ran to install dependencies;
  - `start[]`, each with `what`, `command` and `url`;
  - `test`: how to run the tests;
  - `shared[]`: what the worktree still shares with your checkout, such as a server database, a port it couldn't move,
    or a Docker container;
  - `notes`.

  The hive adds what it really copied, from the tool calls, and what was left out. All of it is stored as
  `Card.setup`.
- **Setup runs in the background and never holds you up** (new).
  - It isn't the card's running turn: the badge, Stop and the reply box ignore it, except while Build waits for it.
    Then the badge shows working, and Stop ends it.
  - It's stopped after 10 minutes, so an install prompt or a server that never returns can't hang it.
  - Its result is a note in the chat of the lane the card is in.
  - Its questions are refused, since nobody is there to answer them.
  - A failed setup is only a note. The card goes on, and the developer installs what it needs itself, as today.
- **Build waits for setup** (extends `startDeveloper`).
  - A setup still running is waited for. A stopped or timed-out setup counts as failed, so Build goes ahead.
  - A worktree with no setup yet (made before this slice) gets one first, once. A failed setup isn't run again: Build
    goes ahead.
  - The developer's and the reviewer's messages carry the card's ports and the setup's start and test commands.
- **Servers on the card's ports stop when it leaves Build, Check or Try it** (new; diverges from `ARCHITECTURE.md`,
  Preview service: "only ever stops those processes" it started).
  - The hive looks up what's listening on the card's 10 ports (`lsof -iTCP:<port> -sTCP:LISTEN`). It keeps only the
    processes whose working folder is inside the card's worktree (`lsof -a -p <pid> -d cwd`).
  - It sends each one SIGTERM, then SIGKILL after 5 seconds if it's still there.
  - Both tests together mean it was started for this card: by you, from Try it's commands, or by a session told to
    use those ports. A program that later took one of the card's ports, such as Postgres on 5432, is left alone, and
    so are your own copy and your shell.
  - A note in the lane being left names what was stopped, e.g. "Stopped what was running on 5210 and 5211."
  - The stop happens before the next lane's work starts, so the developer's tests don't meet a stale server of the
    card's own.
- **Try it has no session** (diverges from `CONCEPT.md`'s "app already running" and "test guide ready", until the
  preview service and the spec keeper exist). The page shows how to start the card, the spec's Outcome as the test
  guide, and the work so far. **Accept** goes to Ship; **Send to Build** goes to the developer. Until Ship is built,
  a card in Ship offers **Back to Try it**, so a misclick or a bug you notice late doesn't strand it.
- **Your feedback goes to the same developer, and Check starts over** (extends the way back from Check).
  - In one transaction, the move clears `Card.build` and `Card.check`, stores your words as `Card.feedback`, and
    clears the developer's last message.
  - `startDeveloper` looks for feedback first, and its `done` report clears it. Back to Spec from Build clears it
    too: the developer's reason already carries it to the spec writer, and after the new sign-off the developer must
    get the new plan, not the old feedback.
  - Check then runs from round 1. Clearing `Card.check` also closes the known gap where old Check bugs outlived
    Move on.

## Goals

- **A card you can run:** its worktree behaves like your checkout, with your local files and its own ports, without
  stepping on your copy.
- **The loop closes at you:** you try the card and either accept it or send it back, from its page.

## Non-goals

- **The preview service:** the hive starting and stopping the app, screenshots, and the `Process` table. You start
  the app yourself with the commands Try it shows.
- **Feedback about the what or the look:** sending a card back to Refine or Mockup through Spec, and the hive picking
  the lane for you. Only Build is offered.
- **Try it's other parts:** a written test guide, "what the checks covered", and the spec keeper's questions.
- **Ship:** Accept leaves the card in Ship, marked "Not implemented yet", with Back to Try it as its only way out.
- **Project settings:** `localFiles` and `setupCommand` aren't built. The setup session replaces them.
- **Keeping copies fresh:** a file is never copied over. Setting up again copies files that are new in your checkout,
  but a `.env` you changed there doesn't reach a worktree that already has one.
- **Processes that don't listen on a port:** file watchers and test runners left behind aren't stopped. Only what
  listens on the card's ports is.
- **Isolating server databases and Docker:** the setup reports them as shared, and nothing more.

## Design

### Moves

All in `packages/backend/src/board/moves.ts`, each with a test. Your buttons are `laneAfter("tryit", "feedback")`,
`laneAfter("tryit", "accept")` and `laneAfter("ship", "back-to-tryit")`.

| From | Event | To |
| --- | --- | --- |
| Ideas | You drag the card | Refine, as before. The card gets its ports, and setup starts in the background. |
| Plan, Check | The card enters Build | Build, as before, after waiting for a setup that's running, or running one first if the worktree has none |
| Try it | You press **Send to Build** with your words | Build. Main is merged in again and the same developer is resumed with your words; Check then starts from round 1. |
| Try it | You press **Accept** | Ship |
| Ship | You press **Back to Try it** (until Ship is built) | Try it |
| Build, Check, Try it | The card moves to any other lane | That lane, after stopping what listens on the card's ports from inside its worktree |

### Setup

1. **The start.** `startSetup(cardId)` runs from three places:
   - when the worktree has been created, after Refine's first turn starts;
   - at Build entry, for a worktree with no setup;
   - from Try it's **Set up the worktree** or **Set up again** button.

   It does four things:
   - gives the card its port block if it has none;
   - lists the candidates with their sizes;
   - creates a new setup session;
   - sets `Card.setup = { status: "running" }`.
2. **The message** holds:
   - your checkout's path and the worktree's;
   - the card's ports;
   - the candidate list, `path (size)` per line;
   - a one-line count of what code already left out, e.g. "Left out: node_modules/, dist/ and 9 more".
3. **The tool.** `copy_local_files({ paths })` returns a line per path: `copied`, `kept (already in the worktree)`,
   or `refused: <why>` (tracked by git, outside the checkout, not found). The hive records each `copied` path.
4. **The end.** A `done` report becomes `Card.setup` with `status: "done"`. A note in the card's current lane says:
   "The worktree is set up. Copied: .env, data/. Left out: node_modules/, dist/ and 3 more. Shared with your checkout:
   …". A blocked, missing, stopped or failed setup becomes `status: "failed"` with the reason, and the note says:
   "The worktree's setup didn't finish: … The developer installs what it needs itself."
5. **After a restart:** a cut-off setup turn is resumed once, like the other hands-off roles. A turn cut off before
   its session existed is sent its first message again.

Setup turns go through `startTurn` like any other turn, but `anyTurnRunning`, the card's state and Stop leave them
out, and their text isn't shown in the chat. While Build waits for one, it counts as the card's running turn: the
badge shows working, and Stop interrupts it. A setup turn still running after 10 minutes is interrupted. A stopped or
timed-out setup is `failed` like any other. Two cards' setups may run at the same time.

### Build and Check

- **Waiting:** when `startDeveloper` finds `Card.setup` running, it adds a note ("Build waits for the worktree's
  setup. Stop ends it, and Build goes ahead.") and returns. When the setup ends, if the card is in Build and its developer hasn't started this visit, it
  calls `startDeveloper` again. A card with no setup at all gets one started, then waits the same way.
- **The messages:** the developer's and the reviewer's messages always gain a "Running things in this worktree" part
  with the card's ports, so even after a failed setup nothing runs on the project's default ports. While
  `Card.setup` is `done`, the part also has the start and test commands and what's shared.
- **The roles:**
  - The developer is told to use those commands and ports.
  - The reviewer's line about a missing local file becomes: a test that fails only because a local file the setup
    didn't copy is missing, a port is in use, or a service isn't running, isn't a bug.
  - Both are told that an end-to-end setup which reuses a server already on its port (Playwright's
    `reuseExistingServer`) may be testing your checkout's app.

### Try it

- **The page:** a "Try it" panel on the left, and on the right Check's last round, the Build panel and the plan. The
  panel holds:
  - **How to start it:** the worktree path, each start command with its address, the test command, and what's shared
    with your checkout. With no finished setup, it shows "This worktree hasn't been set up." and a **Set up the
    worktree** button. After one has finished, a **Set up again** button runs it again. Either way, it shows
    "Setting up…" while one runs.
  - **Test guide:** the spec's `## Outcome` section, cut from the spec's text and rendered as Markdown. If the spec has
    no such section, it says so.
  - **Send to Build:** a text box and its button.
  - **Accept:** a button.
- **Send to Build:** after the transaction (see Key decisions), `startDeveloper` runs. Its message:

  > You tried the card's build and found this: <your words>. Fix it, then end with your report.
  >
  > Bringing in main: …
  >
  > `git status` may show files left from trying the app. Remove what doesn't belong before you report.

  It's followed by the "whole build" paragraph that Check's fix rounds send. A note in Build's chat quotes your words.
- **Accept** moves the card to Ship and records an `accept` event. Ship's "Not implemented yet" page shows **Back to
  Try it**, which moves the card back without a session.
- Both buttons are refused unless the card is in Try it and nothing runs. Send to Build is also refused when your
  text is empty.

### Data and API

- **Shared types:**
  - `SetupReport` with `status` (`running` / `done` / `failed`), `reason`, `copied`, `leftOut`, `installed`,
    `start[] { what, command, url }`, `test`, `shared` and `notes`;
  - `CardDetail.setup: SetupReport | null`, `CardDetail.port: number | null` (the first of its 10) and
    `CardDetail.feedback: string | null`;
  - Try it becomes `implemented: true`.
- **Database:** `cards.setup` (JSON), `cards.port` and `cards.feedback`, plus `setup`, `feedback` and `accept`
  events.
- **API:**
  - `POST /api/cards/:id/feedback { text }`, already in the docs with an optional `lane`, which only accepts `build`
    for now;
  - `POST /api/cards/:id/accept`, already in the docs;
  - `POST /api/cards/:id/back-to-tryit`, new until Ship is built;
  - `POST /api/cards/:id/setup`, new, refused while a setup runs.
- **Git service:** `listLocalFiles(root)` (the candidates with their sizes, junk left out) and
  `copyLocalFiles(root, worktree, paths)` (the guarded copy). Both are tested on a throwaway repo.
- **Ports:** `assignPorts()` (a free block of 10) and `stopListeners(ports, worktree)` (SIGTERM, then SIGKILL, only
  for listeners whose working folder is inside the worktree), in a new `packages/backend/src/preview/` folder, where
  the preview service will later grow. A test starts a throwaway listener in a temporary folder and checks that it
  stops, and that one started elsewhere on the same port range doesn't.

### The setup role

`roles/setup.md` tells the session:

- **Its job:** make this worktree run like the person's checkout, without stepping on it.
- **Picking files:** from the list, pick what the app or its tests need and can't regenerate: `.env` files, local
  databases with their `-wal`/`-shm` files, dev data, and local config. Leave out backups, generated files, and
  anything that a build or install recreates. Copy only through `copy_local_files`.
- **Dependencies:** install them the project's own way, from its `CLAUDE.md`, README or manifests.
- **Running:**
  - Work out how to start the app and run its tests on the card's ports, through environment variables or flags
    only. Follow the project's `CLAUDE.md` where it says how to run a second copy.
  - Check a command by starting it briefly, then stop everything it started.
  - Never edit a tracked file, and never commit.
- **Shared:** report anything the worktree still shares with the checkout.
- **No questions:** nobody is there to answer them.
- **Blocked:** only if nothing can be done, for example because the checkout can't be read.

### Docs that change

- **`CONCEPT.md`:**
  - **Worktrees:** setup is a session that picks the local files and finds how to run the app on the card's own
    ports.
  - **Try it:** a line saying that until the preview service exists, you start the app with the commands shown.
- **`ARCHITECTURE.md`:**
  - **Roles:** a `setup` row: Refine, Sonnet. It may change only git-ignored local files, through the hive's tool,
    and dependencies, never tracked files. It's a work session, new for each run.
  - **Sessions:** `copy_local_files` joins `write_brief` among the hive's tools.
  - **Card Moves:** the rows above.
  - **Questions:** the setup's questions are refused.
  - **Git:** the "Card enters Refine" row describes the setup session.
  - **Data model:** `Card.setup`, `Card.feedback` and the port block. `Project.localFiles` and `setupCommand` go;
    `runCommand` and `testCommand` stay for the preview service and Ship to decide.
  - **API:** `POST /api/cards/:id/setup`.
  - **Preview service:** besides what it started, the hive stops what listens on a card's ports from inside its
    worktree when the card leaves Build, Check or Try it.
  - **Card Moves:** Ship's Back to Try it, until Ship is built.
  - **Risks:** item 2 notes what setup now covers.
- **`roles/developer.md` and `roles/reviewer.md`:** the "Running things" lines above.

## Alternatives considered

- **Rules in code only:** measured on 11 of your repos. They kept out every dependency and build folder and copied
  every `.env`, database and data folder, but they can't work out ports or how to start the app.
- **A list per project:** predictable, but it needs a project settings page, and you'd still have to sort out ports.
- **Two ports or one per card:** a third process, such as a test server beside a backend and a frontend, would clash.
- **Running setup at the first entry to Build:** simpler, since nothing runs beside your Refine chat, but it adds its
  minutes to Build.
- **Stopping by folder alone,** every process running inside the worktree: it would catch file watchers too, but also
  your shell or editor opened there.
- **Stopping by port alone:** a program that later takes one of the card's ports, such as Postgres on 5432, would be
  killed.
- **The session copying files itself:** auto mode blocks a session copying secrets by hand (feature-flow's
  experience), and a hive tool keeps the guards in code.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: an Opus lead plus 2 chunks.**
- **The lead (Opus 5.5)** first settles the shared types and the git service's two signatures. It then builds the
  rest of the backend:
  - `startSetup` and its background handling;
  - the port block and stopping its listeners;
  - the `copy_local_files` hive tool;
  - Build waiting for setup;
  - Try it's moves, the feedback path and `startDeveloper`'s reasons;
  - the roles and the docs.
- **In parallel, on Sonnet 5.5:**
  - one subagent builds `listLocalFiles` and `copyLocalFiles` in `packages/backend/src/git/`, with their tests;
  - one builds the Try it page and the setup status in `packages/frontend`.
