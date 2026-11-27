# Try it runs the app: the hive starts the card's app from its setup

A card entering Try it now has its app started by the hive, from the commands the worktree's setup worked out, on
the card's own ports. The page shows each process as starting, running or stopped, with its link and last output
lines, and the app has Start, Stop and Restart. The setup's start entries now say the folder and port of each
process. Built to `docs/specs/2026-11-27-try-it-runs-the-app.md`.

## Detail
- **The processes are the hive's own children,** each in its own process group, so Stop ends the whole tree
  (`npx` and the `vite` under it).
  - Their output is kept in memory: the last 200 lines, with terminal colour codes stripped. Vite prints them even
    into a pipe.
  - Rejected detached processes tracked in the database, which would outlive a hive restart with output in log files.
    The price: under `tsx watch`, every hive reload restarts the app you're trying, and its earlier output is gone.
  - The `Process` table is gone from the docs, revising `2026-11-26-restarts-and-long-waits`.
- **The hive ends them as it exits.** `server.ts` kills every group on exit, and its SIGINT and SIGTERM listeners exit
  the process themselves, since a listener replaces Node's default exit. A crash that skips the handler leaves the
  apps behind, and startup's sweep of the card's ports stops them.
- **Your Stop is remembered,** in `cards.app_stopped`. A hive restart or a finished setup leaves the app stopped, and
  Start, Restart or the card leaving Try it clears it. Without it, every reload under `tsx watch` would undo your Stop.
- **Each entry is checked before it starts.** Its port must be one of the card's, its folder inside the worktree, and
  no two entries may share a port. Setups made before entries had a `port` give it through their `url`.
- **"Running"** means the entry's own child is alive and something listens on its port. `lsof` sees IPv4 and IPv6,
  and vite listens on `[::1]`.
- **Before a start,** the ports it will use are swept, so a copy you started by hand, or a leftover, can't pass for the
  app. A process that never listens is stopped after 2 minutes, which leaves room for a first .NET build.
- **A process that dies isn't restarted:** the crash is what you're there to see.
- **Prepare it again in Try it** stops the app, since the setup checks its commands on the same ports, and starts it
  again with the new commands when the setup is done.
- **One set of buttons for the whole app.** Rejected buttons on each process: the API and runner would need to name a
  process, and trying the card doesn't need that.
- **The page's wording** now says what setup does: "Prepare it", "Prepare it again", "Preparing…", and "This worktree
  has no local files from your checkout yet, and no command to start it on the card's ports."
- **Verified on your own magic-grow card,** "Sell 100 in the basket", in Try it on your 4317 backend:
  - When the backend reloaded with this code, it started the card's vite on 5200 from the old setup's URL, and the
    page answered with HTTP 200.
  - On the next reload, the old vite's whole group was gone and a fresh one came up in 594 ms, with clean output.
  - Your flux `Flux.Api` listening on 5210, inside the range, was left alone, as the port and folder rule intends.
- **Verified in the browser** on a scratch web app run by a test backend:
  - startup started the card's app;
  - Stop freed the port and was remembered;
  - Start brought the app back;
  - a process killed by hand showed "Stopped by signal SIGKILL." with its output;
  - Restart brought it back again;
  - Accept stopped it and moved the card to Ship.

  Your app on 5200 kept answering throughout, and the console was clean.
- **Not covered by any real run:**
  - a process that never listens and is stopped after 2 minutes, which the runner's tests cover with a short limit;
  - Prepare it again in Try it, which the hive's tests cover.
- **Known limits:**
  - An app outside Try it (Mockup, the tester) isn't run yet.
  - A file watcher that doesn't listen on a port isn't swept after a crash.
