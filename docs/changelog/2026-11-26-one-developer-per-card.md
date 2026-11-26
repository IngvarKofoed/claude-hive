# One developer session per card, with its own subagents

Build has one developer session per card. When the spec's Implementation strategy calls for several agents, that
session runs them as its own subagents. So a card has one developer report, one session to resume when it comes
back to Build, and one session committing in its worktree.

## Detail
- Rejected one hive session per chunk: several sessions committing in one worktree collide on git, their reports
  would need merging, and "resume the same developer" would have no single target.
