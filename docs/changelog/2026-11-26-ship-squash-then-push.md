# Ship squashes first, pushes main, and updates your checkout only when it's safe

Ship now squashes the card onto the latest main in the card's worktree, runs the project's test command and
the fake-data search, asks for approval, then pushes. If main moved meanwhile, it squashes again. Your checkout's
main is updated only when main isn't checked out there, or the checkout is clean. A card that Ship sent back to
Build returns to Ship after Check, with no second Try it.

## Detail
- Rejected "rebase, then fast-forward main": git won't move a branch that is checked out in another worktree
  without updating that folder's files, which broke "never touches your checkout".
- Rejected rebasing the branch: it replays conflicts in checkpoint commits that were later overwritten. Squashing
  first meets a conflict once, against the finished change.
- "Re-run the checks" now means the project's test command (new `Project.testCommand`) and the `HIVE-MOCK`
  search, not another reviewer and tester round.
- In a project with no remote, main can only be updated through your checkout, so Ship waits until it's clean.
