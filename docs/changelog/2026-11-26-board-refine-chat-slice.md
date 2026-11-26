# First working slice: board, Refine chat with the product owner, and the session runner

The hive runs. `npm run dev` serves the board on `127.0.0.1`. You add a git repo, type an idea and drag it to Refine,
which makes the card's worktree. Then you chat on the card page with a product owner session that keeps the brief
through the hive's `write_brief` tool. The session runner, SQLite, the event stream and the version wiring are in
place for later lanes. Built to `docs/specs/2026-11-26-board-refine-chat.md`.

## Detail
- Verified end to end with Playwright against throwaway repos and a throwaway database, with real Opus product owner
  turns:
  - the trust warning shows on an untrusted folder;
  - the worktree is created, and your checkout's `git status` stays clean;
  - brief, questions (multi-select and free text) and streaming work;
  - a backend restart mid-turn keeps the chat, and the next message continues the same conversation.
- Rejected closing the page's `EventSource` when no component listens. Reopening it on every route change, twice
  under React StrictMode, lost live updates in practice. The page keeps one stream for its life and refetches the
  card or board each time the stream connects.
- Narrows `2026-11-26-restarts-and-long-waits`: a chat lane's cut-off turn is not resumed at startup; it waits for
  your message. Risk 5 from `2026-11-26-sdk-fork-report-trust-checks` is now handled by a trust probe when a
  project is added.
- The API refuses foreign `Host` and `Origin` headers and non-JSON bodies, so a page you visit can't reach it
  through DNS rebinding.
- The SDK warns once per process that `allowedTools` shadows `canUseTool` for `mcp__hive__write_brief`. That is
  intended: the hive's own tools never wait on a permission check.
- Every message for a session goes through one path: it joins the running turn, or, when that turn's input has
  already ended (result in, process exiting), waits and starts the next turn. An answer whose `canUseTool` call
  was aborted joins a still-running turn too; never start a second `query()` beside a running one.
- Question handling lives in `packages/backend/src/hive.ts`, not in the `questions/` folder `ARCHITECTURE.md`
  lists, until the manager ladder gives that folder real routing to do.
- The lane limits in `packages/shared` (`LANES`) are placeholders: shown in the headers, not enforced or decided.
- Not done: Enter in the reply box doesn't send (the Send button does), and a card page drops events that arrive
  before its first fetch returns.
