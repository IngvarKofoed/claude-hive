# Claude Code worktrees in this repo are git-ignored

`.claude/worktrees/` is now in `.gitignore`. Commit 494956a picked up another session's worktree,
`.claude/worktrees/board-by-project`, as an embedded-repo gitlink through `git add -A`; this removes it from the
index without touching that worktree's files.

## Detail
- The `delete-a-card` spec calls a stray folder left at `<repo>/.claude/worktrees/<card>` "git-ignored". That holds
  only where the project ignores `.claude/worktrees/`; in any other project it shows as untracked.
