# No lane limits

The board no longer shows a work-in-progress limit under each lane, and CONCEPT.md and ARCHITECTURE.md no longer
promise lane limits. They were placeholder numbers nobody enforced (`2026-11-26-board-refine-chat-slice`), and limits
aren't wanted for now. The shared lane list and the board mockup no longer carry one either.

## Detail
- **Other limits stay:** Check's round limit (`CHECK_ROUNDS`) and the keeper's cap of two fix rounds, the plan usage
  limits (5-hour and 7-day windows) with their open question and risk, and the setup and app time limits.
- **The deadlock follow-up went with them:** CLAUDE_TODO's item about a full Check and a full Build each holding the
  slot the other needs no longer applies.
- **Nothing paces the hive now.** The number of cards in a lane, and so of worktrees, has no bound. Bringing back any
  pacing is a new decision, not an unparked one.
- **Rejected: keeping the field and hiding it,** which would leave a number in `LANES` that the docs no longer explain
  and someone might later enforce. **Rejected: a "parked" note in the docs,** the way the per-role permissions policy
  is parked; limits were removed outright instead.
