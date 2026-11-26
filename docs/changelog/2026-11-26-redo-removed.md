# Redo the other way is removed

There is no Redo button. Decisions made without you are still recorded as "decided for you" and listed in Try it.
If you want one the other way, you say so in your feedback, which routes it like any other change. This reverses
the "Redo stays, as an amendment" part of `2026-11-26-no-session-copies`.

## Detail
- Why: Redo had no clean target. A manager decision's session is thrown away after one answer, a planner's
  decision needs Build and not just Check, and a spec keeper's decision edits the signed-off spec. Try it
  feedback already routes each kind of change to the right lane.
- Removed: the Redo row in Card Moves, `POST /api/cards/:id/redo/:decisionId`, and the redo role of
  `Decision.sessionId`. The field stays, recording which session decided.
