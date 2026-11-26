# Session copies, fixed-format reports and worktree trust checked against the SDK

Copying a session from an earlier message, schema-checked role reports and worktrees under `.claude/worktrees`
were tested on 2026-11-26 and work, so those three risks left the list. The tests added three new risks:
untrusted folders, checked-in permission rules, and the user's own settings.
Role reports now count only when `structured_output` is present, and every report can say it is blocked.

## Detail
- Tested with Haiku (`claude-haiku-5-5`), Agent SDK 0.3.332 and Claude Code 2.1.332, using throwaway scripts
  outside the repo. The scripts were not kept.
- Don't route on `subtype: "success"`. With a schema nothing could satisfy, the session gave up after 2–3
  rejected tries and the result still said `success`, with no `structured_output`. The SDK's
  `error_max_structured_output_retries` never fired in three runs.
- Don't route on `stop_reason` either: a good report ends on `tool_use`.
- Without a `blocked` status, a required field the repo couldn't answer was filled with a placeholder that
  passed the schema (`"https://"`, `"https://unknown.invalid"`) in all three runs.
- Rejected `projectConfigRoot` pointed at the user's checkout as the fix for worktree settings. The worktree
  session then ran the checkout's settings, uncommitted edits included, which breaks "never read from your own
  checkout".
- Trust was judged by the files the session actually loaded (`getContextUsage().memoryFiles`), because the
  model's own account of its context was unreliable. Under a trusted folder, a worktree loads only its own
  CLAUDE.md, not the CLAUDE.md of the checkout above it.
- Checked-in `.claude/settings.json` `permissions.allow` was ignored in trusted and untrusted folders, also as
  `Bash(touch:*)`. Why is unknown: it may be deliberate CLI policy.
- Not covered: long Opus sessions; copying across a compaction, which the SDK documents as behaving
  differently; copying a report-producing session at the end of its turn (per the SDK, the copy point must be
  the report entry, not the last assistant message). The trusted case was tested under the home folder, not
  under `~/work`.
