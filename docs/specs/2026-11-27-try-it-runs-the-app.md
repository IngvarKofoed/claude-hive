# Try it runs the app: the hive starts the card's app from its setup

When a card enters Try it, the hive starts the card's app itself, from the commands the worktree's setup worked out,
on the card's own ports. The Try it page shows each process as starting, running or stopped, with a link that works
once it's up and the last lines of its output, and the app has Start, Stop and Restart. The app stops when the card leaves Try it, when
you press Stop, or when it dies by itself. The processes are the hive's own children: a hive restart ends them, and
startup starts the app again for every card in Try it, unless you stopped it. The setup's report gains what the hive needs to run each
command: the folder to run it in, and the port it listens on.

## Outcome

**What you get:**

- **The app is already running in Try it:** a card arriving in Try it starts its app on the card's ports. The page
  shows "Starting…" and then "Running", with the link to open.
- **You control it from the page:** the app has Start, Stop and Restart, and each process shows its state, link and
  the last lines of its output. A process that dies, or never comes up, shows "Stopped" with its exit and output.
- **It stops when it should:** when the card leaves Try it, when you press Stop, or when the hive itself stops. After a
  hive restart, the apps of cards in Try it start again, except one you stopped.
- **Setup says how to run it:** each start command comes with its folder and port. A port outside the card's block is
  refused, so the app never clashes with your own copy.

**How to verify:**

- **It starts by itself:** take a card into Try it (a passing Check round, or Back to Try it from Ship). Within a few
  seconds the page shows "Running", and the link opens the card's app on its port, while your own copy keeps running
  on its usual one.
- **Stop and Restart:** Stop ends it, and the port is free again. Start and Restart bring it back.
- **It dies:** kill the app's process by hand. The page shows "Stopped" with the exit and the last output lines.
- **Leaving Try it:** Accept or Send to Build stops it.
- **A hive restart:** restart the backend while a card's app runs. Its output starts over, and the app comes back on
  the same port. An app you stopped stays stopped.
- **An old setup:** your "Sell 100 in the basket" card's setup has no `port`. Its port is read from the URL, and the
  app starts.

## Key decisions

- **The hive runs the start commands as its own child processes** (new; diverges from `ARCHITECTURE.md`, Restarts:
  "Preview apps are tracked in the database").
  - Each start entry runs as `sh -c <command>` in `<worktree>/<dir>`, in its own process group, so Stop ends the
    whole tree (`npx` and the `vite` under it).
  - The output, stdout and stderr together, is kept in memory: the last 200 lines per process.
  - A hive restart ends them: the hive stops its children as it exits. Startup first stops anything left on a Try it
    card's ports from inside its worktree, then starts that card's app again.
  - There's no `Process` table. The card remembers only that you stopped its app (`Card.appStopped`), so startup and
    a finished setup leave it stopped. Start clears it, and so does leaving Try it.
  - Rejected detached processes tracked in the database, which would outlive a hive restart with their output in log
    files: more code. The price you chose: under `tsx watch`, every hive reload restarts the app you're trying, and
    its earlier output is gone.
- **The setup's report says how to run each process** (extends the setup's report from
  `2026-11-27-worktree-setup-and-try-it`).
  - Each `start` entry gains `dir`, the folder relative to the worktree (`.` for the root), and `port`, the one port
    in the card's block it listens on.
  - The role says each entry is a long-running server the hive will run with `sh -c` in that folder.
  - Before starting an entry, the hive checks that the port is inside the card's block. An entry outside it isn't
    started, and shows "Its port N is outside the card's ports. Set up again."
  - The hive also refuses an entry whose `dir` leads outside the worktree, and two entries on the same port, the same
    way ("Set up again"). A process outside the worktree couldn't be swept after a crash.
  - **Setups made before this change** have no `port`, so the hive reads it from `url`, and failing that refuses as
    above. A missing `dir` means `.`.
- **The app starts when the card enters Try it** (new; makes `CONCEPT.md`'s Try it "app is running on its own port"
  true).
  - **When:** on a passing Check round, Move on, Back to Try it from Ship, and a setup finishing while the card is in
    Try it. And when you press Start.
  - **Before every start,** the hive sweeps the card's ports (`stopListeners`). That way a copy you started by hand,
    or a leftover, can't pass for the app.
  - **Running** means the entry's own child is alive and something listens on its port (`lsof`, which sees IPv4 and
    IPv6, since vite listens on `localhost`).
  - **Not up in 2 minutes:** the process group is stopped, and the entry shows "Didn't come up in 2 minutes" with its
    output. Two minutes leaves room for a first .NET build.
- **It stops on Stop, on leaving Try it, and when a command dies** (reuses `stopCardServers` from the setup slice).
  - **Leaving Try it:** the hive first stops the process groups it started, with SIGTERM, then SIGKILL after 5
    seconds. It then sweeps the card's ports as before, for anything else, such as a copy you started yourself.
  - **A process that exits by itself** shows "Stopped (exit N)", or "Stopped by signal", with its output. It isn't
    restarted: a crash should be seen, not hidden.
- **The status reaches the page through one event** (new `app.updated` event; `CardDetail.apps`).
  - Each entry's `what`, `port`, `url`, `state` (`starting` / `running` / `stopped`), `reason`, and its last 20
    output lines.
  - Output changes are sent at most once a second per card.
- **Only Try it runs the app.** Start is refused in any other lane. Mockup and the tester will use the same runner
  later.

## Goals

- **Try it is ready when you are:** the card's app is running when you open it, with nothing to type.
- **The hive owns what it starts:** every process it starts is stopped by it, and you can see what each one is doing.

## Non-goals

- **Running the app outside Try it:** for Mockup or the tester, which come later.
- **Outliving a hive restart:** detached processes and log files (option A).
- **Restarting a crashed app by itself.**
- **The test command:** it stays a line on the page to run yourself.
- **Screenshots**, and anything else of the preview service beyond starting and stopping.

## Design

### The runner

A new `packages/backend/src/preview/apps.ts` holds the running processes, keyed by card, behind an interface
(`AppRunner`), so the hive's tests use a fake. It has three operations:

- `start(cardId, entries, worktree)` spawns each entry as `sh -c <command>` with `cwd: <worktree>/<dir>` and
  `detached: true` (its own process group). It keeps a ring of the last 200 output lines, and polls the entry's port
  every 500 ms until something listens, or 2 minutes pass. A spawn error, an exit, or the time limit sets the entry
  `stopped` with a reason.
- `stop(cardId)` sends SIGTERM to each process group (`process.kill(-pid)`), and SIGKILL after 5 seconds to any still
  there.
- `status(cardId)` returns the entries' states for the page.

The hive registers an exit handler that sends SIGKILL to every group it started, synchronously. It does this on
SIGINT, on SIGTERM (which `tsx watch` sends) and on a normal exit. A signal listener replaces Node's default exit, so
after killing the groups the handler exits the process itself. A crash that skips the handler leaves its children
behind, and the startup sweep stops them by port and folder.

### When it starts and stops

| Event | What the runner does |
| --- | --- |
| The card enters Try it (a passing round, Move on, Back to Try it) | Starts the app, if the setup is `done`. Otherwise the page keeps "This worktree has no start command yet." with Prepare it. |
| A setup starts while the card is in Try it (Prepare it again) | Stops the app, since the setup checks its commands on the same ports |
| A setup finishes `done` while the card is in Try it | Starts the app with the new commands, unless you stopped it |
| You press Start | Starts whatever isn't running, and clears "stopped by you" |
| You press Restart | Stops everything, then starts it all, and clears "stopped by you" |
| You press Stop | Stops everything, and remembers that you stopped it |
| The card leaves Try it (Accept, Send to Build) | Stops the app, sweeps the card's ports, and clears "stopped by you" |
| The hive starts up | For each card in Try it: sweeps its ports, then starts the app, unless you stopped it |

### The setup's report and role

- **`SETUP_SCHEMA`:** each `start` item gains `dir` (string) and `port` (integer), both required. `StartCommand` in
  the shared types gains them too.
- **`roles/setup.md`, Running:**
  - each start entry is a server the hive runs with `sh -c` in that folder and keeps running for Try it;
  - give the folder relative to the worktree, and the one port of the card's block it listens on;
  - one entry per process, so a backend and a frontend are two entries on two ports.

### The page

- **The Try it panel's "How to start it" becomes "The app".**
  - **One set of buttons for the whole app:** Start while anything is stopped, Stop while anything starts or runs,
    and Restart.
  - **Each process shows:**
    - its `what` and its state: a "Starting…", "Running" or "Stopped" badge;
    - the link, active only while it's running;
    - its reason when stopped;
    - a collapsed "Output" with the last 20 lines.
- **Below the entries:** the worktree path, the test command, what's shared, and Prepare it again.
- The "Prepare it" rewording asked for earlier is part of this slice: "This worktree has no local files from your
  checkout yet, and no command to start it on the card's ports."

### Data and API

- **Shared types:**
  - `AppProcess { what, port, url, state: "starting" | "running" | "stopped", reason: string | null, output:
    string[] }`;
  - `CardDetail.apps: AppProcess[]`, empty outside Try it, and `CardDetail.appStopped: boolean`;
  - the event `{ type: "app.updated"; cardId; apps: AppProcess[] }`.
- **API:** `POST /api/cards/:id/app/start`, `/app/stop` and `/app/restart`, each acting on the whole app. Each is
  refused outside Try it, and Start and Restart are refused without a finished setup.
- **Database:** one column, `cards.app_stopped`, which is your Stop. The processes themselves live only as long as
  the hive.

### Docs that change

- **`CONCEPT.md`, Try it:** drop "(for now, you start it with the commands Try it shows…)".
- **`ARCHITECTURE.md`:**
  - **Preview Service:** the hive starts a card's app for Try it from its setup's start commands, as its own child
    processes, and stops them as above.
  - **Restarts:** the "Preview apps are tracked in the database" bullet becomes: the hive's children end with it,
    and startup restarts the apps of cards in Try it after sweeping their ports.
  - **Data model:** the `Process` table goes.
  - **API:** the three endpoints.
- **`roles/setup.md`:** the Running lines above.

## Alternatives considered

- **Detached processes tracked in the database (option A):** they would outlive a hive restart, with output in log
  files. You chose the simpler children of the hive.
- **The setup agent leaving the app running:** a session's processes end with its turn, and the hive couldn't see or
  stop them.
- **Restarting a crashed app automatically:** it hides the crash you're there to see.
- **Buttons on each process:** finer control over a backend and a frontend, but the API and runner would need to name
  a process. One set for the whole app covers trying the card.
- **Starting every Try it app after a hive restart, including stopped ones:** under `tsx watch` every reload would undo
  your Stop.
- **Starting only when you press Start:** nothing would run until you asked, but Try it should be ready when you open
  it. The price is a dev server running for every card waiting in Try it.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: an Opus lead plus a Sonnet page chunk.**
- **The lead (Opus 5.5)** builds:
  - the runner in `preview/apps.ts`, with tests that start a throwaway server in a temporary folder;
  - the hive's wiring: start, stop and the startup sweep;
  - the setup schema and role, the shared types, the endpoints and the docs.
- **The subagent (Sonnet 5.5)** builds the Try it panel's "The app" section and the rewording against the finished
  types.
