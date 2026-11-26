# The hive survives restarts, and answers outlive the turn that asked

Everything the backend needs to carry on is in SQLite. At startup a cut-off turn is resumed once, and the card
stops if that fails too. An answer to a question whose turn is gone goes to the session as a new turn. Preview
processes are tracked in the database, and Ship restarts from the squash. A session runs one hive-started turn at
a time; others wait in a queue.

## Detail
- The queue exists because the spec keeper is now the spec writer's session: two spec questions at once, from the
  reviewer and the tester, would otherwise be two turns on one session.
- New data: `PendingItem.session` (where an answer goes) and a `Process` table for what the preview service started.
- Untested, and listed as a risk: whether a `canUseTool` call can stay open for hours while a question waits for
  you. If it can't, the new-turn path covers it.
