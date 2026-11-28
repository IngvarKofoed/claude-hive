# Folder autocomplete and git init when adding a project

The Board's Project path field completes folder names as you type, the way a shell does, from a list the backend
reads off your Mac. Adding a project also learns the rules the docs promise but the code never had: an empty folder,
or one that doesn't exist yet (after you confirm), gets `git init` on `main` with an empty first commit. A folder with
files that isn't a repo is refused, and so is any folder inside a repo other than its top, worktrees included. Today
such a path quietly adds the repo around it.

## Outcome

**What you get:**

- **Completion in Project path:** as you type, a list under the field shows the folders that match. ↑/↓ move
  through it, Tab or Enter completes the highlighted folder with a trailing `/`, and Escape closes it. Dot-folders
  show only once you type a dot. `~` means your home folder, in the list and when you add.
- **New projects from empty or new folders:** an empty folder (`.DS_Store` doesn't count) becomes a repo on `main`
  with one empty commit. So does a folder where you've only run `git init`, with no commit yet. A path that doesn't
  exist is created after you say yes.
- **Clear refusals:** a non-repo folder with files in it, and a folder inside a repo (a subfolder or a worktree),
  are refused with a message that says why and names the repo.

**How to verify:**

- Type `~/` in Project path: your home's folders are listed, with no dot-folders. Type `~/.` and the dot-folders
  appear. Press ↓ then Tab: the field reads `~/<folder>/` and the list shows its subfolders. Escape closes the list.
- Add an empty folder that holds only a `.DS_Store`: it's on the board. In it, `git log --oneline` shows one commit
  on `main`, and `git show --stat HEAD` lists no files. A folder where you ran only `git init` gets the same result.
- Type a path that doesn't exist and press Add project: the page asks, naming the folder. Cancel creates nothing.
  Create makes the folder, a repo with one empty commit, and the project.
- Add a subfolder of a repo, or one of its `.claude/worktrees/<card>` folders: refused, naming the repo. Add a
  non-repo folder with a file in it: refused, saying it isn't empty. Neither adds a project or changes the folder.

## Key decisions

- **The backend reads the folders** (new). A new `GET /api/folders?path=<typed>` does a `readdir` of the folder
  being typed in and returns the matching subfolders. It sits behind the same `localOnly` guard as every route
  (`security.ts`), and it returns folder names only, never file names or contents.
- **Completions come back as whole field values** (new). Each entry is `{ name, value }`, where `value` is the new
  text for the field, ending in `/`, keeping `~` if you typed it. So the `~` expansion, the split at the last `/` and
  the dot rule all live in one backend function. The page only shows `name` and writes `value`.
- **One classifier says what a path is** (new). `classifyFolder()` in a new `packages/backend/src/projects/folders.ts`
  returns one of: a repo's top folder, inside a repo, a worktree, inside git's own data, empty, missing, has files,
  a file, or relative. `Hive.addProject` switches on that answer. It replaces `resolveRepoRoot`, whose whole job was
  to walk up to the enclosing repo.
- **Only a repo's top folder is accepted** (breaking). A path inside a repo used to add the repo around it. Now it's
  refused, and the message names the repo. A linked worktree counts as inside: its git dir differs from the common
  git dir, and the message names the repo by its main checkout. The Board's form is the only caller.
- **git init only in an empty folder, with an empty first commit** (diverges from `projects-always-git`, which
  committed whatever was there). The hive runs `git init -b main`, then `git commit --allow-empty -m "Initial commit"`,
  with your own git identity. If the commit fails, the hive removes the `.git` it just made, so the folder is as it
  was. A folder that holds only `.DS_Store` counts as empty, and the file stays untracked. A repo's top folder with
  no commits, and nothing but `.git` and `.DS_Store` in it, counts as empty too. There the hive skips `git init`,
  points `HEAD` at `main`, and makes the same empty commit. A fresh `git init` is how people usually start a
  project, and refusing it while accepting the same folder without `.git` would be backwards.
- **A missing folder: ask first, then create** (extends `POST /api/projects`). Without `create`, a missing folder
  gets the answer `{ missing: <path> }` instead of the board, and the page asks. With `create: true`, the hive runs
  `mkdir -p` and inits the folder. The second POST classifies the path again, so if the folder has appeared in the
  meantime, it's judged as it now is.
- **Relative paths are refused** (new). Today a relative path resolves against the backend's working folder. With
  folder creation, that would make folders inside the hive's own checkout. Completion lists nothing for one.
- **An ARIA combobox, with nothing highlighted until an arrow** (new). It's a new `ProjectPathInput` component.
  Nothing is highlighted at first, so Enter still means Add project, and only ↑/↓ give Enter and Tab a folder to
  complete.

## Goals

- Add a project by picking folders, not by typing a path from memory.
- Start a new project from an empty or new folder, as `CONCEPT.md` promises for plain folders.
- Never add a project by accident from a folder inside a repo.

## Non-goals

- A native macOS folder picker.
- Listing files, marking repos or existing projects in the list, or suggesting recent or nearby repos.
- `git init` in a folder that already has files in it.
- `~user` forms of the home folder.

## Design

### Completion: `GET /api/folders?path=<typed>`

`completeFolders(typed, home)` in `projects/folders.ts`. The route passes `os.homedir()`, and tests pass a temporary
folder. It answers `FolderCompletions { folders: { name: string; value: string }[]; more: number }`, a new type in
`packages/shared`.

1. `~` alone is read as `~/`, and `~/…` as `<home>/…`. A path that still isn't absolute, `~user`, or an empty
   path answers an empty list.
2. The typed text is split at its last `/`: the folder to read, and the start of a name (empty after a trailing
   `/`).
3. `readdir` the folder with file types. Keep folders, and symlinks whose `stat` is a folder. Drop names that start
   with `.` unless the typed start of the name does.
4. Match names that start with the typed start, ignoring case: APFS ignores case by default, and completion writes
   the folder's real name anyway. Sort by name, ignoring case, with numbers in natural order.
5. Return the first 50, with `more` counting the rest. A folder that's missing or unreadable answers an empty list,
   never an error.

`value` is the typed text up to and including its last `/` (or `~/`), plus `name` and `/`.

On macOS, the first read inside `~/Documents`, `~/Desktop` or `~/Downloads` may make macOS ask whether the terminal
running the hive may read that folder. If you refuse, the list there stays empty. Adding a project by its typed path
already reads those folders, so this isn't a new exposure.

### The field: `ProjectPathInput`

A new `packages/frontend/src/components/ProjectPathInput.tsx`, with its CSS module. It's a WAI-ARIA combobox: the
input has `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls` and
`aria-activedescendant`, and the list is a `role="listbox"` of `role="option"`s. `Board.tsx` puts it where the plain
input is today, and keeps the form, the Add project button and the error line.

- **Asking:** each change to a non-empty value calls `api.folders(value)`, and only the newest value's answer is
  shown. An empty value shows no list and makes no request.
- **Open** while the field has focus, the value isn't empty, there's at least one folder, and Escape hasn't closed
  the list since the last change.
- **Keys:** ↑/↓ move the highlight, which starts on nothing and wraps. With a folder highlighted, Tab and Enter
  complete it: Enter doesn't submit, and Tab doesn't leave the field. With nothing highlighted, Enter submits Add
  project, and Tab behaves as the open question below settles. Escape closes the list and stops there, so it closes
  nothing else.
- **Mouse:** clicking a folder completes it. The press doesn't take focus from the field.
- **Completing** writes `value`, clears the highlight, keeps focus in the field, and asks again, so the list moves
  on to the subfolders.
- **Look:** existing tokens only. The list hangs under the input, in the surface, border, radius and shadow of the
  header's ☰ list (`HeaderMenu.module.css`). Names are in `--font-mono`, the highlighted row is
  `--color-surface-muted`, and `more` shows as a last line that can't be picked, "and N more — keep typing". The
  input gets `autoComplete="off"` and `spellCheck={false}`, so the browser's own suggestions don't cover the list.
  The placeholder becomes `~/path/to/a/repo or an empty folder`.

### Adding: `classifyFolder()` and `Hive.addProject`

`AddProjectBody` gains `create?: boolean`. `POST /api/projects` answers `AddProjectResponse`, which is
`BoardResponse | { missing: string }`.

`classifyFolder(path, home, git)` expands `~` as above and resolves `.`, `..` and a trailing `/`. Then it checks, in
this order:

| What the path is | Answer from `addProject` |
| --- | --- |
| Not absolute after `~` | 400 "Give a full path, starting with / or ~." |
| A file | 400 "`<path>` is a file, not a folder." |
| A linked worktree's top folder, or a folder inside one | 400 "`<path>` is a worktree of the git repo `<repo>`. Add `<repo>` itself." |
| A folder inside a repo's work tree, but not its top (a repo that isn't a linked worktree) | 400 "`<path>` is inside the git repo `<repo>`. Add `<repo>` itself, or pick a folder outside it." |
| Inside a `.git` folder or a bare repo | 400 "`<path>` is inside git's own data, not a work tree." |
| A repo's top folder with no commits, holding nothing but `.git` and `.DS_Store` | `HEAD` pointed at `main`, empty commit, added |
| A repo's top folder | As today: 409 if it's already a project, 400 if it has no `main`, otherwise added |
| Not in a repo, and holds nothing but `.DS_Store` | `git init`, empty commit, added |
| Not in a repo, with anything else in it | 400 "`<path>` isn't a git repo and has files in it. The hive runs git init only in an empty folder: commit it as a repo yourself, or pick an empty folder." |
| Missing | Its nearest existing parent is classified first, and a parent inside a repo, or that is a repo's top folder, is refused as "inside the git repo". Otherwise: `{ missing }` without `create`, or `mkdir -p`, `git init`, empty commit, added with it. |

In both messages, `<repo>` is the repo's main checkout, never a worktree's folder.

An existing path is resolved with `realpath` before these checks, so a symlink is judged by where it points, and the
stored path is real, as today. The `missing` path is its nearest existing parent's real path, plus the rest as
typed. A failed `mkdir` or a failed git step answers 400 with the reason from the OS or git. The project's name stays
`basename` of its folder.

The repo lookup is a new `GitService.repoAt(dir)`, which takes up to three calls:

1. `git rev-parse --is-inside-git-dir --is-bare-repository --git-dir --git-common-dir`. This one also works inside a
   `.git` folder or a bare repo. If it fails, there's no repo, and the answer is null. If either of the first two
   prints `true`, the answer is `{ insideGitDir: true }`.
2. Only then `git rev-parse --show-toplevel`, which fails with exit 128 inside git's own data. That's why the first
   call has to settle that case.
3. `git rev-parse -q --verify HEAD`, which fails in a repo with no commits. The answer is `{ top, mainCheckout,
   linked, hasCommits, insideGitDir: false }`.

The new `GitService.initEmptyRepo(dir)` runs the two git commands and cleans up after a failed commit. In a repo
with no commits it runs no `git init`. It points `HEAD` at `main` with `git symbolic-ref HEAD refs/heads/main`, then
makes the empty commit. If that commit fails, it puts `HEAD` back and leaves your `.git` alone. `resolveRepoRoot` and
its tests go.

A nested repo (a repo inside another repo's folder, or a submodule) is its own top folder to `git`, so it's judged as
a repo's top. A home folder that is itself a repo makes every plain folder under it "inside a repo". The rule holds
there too.

### The confirm row

When the answer is `{ missing }`, `Board.tsx` shows a row where the error line goes: "`<missing>` doesn't exist.
Create it and make it a git repo?" with **Create folder** and **Cancel**. It works like the delete confirm rows: Escape
cancels it, and so does any change to the path. Create posts the same path with `create: true` and then behaves like
Add project: on success the field clears and the board updates, and on a refusal the error line shows it.

### Docs

- **`CONCEPT.md`, Key Concepts → Project:** you add a repo by its top folder, and the field completes folder names.
  An empty or new folder, or a fresh `git init` with no commits, becomes a repo with an empty first commit on `main`
  (the hive asks before creating a folder). A non-repo folder with files, and a
  folder inside a repo or a worktree, are refused.
- **`ARCHITECTURE.md`:** the Git table's "Project added" row says the same. The API list gains `GET /api/folders`,
  and `POST /api/projects` its `create`.
- **A new changelog entry,** citing `projects-always-git`: what it decided is revised here, and its known gap, a
  first commit that takes whatever is in the folder, is gone.

## Open questions

- **Q:** With nothing highlighted, should Tab complete the only match, like a shell? **Default:** yes. When exactly
  one folder is listed, Tab completes it. With several, Tab leaves the field as usual.
- **Q:** Is 50 the right cap for the list? **Default:** yes, with the "and N more" line. Typing narrows it faster
  than scrolling.
- **Q:** The first commit's message? **Default:** `Initial commit`.

## Alternatives considered

- **Answer a missing folder with a 409 and a field on the error.** The page's `request()` only passes an error's
  message on, so it would need an error type that carries the body. A distinct `{ missing }` answer keeps the
  client as it is, since asking isn't a failure.
- **Check for a missing folder from the completion answer, before posting.** The answer can be stale when you press
  Add project, and the backend would have to refuse anyway. Asking from the POST is one source of truth.
- **Refuse a fresh `git init`, but say how to fix it** (the review's other option). You chose to make the first
  commit for it instead, since the folder is as ready as an empty one.
- **Complete in the page from a whole-tree listing.** That would ship far more of the disk to the page, for no gain
  over one `readdir` per keystroke.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: the lead plus 1 chunk.** The lead first pins the shared types (`FolderCompletions`, `create` on
  `AddProjectBody`, `AddProjectResponse`) and `api.folders` in `packages/shared/src/index.ts` and
  `packages/frontend/src/api/client.ts`. Then it builds the backend (`projects/folders.ts`, the two `GitService`
  methods, `Hive.addProject`, the route, tests) and the docs and changelog. In parallel, a subagent builds
  `ProjectPathInput` and the Board's confirm row and their tests, against those types.
- **Opus 5.5 lead, Sonnet 5.5 for the frontend.** The classifier carries the `(breaking)` and `(diverges)` calls.
  The combobox follows a settled contract and a standard ARIA pattern.
