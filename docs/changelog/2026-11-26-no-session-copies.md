# The hive no longer copies sessions

Nothing in the design copies a session any more. The designer builds mockup versions one after another, each in
its own worktree. Redo the other way resumes the session that made the decision, tells it to switch, and the
card goes through Check again. The spec keeper is the spec writer's own session, carried on after sign-off,
with each batch of spec issues as a new turn. This reverses `2026-11-26-session-copy-forksession`.

## Detail
- Decided in another session. The reason given for the spec keeper: about one batch per card is expected, so
  letting the session grow isn't a concern, and a frozen snapshot isn't needed.
- Redo is now a fix on top, not a branch from the decision point: whatever was built after the decision stays,
  and the switch is checked like any other change. There is no going back to an earlier message.
- Removed with the copies: the Copy session kind, the "judgments start from a copy" rule, `forkSession()` in
  the session runner, and the data-model fields `Card.specKeeperSnapshot`, `Session.sourceSessionId`,
  `Decision.messageId` and `Version.sessionId` (one designer session builds every version).
- The copy test results stay in the Feasibility Notes as facts, and `2026-11-26-sdk-fork-report-trust-checks`
  stands as written.
- Untested: resuming one session in a different worktree (the designer's versions; session files are stored
  per working folder), and adding `outputFormat` on a later turn of a chat session (the spec keeper's batches).
