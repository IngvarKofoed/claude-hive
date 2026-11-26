# Claude Hive — Architecture

## Overview

Claude Hive is a local web app. A Node backend runs on your Mac and drives every Claude session through the Claude Agent SDK, and a React page in your browser shows the board. The backend's parts split along one line: **plain code decides where things go, and Claude sessions do the work and the judging.**

- The **board engine** moves cards between lanes by fixed rules. No model routes work.
- Every Claude session, whether a lane's role, a manager or a spec keeper copy, is started by the **session runner**. It runs on the Agent SDK as an ordinary Claude Code session.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                             Browser (React)                                             │
│                      Board · For you · Card · Lane history · Rulebooks · Projects                       │
└─────────────┬───────────────────────────────────────────────────────────────────────┬───────────────────┘
              │                                                                       ▲ SSE: live events
              ▼ REST: moves, chat, comments, answers, sign-off                        │
              │                                                                       │
┌─────────────┴───────────────────────────────────────────────────────────────────────┴───────────────────┐
│                                     Hive backend (Node, localhost)                                      │
│                                                                                                         │
│ ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐  │
│ │ Board engine         │  │ Question router      │  │ Spec keeper          │  │ Review gate          │  │
│ │ lanes, limits,       │  │ chat lanes → page,   │  │ snapshot at sign-off │  │ blind review,        │  │
│ │ moves, loop guard    │  │ else manager ladder  │  │ judging copies       │  │ spec hash            │  │
│ └───────────┬──────────┘  └───┬──────────────────┘  └──────────────────────┘  └──────────────────────┘  │
│             │                 │                                                                         │
│             ├─────────────────┘                     every session goes through                          │
│             ▼                                       the session runner                                  │
│ ┌───────────┴──────────┐  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐  │
│ │ Session runner       │  │ Git service          │  │ Preview service      │  │ History              │  │
│ │ start · resume ·     │  │ worktrees,           │  │ ports, running apps, │  │ events, lane diffs,  │  │
│ │ copy · stop          │  │ checkpoints, ship    │  │ screenshots          │  │ archive · SQLite     │  │
│ └───────────┬──────────┘  └───────────┬──────────┘  └──────────────────────┘  └──────────────────────┘  │
│             │                         │                                                                 │
│             │                         │             SQLite and archive: ~/.claude-hive/                 │
│             │                         │                                                                 │
└─────────────┼─────────────────────────┼─────────────────────────────────────────────────────────────────┘
              │                         │
              ▼                         ▼
 Claude Code sessions,            <repo>/.claude/worktrees/<card>
 one process per                  branch hive/<card>, one per card
 running turn
```

| Part | What it does |
| --- | --- |
| **Board engine** | Lanes, work-in-progress limits, card moves, round limits and the loop guard. It reads each role's fixed-format report and decides the next lane. |
| **Session runner** | Starts, resumes, copies and stops sessions. Applies each role's instructions, model and tools. Catches questions and permission requests through `canUseTool`. |
| **Question router** | Questions in the chat lanes go straight to the page. Questions in hands-off lanes go to the manager ladder. |
| **Spec keeper** | Freezes the spec writer's session at sign-off and runs each judgment in a fresh copy of it. |
| **Review gate** | Runs the blind spec review and tracks the spec's hash, so sign-off is only possible on reviewed text. |
| **Git service** | Worktrees, setup, checkpoints, bringing in main, the fake-data marker check, and Ship. |
| **Preview service** | Gives each card's app its own port, starts and stops it, and takes screenshots for the mockup reference and the tester. |
| **History** | Every event on every card, each lane's changes, and the archive at Done. |

**REST** carries everything you do, and **SSE** (Server-Sent Events) pushes everything that happens. The page keeps one SSE connection open.

## Project Structure

```
claude-hive/
├── docs/
├── roles/                     # One Markdown file per role: settings at the top, instructions below
├── packages/
│   ├── shared/                # Types shared by backend and frontend: API bodies, SSE events, role reports
│   ├── backend/
│   │   └── src/
│   │       ├── server.ts      # Express app: REST, SSE, serves the built page
│   │       ├── routes/
│   │       ├── board/         # Lanes, limits, moves, round limits, loop guard
│   │       ├── sessions/      # Session runner, role loading, canUseTool
│   │       ├── questions/     # Question router and manager ladder
│   │       ├── spec/          # Spec keeper, review gate, spec-format loading
│   │       ├── git/           # Worktrees, setup, checkpoints, marker check, ship
│   │       ├── preview/       # Ports, running apps, screenshots
│   │       ├── history/       # Event log, lane diffs, archive
│   │       └── db/            # SQLite schema and queries
│   └── frontend/
│       └── src/
│           ├── styles/        # tokens.css: every color, font, size, spacing and radius, and nothing else
│           ├── pages/         # Board, For you, Card, Lane, Rulebooks, Projects
│           ├── components/
│           │   ├── ui/        # Button, badge, panel, chip, chat bubble: the shared building blocks
│           │   └── ...        # Card tile, spec view with comments, mockup frame, version compare
│           └── api/           # REST client and SSE subscription
├── package.json               # npm workspaces
└── tsconfig.base.json
```

Runtime data lives outside the repo:

```
~/.claude-hive/
├── hive.db                    # SQLite
├── archive/<card>/            # Session files and lane diffs, saved at Done
└── logs/
```

Worktrees follow Claude Code's own convention: `<repo>/.claude/worktrees/<card>`.

## Roles

A role is a Markdown file in `roles/`: settings at the top, instructions below. It's the same shape as Claude Code's own agent files.

| Role | Lane | Model | Tools | Session kind |
| --- | --- | --- | --- | --- |
| `product-owner` | Refine | Opus | Read-only, plus writing the card's brief | Conversation |
| `designer` | Mockup | Opus | Full, inside the card's worktree | Conversation |
| `spec-writer` | Spec | Opus | Read-only, plus editing the spec file | Conversation, then frozen as a snapshot |
| `planner` | Plan | Opus | Read-only, plus writing the card's plan | Work |
| `developer` | Build | As the spec's Implementation strategy says | Full, inside the card's worktree | Work |
| `reviewer` | Check | Strongest | Read-only | Work, new for each round |
| `tester` | Check | Sonnet | Read-only, plus running the app and taking screenshots | Work, new for each round |
| `manager` | any hands-off lane | Sonnet | Read-only, plus the hive's lookup tools | One-off, one for each question |
| `spec-reviewer` | Spec | Fable | Read-only, sees only the spec file and `review.md` | One-off, blind |

- **Tools are what enforce a role,** through the SDK's `allowedTools` / `disallowedTools`. A reviewer can't edit because it has no edit tools, not because it was asked not to.
- **Instructions are appended** to Claude Code's own system prompt. The project's `CLAUDE.md` and settings still apply (`settingSources: ["user", "project", "local"]`).
- **The spec format** is read from `~/.claude/skills/spec-format/`. `format.md` goes to the spec writer and the planner. The "For the reviewer" part of `review.md` goes to the spec reviewer.

## Sessions

Each turn of a session is one `query()` call. Its prompt is an input stream, so a message you send while a session is busy joins the running turn, and **Stop** calls `interrupt()`. When the turn ends, the Claude Code process exits. **Nothing runs between turns.**

```ts
query({
  prompt: inputStream,
  options: {
    cwd: card.worktreePath,
    sessionId,                       // first turn: chosen by the hive, so it can always be resumed
    resume,                          // later turns, and the source of a copy
    forkSession,                     // true for a copy
    resumeSessionAt,                 // a copy taken from an earlier point ("Redo the other way")
    systemPrompt: { type: "preset", preset: "claude_code", append: role.instructions },
    model: role.model,
    allowedTools: role.tools,
    settingSources: ["user", "project", "local"],
    outputFormat: role.report,       // hands-off roles: a fixed-format report the board engine routes on
    canUseTool,                      // questions and permission requests
  },
});
```

| Kind | Used for | How |
| --- | --- | --- |
| **Conversation** | Refine, Mockup, Spec: chats with you | One session per card per lane, resumed on every message, and again when feedback sends the card back |
| **Work** | Plan, Build, Check | One session per card per lane. A card sent back resumes the same developer. Reviewer and tester start fresh each round. |
| **Copy** | Spec keeper judgments, "Redo the other way" | `resume` and `forkSession`, plus `resumeSessionAt` to start from an earlier message. The source is never changed. |
| **One-off** | Manager, spec reviewer | A new session, discarded after one answer |

**Role reports.** Each hands-off role ends its turn with a report checked against a JSON schema (`outputFormat`). The board engine routes on its fields, never on prose:

- **planner:** the steps, the chunks with the files each owns, the tests, and how each step is checked;
- **developer:** what was built, departures from the plan, issues, and decisions made without you;
- **reviewer:** findings, each marked `bug`, `spec-gap` or `extra`;
- **tester:** each How-to-verify bullet marked `pass`, `fail` or `cant-verify`, with evidence;
- **spec keeper copy:** for each issue, a verdict (`spec-wrong` or `code-wrong`), a level (`minor`, `changes-signoff` or `severe`) and a reason;
- **manager:** the ladder step, the answer or recommendation, and its source.

## Card Moves

| From | Event | To |
| --- | --- | --- |
| Ideas | You drag the card | Refine, and the worktree is created |
| Refine, Mockup | You say **Good** | the next lane. Mockup is skipped when there's nothing to show. |
| Spec | You **sign off** (only when the review is fresh) | Plan, and the spec writer is frozen as the spec keeper |
| Plan | The plan is written | Build |
| Build | It's built, with issues judged | Check |
| Build, Check | A `code-wrong` verdict | Plan, for an amendment plan |
| Check | The reviewer finds a bug, the tester finds a failure, or the marker is still there | Build, counting one round |
| Check | Everything passes | Try it |
| Try it | Feedback: what / look / bug | Refine / Mockup / Build. A what or look change passes through Spec again. |
| Try it | You accept | Ship |
| Ship | A rebase conflict | Build |
| Ship | Pushed | Done |
| any | A severe issue, or a round limit or the loop guard trips | Stays put, marked ■ stopped, with a card waiting for you |
| any before Ship | You park it | Ideas. The worktree is removed and the branch kept. |

## Questions and Permissions

`canUseTool` catches two things: **questions** (`AskUserQuestion`) and **permission requests**, i.e. tools the project's permission settings don't allow up front.

- **In a chat lane,** both go straight to the page as part of the conversation.
- **In a hands-off lane,** a question goes to the manager ladder.
- **Permission requests that can't be undone, leave the machine or touch security** become Approve items.

```
    Build session          Session runner          Manager session                Page
    (a developer)                                   (short-lived)                 (you)
          │                       │                       │                         │
          │ AskUserQuestion       │                       │                         │
          │ "Round font size      │                       │                         │
          │ up or down?"          │                       │                         │
          │──────────────────────>│                       │                         │
          │                       │ canUseTool():         │                         │
          │                       │ Build is hands-off    │                         │
          │                       │──────────────────────>│                         │
          │                       │                       │ 1 rulebook, spec,       │
          │                       │                       │   earlier answers       │
          │                       │                       │ 2 spec? → spec keeper   │
          │                       │                       │ 3 minor, invisible?     │
          │                       │                       │ 4 otherwise: ask        │
          │                       │<──────────────────────│                         │
          │                       │ verdict, source,      │                         │
          │                       │ recommendation        │                         │
          │                       │                       │                         │
  ── steps 1-3: answered ───────────────────────────────────────────────────────────│
          │<──────────────────────│                       │                         │
          │ tool result,          │                       │                         │
          │ carries on            │                       │                         │
          │                       │ logged on the card    │                         │
          │                       │                       │                         │
  ── step 4: forwarded ─────────────────────────────────────────────────────────────│
          │                       │────────────────────────────────────────────────>│
          │                       │                       │                         │ question, original options,
          │                       │                       │                         │ card and lane, recommendation
          │                       │<────────────────────────────────────────────────│
          │                       │ your answer,          │                         │
          │                       │ logged on the card    │                         │
          │<──────────────────────│                       │                         │
          │ carries on            │                       │                         │
```

- **Options are never retyped.** The runner keeps the session's original question and options, and the manager's reply only adds a recommendation.
- **When you answer a forwarded question,** a one-off manager session suggests a rule from your answer. The suggestion waits in the rulebook view for you to accept or drop.

## Spec Keeper and Review Gate

**Review gate.**

1. When you're about to sign off, it stores the spec's hash and starts the blind spec reviewer, which sees only the spec path and `review.md`.
2. Findings marked "decision" go into the Spec chat. Fixes are applied by the spec writer session.
3. The hash after those fixes is recorded as the reviewed text.
4. **Sign off** is enabled only while the spec on disk matches that hash. A changed spec greys it out until a new review has read it.

**Spec keeper.**

- At sign-off, the spec writer's session id and the last message's id are stored as the snapshot.
- Judgments are batched: at the end of Build, after Check, or at once for a blocking issue. Each batch runs in a copy of the snapshot, given the issues, the earlier verdicts and the current diff.
- **`spec-wrong`:** the copy edits the spec in the worktree, and the change is logged.
- **`code-wrong`:** the card goes to Plan for an amendment.
- **The loop guard** counts verdicts per issue. A flip back and forth sends the issue to you.

## Git

| When | What the git service does |
| --- | --- |
| Card enters Refine | `git worktree add <repo>/.claude/worktrees/<card> -b hive/<card> main`, then the project's setup: copy the listed local files, run the install command |
| Mockup versions | One worktree per version, branched from the card's. The ones you don't pick are removed. |
| Each lane exit | A checkpoint commit on `hive/<card>`. The lane's diff is saved to the card's history. |
| Build starts | Bring in the latest main. The card shows how many commits it's behind. |
| Check | Search the branch for the `HIVE-MOCK` marker. Any hit fails the check. |
| Ship | One project at a time: rebase onto main → re-run the checks → Approve → squash to one commit (message from the card, `Hive-Card:` trailer) → fast-forward main → push → remove the worktree and branch |
| Park / Drop | Remove the worktree and keep the branch (Drop deletes it after a while) |

Ship never edits files in your own checkout. If uncommitted work of yours is in the way, it waits and tells you.

## Preview Service

- **Each project sets a run command** that takes its port from an environment variable.
- **The service gives each card a port** and starts the card's app from its worktree for Mockup and Try it.
- **It keeps a list of what it started** and only ever stops those processes.
- **Screenshots** are taken with Playwright: of the approved mockup at Good, and of the built screens in Check for the tester to compare.

## Data Model

| Table | Key fields |
| --- | --- |
| **Project** | name, path, isGit, runCommand, setupCommand, localFiles, laneLimits, permissionMode |
| **Card** | project, title, lane, state (working / needs-you / stopped), branch, worktreePath, port, specPath, reviewedSpecHash, specKeeperSnapshot |
| **LaneVisit** | card, lane, enteredAt, leftAt, outcome, round |
| **Session** | card, lane, role, kind, sessionId, sourceSessionId (for copies), startedAt |
| **Version** | card, label, worktreePath, sessionId, screenshot, picked |
| **Issue** | card, foundIn, description, verdict, level, reason, flips |
| **Decision** | card, lane, what, alternative, sessionId, messageId (where a redo starts), source |
| **PendingItem** | card, kind (question / approve / severe / loop), payload, recommendation, answer |
| **Rule** | project (or shared), text, origin card, status (active / suggested) |
| **Event** | card, at, type, data. Every row of a card's history. |

## API

```
GET    /api/board                         Projects × lanes with their cards
POST   /api/cards                         New idea { projectId, text }
POST   /api/cards/:id/move                Drag { lane }; also park and drop
GET    /api/cards/:id                     The card with every lane's history
POST   /api/cards/:id/messages            Chat in the current lane { text }
POST   /api/cards/:id/comments            Comment { on: spec | mockup, anchor, text }
POST   /api/cards/:id/good                Leave Refine or Mockup
POST   /api/cards/:id/signoff             Leave Spec (refused unless the review is fresh)
POST   /api/cards/:id/versions/:v/pick    Pick a mockup version
POST   /api/cards/:id/feedback            Try it feedback { text, lane? }
POST   /api/cards/:id/accept              Accept in Try it
POST   /api/cards/:id/redo/:decisionId    Redo the other way
GET    /api/for-you                       Everything waiting for you
POST   /api/for-you/:itemId               Answer, approve or decide
GET    /api/lanes/:lane/history           A lane across all cards
GET    /api/rules  · POST · PATCH         Rulebooks and suggested rules
GET    /api/projects · POST · PATCH       Projects and their settings
GET    /api/usage                         Plan usage: 5-hour and 7-day windows
GET    /api/health                        Status and the app's version
GET    /api/events                        SSE stream
```

## Frontend

The look comes from the mockup in `docs/mockups/`. The CSS is built so that the whole app can be restyled later without touching any component:

- **Design tokens are the only place a raw value lives.** Colors, fonts, font sizes, spacing, radii and shadows are CSS custom properties in one file, `packages/frontend/src/styles/tokens.css`. The starting values are listed in `docs/mockups/README.md`.
- **Tokens are named by role, not by look:** `--color-needs-you-bg`, not `--orange-100`. Restyling changes the values and never the names.
- **Components are styled with CSS Modules:** one `.module.css` next to each component, using only `var(--…)` tokens. No hex codes, pixel font sizes or font names appear outside `tokens.css`.
- **No inline styles,** and no style objects in TSX. A state that changes the look (picked, needs you, stopped) is a class or a `data-` attribute that the CSS selects on.
- **Shared building blocks live in `components/ui/`:** button, badge, panel, chip, chat bubble. Pages are built from them.
- **A second theme,** such as dark mode, would be a second set of token values under `[data-theme="dark"]`. Nothing else would change.

## Versioning

The version is `git describe --tags --long --always --dirty`, e.g. `v0.1.0-12-g3f9c2ab`: the last release tag, the number of commits since it, and the commit.

- **It's resolved once, at build time.** `scripts/gen-version.mjs` runs git inside the checkout and writes `packages/shared/src/version.ts` (`export const APP_VERSION = "…"`), which git ignores. An `APP_VERSION` environment variable overrides git.
- **Each package runs the script before it starts or builds:** `"predev"` and `"prebuild"` in its `package.json` call `node ../../scripts/gen-version.mjs`.
- **The running app never calls git.** Backend and frontend import `APP_VERSION` from the shared package. The backend reports it at `GET /api/health`, and the page shows it in the header. `0.0.0-unknown` means the build step never ran.
- **A release is an annotated tag** (`git tag -a v0.2.0 -m …`), with no code change. The first one is `v0.1.0`.
- **`package.json` `version` stays plain semver** (`0.1.0`), bumped to match a release tag. The git-describe string is never written back into it.
- **If CI is ever added,** its checkout must fetch the full history and tags (`fetch-depth: 0` on GitHub Actions). A shallow clone silently loses the version.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, CSS Modules on design tokens (CSS custom properties) |
| Backend | Node.js, Express, TypeScript |
| Claude | `@anthropic-ai/claude-agent-sdk` (tested with 0.3.332), on your Claude subscription login |
| Live updates | Server-Sent Events |
| Database | SQLite (`better-sqlite3`) |
| Git | `git` CLI |
| Screenshots | Playwright |
| Hosting | Your Mac, bound to `127.0.0.1` only |

The page can start sessions that run commands on your machine, so it must never be reachable from the network.

## Risks to Check First

1. **Copies from an earlier point.** `resumeSessionAt` with `forkSession` is what "Redo the other way" and the spec keeper rely on. Not tested yet.
2. **Fixed-format reports** (`outputFormat`) at the end of long sessions that use many tools. Not tested yet.
3. **Subscription limits** with several sessions running at once. The SDK reports plan usage, but how the hive should pace itself near the limits is still open.
4. **Several copies of one app running side by side:** ports, local databases, and file watchers that also see `.claude/worktrees`.
5. **Folder trust:** whether SDK sessions accept a new worktree folder without an interactive trust prompt.
6. **Comparing screens with the mockup:** whether screenshots plus the tester's judgment are reliable enough, or a pixel diff is needed.
7. **Session archive:** Claude Code deletes old session files after a while, so the archive at Done must run before that happens.
