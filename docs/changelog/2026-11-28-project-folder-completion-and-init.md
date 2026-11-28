# Project path completes folders, and only empty folders get git init

The Board's Project path field now lists matching folders as you type (`GET /api/folders`), with `~` for home and
dot-folders only once you type a dot. Adding a project takes only a repo's top folder. An empty folder, a new one
you confirm, or a fresh `git init` with no commits becomes a repo on `main` with one empty commit. A folder with files
that isn't a repo, a subfolder of a repo and a worktree are refused, naming the repo; a path inside a repo used to
add the repo around it.

## Detail
- Revises `projects-always-git`: git init now runs only in an empty folder, so its known gap, a first commit that
  takes whatever is in the folder, is gone. Every project is still a git repo.
- `resolveRepoRoot` is gone. `classifyFolder()` in `projects/folders.ts` says what a path is, from
  `GitService.repoAt()`, and `Hive.addProject` switches on it. `initEmptyRepo()` makes the empty commit with the
  user's own git identity (no `-c user.*`), and removes the `.git` it made, or puts `HEAD` back in an existing
  no-commits repo, when the commit fails (a failing hook, gpg signing, no identity).
- Rejected answering a missing folder with a 409 that carries a field: the page's `request()` only passes an error's
  message on. `{ missing }` is an ordinary 200 answer, and `create: true` on a second POST, which classifies the path
  again, makes it.
- Rejected checking for a missing folder from the completion answer: it can be stale by the time you press Add
  project, and the backend has to judge anyway.
- Relative paths are refused, since folder creation would otherwise make folders inside the hive's own checkout.
  `~user` isn't supported, in completion or adding.
- A project whose folder was removed from disk, added again by the same path, gets the 409 "already a project" before
  `{ missing }` is answered or anything is created, as a repo top or an empty folder does.
- A worktree of a bare repo, a `--separate-git-dir` repo or a submodule has no `<checkout>/.git` to find the checkout
  from. Its refusal names the first entry of `git worktree list` instead, which is the bare repo or the common git dir,
  and leaves out "Add <repo> itself", since that folder would be refused as git's own data. A submodule's checkout is
  named in its `core.worktree`, but git doesn't report it there, so it isn't looked up.
- A folder `mkdir -p` made stays when the git step after it fails: it's empty, so adding it again is judged as an
  empty folder.
- macOS: the first completion inside `~/Documents`, `~/Desktop` or `~/Downloads` may bring up a privacy prompt for
  the terminal running the hive. Refused, the list there stays empty.
- With nothing highlighted, Tab completes the only folder when exactly one is listed, like a shell; the list caps at
  50, with an "and N more — keep typing" line.
- The browser check walked the four How-to-verify bullets on a scratch database. Left to unit tests only: clicking a
  folder in the list, an Escape that closes the list while the confirm row shows, Tab completing a sole match, a
  `git init -b master` folder, and a failed first commit. No macOS privacy prompt was met, since the check never
  opened `~/Documents`, `~/Desktop` or `~/Downloads`.
