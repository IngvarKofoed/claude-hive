# One session can move between worktrees and take on the spec keeper's job

Both session uses the no-copies design relies on were tested and work. The designer's session, resumed in each
mockup version's worktree, keeps its conversation. The spec writer's chat session returns a valid spec keeper
report on a later turn, then chats again. Its role instructions stay those of its first turn, so the spec keeper's
instructions come with each batch's message. Settles the open points in `2026-11-26-no-session-copies`.

## Detail
- Tested on 2026-11-26 with Haiku, Agent SDK 0.3.332 and Claude Code 2.1.332, using throwaway scripts that
  were not kept.
- Resumed with another `cwd`, the session kept its id and worked in the new folder. Its transcript stays under
  the `~/.claude/projects` folder of the worktree it started in, so removing unpicked version worktrees doesn't
  remove it. Not needed, so unused: keeping the session in the card's worktree with the versions as
  `additionalDirectories`.
- A changed `systemPrompt.append` on a later turn is ignored by default: the session records its system prompt at
  the first turn (`prompt_snapshot` entries in the transcript), and a report quoted the first turn's role line.
- Rejected `systemPrompt.snapshot: false` for switching between writer and keeper. It does switch the role
  instructions per turn, but the SDK docs say a changing system prompt invalidates the prompt cache and discards
  earlier reasoning on every switch. That cost was not measured.
- The two runs gave different verdicts on the same issue. That is Haiku's judgment, which these tests didn't check.
