# The live Build lane shows the developer's checklist instead of the plan

While a card is in Build, the right side shows the developer's own task list, each item waiting, in progress or done,
updating live as it works. When Check, Try it or Ship sent the card back, why it's back sits on top. The plan is gone
from the live Build lane: it's the Plan lane's work, and ✓ Plan shows it. This sets the card page's rule that a live
lane shows its own work. Spec: `docs/specs/2026-11-28-build-lane-checklist.md`. It removes the Plan panel that
`2026-11-26-build-lane-developer` put beside the developer's chat.

## Detail
- **SDK sessions have no task-list tools unless switched on.** Neither `TodoWrite` nor `TaskCreate` was offered, and
  the `todoFeatureEnabled` setting didn't help. The developer's sessions run with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`
  (`taskTools` in `ROLE_TURNS`), which adds `TaskCreate`, `TaskUpdate`, `TaskList` and `TaskGet` and keeps the
  default tools. Rejected: naming them in the `tools` option, which replaces Claude Code's default tool set. The
  variable isn't documented, so a Claude Code update can take it away. The checklist would then stay on its empty
  line, and nothing else breaks.
- **Both tool kinds are read.** `TodoWrite` isn't in Claude Code 2.1.332, but reading it costs little and covers a
  version that brings it back. A `TaskCreate` item gets its id and saved subject from the tool's structured result,
  or its id from the result's text ("Task #3…") when several results share one message.
- **`TaskUpdate` is held until its result,** like `TaskCreate`, so an update Claude Code refused never shows.
- **The list belongs to the developer's session, not to a Build visit.** A card back from Check, Try it or Ship
  resumes the same developer, which carries on its own list with the same task ids. Emptying it on entry would drop
  every update to an earlier item. It's emptied only when a new developer session starts.
- **Known gap:** a restart that cuts a turn between a `TaskCreate` or `TaskUpdate` call and its result loses that
  change.
- **The Role prompts page shows that the task tools are on,** under "Task-list tools" on the developer's entry, read
  from `ROLE_TURNS` like the rest of the page. The developer's instructions ask for a task list, and the same request
  goes in every Build entry message, for developers started before it.
- **Verified with real sessions:** a Haiku session through the hive's runner, with the tools switched on, made two
  items and ticked one off, and every change reached the hive. A `TaskCreate` result's text reads "Task #1 created
  successfully: alpha", and three calls made in one message came back one result per message. Not verified: a full
  real build on the card page.
- Only the developer's list is read: a subagent's and other roles' lists are ignored.
