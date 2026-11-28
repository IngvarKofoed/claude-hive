# The log's activity line reads "thinking…" while a turn runs

The log's activity line now reads "thinking…" whenever a turn runs and no text, tool line or question is showing, so
pressing Send gets an answer at once. A tool's line now ends with its result, a turn that can't start leaves no mark
behind, and Build's start announces its turn before it merges main.
Spec: `docs/specs/2026-11-28-instant-feedback-on-message.md`.

## Detail
- Worked out on the page from `turnRunning`, `streaming` and `pending`, in `Chat.tsx`. No new event and no new field.
- Rejected an optimistic Send flag and a backend-emitted "thinking…" activity: activity isn't stored, so a reload
  would lose it, and a flag would have to be taken back when a send fails.
- A reload mid-tool shows "thinking…" until the next tool call or text; the tool's own line isn't remembered.
- Stop keeps the line until `turn.ended`, since the session hasn't stopped before then.
- Any turn on the card counts: the spec reviewer, Build's merge and Build's wait for setup all show it. Try it's
  keeper `answers` turn and Ship's committer show nothing: those lanes have no log, or the turn never goes through
  `startTurn`.
- Parallel tool calls: the runner counts the session's own open calls across messages, subagents' skipped, so the
  last tool's line stays until every call has its result.
- `startTurn` still stores the session's `lastMessage` before it reads the role file: Retry after a broken role file
  (the keeper's `answers` turn, `resumeDeveloper` after a settled block) sends that message, not an older one. Only
  `turnRunning`, the working state and `turn.started` wait until the role has loaded.
- A review's findings that can't reach the spec writer (its role file broken since the review began) now end with an
  error line and Review again. Before, the throw left the reviewer's turn-end handler early: no `turn.ended`, and the
  card stayed working, with the line and Stop on screen, until a reload. The findings' start runs after the
  reviewer's turn has left `turns`, so it is an ordinary failed start, not one made while another turn runs.
- A failed `runner.start` in `startTurn` adds no error line of its own: its callers already report a failed start.
  It ends the turn only when nothing else runs on the card, so inside `startDeveloper` the one `turn.ended` still
  comes from its `finally`.
- `startDeveloper`'s wait-for-setup path emits `turn.started` a second time; harmless.
- The line never raises "↓ New messages", the same rule as the activity line in `card-columns-scroll`.
- The label is a constant (`WORKING`); "working…" is the fallback if "thinking…" reads wrong.
