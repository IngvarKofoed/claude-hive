# Every session runs with full access in auto mode; roles live in instructions

Every session gets the same full access, in Claude Code's auto mode, set by the runner. A role's limits, such as
whether it may change code, are told to it in its instructions and nothing else enforces them. Auto mode decides
permission requests; `canUseTool` catches questions and anything auto mode passes on. A per-role permissions policy
is parked. Narrows `2026-11-26-sdk-fork-report-trust-checks`, which wanted the runner to strip MCP tools per role.

## Detail
- Parked, not rejected: per-role tool lists plus a permission policy. Several roles couldn't be expressed as tool
  lists ("full, inside the worktree", "read-only plus running the app", "writing the brief"), and "can't be undone"
  needed a judge nobody had designed.
- Consequence: a reviewer, tester or blind spec reviewer can edit or read beyond its role if it ignores its
  instructions. Your own MCP servers and plugins reach every role.
- Removed: the `allowedTools` line in the session sketch, `Project.permissionMode`, and the risk about checked-in
  permission rules, which doesn't matter in auto mode.
- Untested and now a risk: in our trust tests a session in auto mode never called `canUseTool` for a permission
  request. Whether `AskUserQuestion` still reaches `canUseTool` in auto mode, and what auto mode does with an action
  it won't allow by itself, decides whether questions and Approve items work at all.
