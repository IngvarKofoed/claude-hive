# Worktree setup and Try it: a card you can run, accept or send back

A card's worktree is now set up in the background when it enters Refine. A Sonnet setup session picks your
checkout's git-ignored local files the app needs, and the hive copies them. It installs dependencies and works out how
to start the app and its tests on the card's own block of 10 ports. Try it shows how to start the card, with Accept and
Send to Build, and servers on the card's ports stop when it leaves Build, Check or Try it.
Built to `docs/specs/2026-11-27-worktree-setup-and-try-it.md`.

## Detail
- **A session picks, the hive's code copies.**
  - Rejected rules in code only. Measured on 11 of your repos, they sorted junk from data well, but they can't work
    out ports or how to start an app.
  - Rejected a list per project: there's no settings page, and ports would still be yours to sort out.
  - The session never copies anything itself: auto mode blocks a session copying secrets, as feature-flow found, and
    the guards belong in code.
- **The copy guards** (`git/localFiles.ts`):
  - only git-ignored paths inside the checkout;
  - never `.git` or `.claude/worktrees`, and never a folder that holds the worktree itself. Copying `.claude/` would
    copy the worktree into itself;
  - never over an existing file, with folders copied file by file;
  - symlinks copied as links, never followed;
  - copy-on-write clones (`COPYFILE_FICLONE`).

  The listing drops dependencies, build output, caches, logs, OS and editor junk, `.claude/` and `.playwright-mcp/`
  by name. A collapsed ignored folder is opened up only for a junk *folder* inside it, such as `node_modules`, so the
  junk is named on its own. A `.DS_Store` or log file inside doesn't open it up: on magic-grow that had spread a few
  folders into some 300 entries. Git can list a folder and entries inside it separately, so duplicates, and entries
  inside a listed folder, are dropped.
- **Ports:** each card has 10 consecutive ports from 5200–5999 (`Card.port` is the first). They're checked free with
  `lsof` when assigned, and the card keeps them until Done or park, neither of which exists yet. With none free,
  setup fails. Blocks are handed out one card at a time: two setups starting together both read the same block as
  free while the other's `lsof` checks ran.
- **Stopping servers:**
  - When a card leaves Build, Check or Try it, the hive stops what listens on the card's ports from inside its
    worktree: SIGTERM, then SIGKILL after 5 seconds.
  - It doesn't stop by port alone, because Postgres (5432) or Screen Sharing (5900) could take a card's port later.
    It doesn't stop by folder alone, because that would hit your shell or editor opened in the worktree.
  - This revises the preview service's "only ever stops what it started".
- **Setup never holds you up:**
  - It doesn't count as the card's running turn, its text stays out of the chat, and its questions are refused. A
    failed setup is a note.
  - Build waits for a setup that's still running, and runs one first for a worktree that never had one. While it
    waits, the setup counts as running: the badge shows working, and Stop ends it, even while the files are still
    being listed and there's no turn to interrupt yet.
  - Build clears the developer's last message before it waits, so the setup's end sees a developer that hasn't
    started this visit. Without that, a re-plan after Back to Spec onto a worktree with no setup never started the
    developer.
  - A setup turn is stopped after 10 minutes.
  - After a restart, a cut-off setup turn is resumed. One the hive never got to start is marked failed, and a waiting
    Build gets its Retry line rather than starting by itself.
- **Try it has no session.** Send to Build stores your words as `Card.feedback` and clears `Card.build` and
  `Card.check`, so Check starts again from round 1. This closes the stale-bugs gap after Move on from
  `2026-11-27-check-lane-reviewer`.
  - The developer's `done` report clears the feedback, and so does Back to Spec, so after a new sign-off the developer
    gets the new plan.
  - `startDeveloper`'s order is feedback, then Check's bugs, then a revised spec, then the first build.
- **Accept** leads to Ship, which isn't built. Ship offers Back to Try it until it is.
- **`Project.localFiles` and `setupCommand` are gone from the data model.** `runCommand` and `testCommand` stay for the
  preview service and Ship to decide.
- **Every hands-off message now names the card's ports,** even after a failed setup, so nothing runs on the project's
  default ports beside your copy.
- **Verified end to end** on a scratch web app whose `.env` and `data/` are git-ignored, and whose `.gitignore` ignores
  all of `.claude/`, with your own copy running on its usual port 3000:
  - A real Sonnet setup ran in the background beside Refine. It copied `.env` and `data/`, left `node_modules/` out,
    and worked out `PORT=5200 npm start`. It started that once to check it, and stopped it.
  - Auto mode refused its `pkill`, and it checked another way. The worktree's `git status` stayed clean, and the
    Refine chat got the note.
  - Started from Try it's command, the card's app answered on 5200 from its copied data while your copy answered on
    3000.
  - Accept stopped the card's app (SIGTERM) and left your copy running, with "Stopped what was running on 5200." in
    the history. Back to Try it brought the card back. The console was clean.
  - The run put prose into the test command, so the schema now asks for the command alone.
- **Not covered by that run:** the fake-runner tests cover these.
  - Build waiting for setup, and Stop ending it;
  - Send to Build with a real developer;
  - the setup time limit;
  - the restart paths.

  The card was put in Try it through the scratch database: Spec, Plan, Build and Check were verified with real
  sessions in the earlier slices.
- **In tests,** the fake runner finishes setup turns at once and keeps them out of `turns`, unless a test sets
  `holdSetup`.
- **Known limits:**
  - A `.env` you change in your checkout doesn't reach a worktree that already has one, because copies never
    overwrite.
  - File watchers and test runners that don't listen on a port aren't stopped.
  - Server databases and Docker are reported as shared, not isolated.
  - Try it is shown no "what the checks covered" and no spec keeper questions yet.
