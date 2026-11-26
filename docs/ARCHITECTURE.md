# Claude Hive — Architecture

## Overview

Claude Hive is a local web app. A Node backend runs on your Mac and drives every Claude session through the Claude Agent SDK, and a React page in your browser shows the board. The backend's parts split along one line: **plain code decides where things go, and Claude sessions do the work and the judging.**

- The **board engine** moves cards between lanes by fixed rules. No model routes work.
- Every Claude session, whether a lane's role or a manager, is started by the **session runner**. It runs on the Agent SDK as an ordinary Claude Code session.

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
│ │ lanes, limits,       │  │ chat lanes → page,   │  │ spec writer session, │  │ blind review,        │  │
│ │ moves, loop guard    │  │ else manager ladder  │  │ one turn per batch   │  │ spec hash            │  │
│ └───────────┬──────────┘  └───┬──────────────────┘  └──────────────────────┘  └──────────────────────┘  │
│             │                 │                                                                         │
│             ├─────────────────┘                     every session goes through                          │
│             ▼                                       the session runner                                  │
│ ┌───────────┴──────────┐  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐  │
│ │ Session runner       │  │ Git service          │  │ Preview service      │  │ History              │  │
│ │ start · resume ·     │  │ worktrees,           │  │ ports, running apps, │  │ events, lane diffs,  │  │
│ │ stop · canUseTool    │  │ checkpoints, ship    │  │ screenshots          │  │ archive · SQLite     │  │
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
| **Session runner** | Starts, resumes and stops sessions. Applies each role's instructions and model, and runs every session with full access in auto mode. Catches questions through `canUseTool`. |
| **Question router** | Questions in the chat lanes go straight to the page. Questions in hands-off lanes go to the manager ladder. |
| **Spec keeper** | Judges each batch of spec issues as a new turn in the spec writer's session, which carries on after sign-off. |
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

| Role | Lane | Model | May change (told in its instructions) | Session kind |
| --- | --- | --- | --- | --- |
| `product-owner` | Refine | Opus | Nothing in the repo; writes the card's brief | Conversation |
| `designer` | Mockup | Opus | Code, in the card's worktree | Conversation |
| `spec-writer` | Spec | Opus | Only the spec file | Conversation, carried on after sign-off as the spec keeper |
| `planner` | Plan | Opus | Nothing in the repo; writes the card's plan | Work |
| `developer` | Build | As the spec's Implementation strategy says | Code, in the card's worktree | Work |
| `reviewer` | Check | Strongest | Nothing | Work, new for each round |
| `tester` | Check | Sonnet | Nothing; runs the app and takes screenshots | Work, new for each round |
| `manager` | any hands-off lane | Sonnet | Nothing; uses the hive's lookup tools | One-off, one for each question |
| `spec-reviewer` | Spec | Fable | Nothing; reads only the spec file and `review.md` | One-off, blind |

- **One developer per card.** When the spec's Implementation strategy calls for several agents, the developer session runs them as its own subagents. So a card has one developer report, one session to resume, and one session committing in its worktree.
- **Every session has the same full access,** in Claude Code's auto mode, which the runner sets itself. A role's limits are only in its instructions: they say what the session is and whether it may change code. A reviewer doesn't edit because it's told not to, and nothing else stops it. A per-role permissions policy is parked.
- **Instructions are appended** to Claude Code's own system prompt. The project's `CLAUDE.md` and settings still apply (`settingSources: ["user", "project", "local"]`). They are recorded at a session's first turn, so a changed role file reaches only new sessions. Every role is told to ask questions with `AskUserQuestion`, never in its reply: a question in prose ends a hands-off turn with nobody to answer it.
- **The spec format** is read from `~/.claude/skills/spec-format/`. `format.md` goes to the spec writer and the planner. The "For the reviewer" part of `review.md` goes to the spec reviewer.

## Sessions

Each turn of a session is one `query()` call. Its prompt is an input stream, so a message you send while a session is busy joins the running turn, and **Stop** calls `interrupt()`. When the turn ends, the Claude Code process exits. **Nothing runs between turns.**

```ts
query({
  prompt: inputStream,
  options: {
    cwd: card.worktreePath,
    sessionId,                       // first turn: chosen by the hive, so it can always be resumed
    resume,                          // every later turn
    systemPrompt: { type: "preset", preset: "claude_code", append: role.instructions },
    model: role.model,
    permissionMode: "auto",          // every session: full access; the role's instructions set its limits
    settingSources: ["user", "project", "local"],
    outputFormat: role.report,       // hands-off roles: a fixed-format report the board engine routes on
    includePartialMessages: true,    // text streams to the page as it's written
    mcpServers: { hive },            // the hive's own tools, e.g. write_brief, in-process
    allowedTools: hiveToolNames,     // the hive's own tools never wait on a permission check
    canUseTool,                      // questions, and anything auto mode passes on
  },
});
```

| Kind | Used for | How |
| --- | --- | --- |
| **Conversation** | Refine, Mockup, Spec: chats with you; the spec keeper after sign-off | One session per card per lane, resumed on every message, and again when feedback sends the card back. The designer builds mockup versions one after another in its session, resumed in each version's worktree. The spec writer's session carries on after sign-off, and each batch of spec issues is a new turn in it. |
| **Work** | Plan, Build, Check | One session per card per lane. A card sent back resumes the same developer. Reviewer and tester start fresh each round. |
| **One-off** | Manager, spec reviewer | A new session, discarded after one answer |

**Role reports.** Each hands-off role ends its turn with a report checked against a JSON schema (`outputFormat`). The board engine routes on its fields, never on prose:

- **planner:** the steps, the chunks with the files each owns, the tests, and how each step is checked;
- **developer:** what was built, departures from the plan, issues, and decisions made without you;
- **reviewer:** findings, each marked `bug`, `spec-gap` or `extra`;
- **tester:** each How-to-verify bullet marked `pass`, `fail` or `cant-verify`, with evidence;
- **spec keeper:** for each issue, a verdict (`spec-wrong` or `code-wrong`), a level (`minor`, `changes-signoff` or `severe`) and a reason;
- **manager:** the ladder step, the answer or recommendation, and its source.

- **A report must be there to count.** The board engine routes only on `structured_output`. A turn that ends without one stops the card, even when its result says `success`: a session that can't satisfy the schema gives up in prose and still ends "successfully". `stop_reason` is no guide either, since a good report ends on `tool_use`.
- **Every report can say it's blocked:** a `status` of `done` or `blocked`, with a reason. Without it, a session that can't fill in a field makes up a value that passes the schema.

## Card Moves

| From | Event | To |
| --- | --- | --- |
| Ideas | You drag the card | Refine, and the worktree is created |
| Refine, Mockup | You say **Good** | the next lane. Mockup is skipped when there's nothing to show. |
| Spec | You **sign off** (only when the review is fresh) | Plan, and the spec writer's session carries on as the spec keeper |
| Plan | The plan is written | Build |
| Build | It's built | Check, with the issues found so far still on the card |
| Build | A blocking issue judged `code-wrong` | Plan, for an amendment plan |
| Check | The reviewer finds a bug, the tester finds a failure, or the marker is still there | Build, counting one round. Spec issues wait on the card for the round that passes. |
| Check | Everything passes, and the batch of spec issues has no `code-wrong` verdict | Try it, or Ship for a card that Ship sent back. `changes-signoff` questions wait for you in Try it. |
| Check | Everything passes, but the batch has a `code-wrong` verdict | Plan, for one amendment plan covering every `code-wrong` issue |
| Try it | Feedback: what / look / bug | Refine / Mockup / Build. A what or look change passes through Spec again. |
| Try it | You answer a `changes-signoff` question with "change the code" | Plan, for an amendment plan |
| Try it | You accept | Ship |
| Ship | A conflict with the latest main | Build. After Check passes, it comes straight back to Ship. |
| Ship | It's on main | Done |
| any | A severe issue, or a round limit or the loop guard trips | Stays put, marked ■ stopped, with a card waiting for you |
| any before Ship | You park it | Ideas. The worktree is removed and the branch kept. |

## Questions and Permissions

`canUseTool` catches **questions** (`AskUserQuestion`). Permission requests are decided by Claude Code's auto mode, which every session runs in.

- **In a chat lane,** a question goes straight to the page as part of the conversation.
- **In a hands-off lane,** a question goes to the manager ladder.
- **A permission request auto mode passes on** to `canUseTool` instead of deciding goes to the page in a chat lane, and becomes an Approve item in a hands-off lane. None was passed on in our tests, so in practice the only Approve item is the push at Ship.

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

## Restarts and Long Waits

The backend can stop at any time: the Mac sleeps, it crashes, or you restart it. Everything needed to carry on is in SQLite, never only in memory.

- **One turn at a time per session.** A turn the hive starts for a session that is already busy waits in a queue for that session. An example is two spec questions for the spec keeper, one from the reviewer and one from the tester. A message you type still joins the running turn.
- **A cut-off turn is resumed once in a hands-off lane.** At startup, a card marked working with no live turn has its session resumed and told that its last turn was cut off. If that turn also ends without a report, the card stops. A chat lane's cut-off turn is not resumed: the chat says the reply was cut off and waits for your next message, since a retry would only talk over you.
- **Answers outlive the turn that asked.** A question or Approve item waiting for you is a `PendingItem` row. If the turn that asked is gone when you answer, the answer goes to that session as a new turn, together with the question and options it asked.
- **Preview apps are tracked in the database,** with their process ids and ports, so after a restart the preview service can still stop the ones it started.
- **Ship can start over.** Nothing reaches main before the push, so a Ship that was cut off starts again from the squash.

## Spec Keeper and Review Gate

**Review gate.**

1. When you're about to sign off, it stores the spec's hash and starts the blind spec reviewer, which is given only the spec path and `review.md`.
2. Findings marked "decision" go into the Spec chat. Fixes are applied by the spec writer session.
3. The hash after those fixes is recorded as the reviewed text.
4. **Sign off** is enabled only while the spec on disk matches that hash. A changed spec greys it out until a new review has read it.

**Spec keeper.**

- After sign-off, the spec writer's session carries on as the spec keeper. Nothing is frozen and nothing is copied.
- Its judging instructions and report format come with each batch's message. The session's system prompt stays the spec writer's, because it is recorded at the first turn.
- Judgments are batched: issues from Build and Check collect on the card and are judged in one batch once Check passes, while the card stays in Check. Only a blocking issue is judged at once. Each batch is a new turn in that session, given the issues and the current diff. The session remembers its earlier verdicts.
- **`spec-wrong`:** the session edits the spec in the worktree, and the change is logged.
- **`code-wrong`:** the card goes to Plan, with one amendment covering every `code-wrong` issue in the batch.
- **`changes-signoff`:** the verdict becomes the recommendation on a question to you: keep it as built, or change the code. The card goes on to Try it as built, and choosing to change the code sends it to Plan.
- **The loop guard** counts verdicts per issue. A flip back and forth sends the issue to you.

## Git

| When | What the git service does |
| --- | --- |
| Project added | A folder that isn't a repo gets `git init` and a first commit of what's in it |
| Card enters Refine | `git worktree add <repo>/.claude/worktrees/<card> -b hive/<card> main`, then the project's setup: copy the listed local files, run the install command |
| Mockup versions | One worktree per version, branched from the card's. The designer builds them one after another. The ones you don't pick are removed. |
| Each lane exit | A checkpoint commit on `hive/<card>`. The lane's diff is saved to the card's history. |
| Build starts | Bring in the latest main. The card shows how many commits it's behind. |
| Check | Search the branch for the `HIVE-MOCK` marker. Any hit fails the check. |
| Ship | One project at a time: squash onto the latest main in the card's worktree (message from the card, `Hive-Card:` trailer) → run the project's test command and the marker search → Approve → push to main (squash again if main moved) → update your checkout's main only when it's safe → remove the worktree and branch |
| Park / Drop | Remove the worktree and keep the branch (Drop deletes it after a while) |

Ship never touches uncommitted work in your checkout. It updates your checkout's main only when main isn't checked out there, or it is and the checkout is clean. Otherwise it tells you, and in a project with no remote it waits.

## Preview Service

- **Each project sets a run command** that takes its port from an environment variable.
- **The service gives each card a port** and starts the card's app from its worktree for Mockup and Try it.
- **It keeps a list of what it started** and only ever stops those processes.
- **Screenshots** are taken with Playwright: of the approved mockup at Good, and of the built screens in Check for the tester to compare.

## Data Model

| Table | Key fields |
| --- | --- |
| **Project** | name, path, trustWarning, runCommand, setupCommand, testCommand, localFiles, laneLimits |
| **Card** | project, title, ideaText, lane, state (working / needs-you / stopped), branch, worktreePath, brief, moveError, port, specPath, reviewedSpecHash |
| **LaneVisit** | card, lane, enteredAt, leftAt, outcome, round |
| **Session** | card, lane, role, kind, sessionId, startedAt, turnRunning, existsYet (a first turn created it, so later turns `resume`), lastMessage (what Retry sends again) |
| **Version** | card, label, worktreePath, screenshot, picked |
| **Issue** | card, foundIn, description, verdict, level, reason, flips |
| **Decision** | card, lane, what, alternative, sessionId, source |
| **PendingItem** | card, session (where the answer goes), kind (question / permission / approve / severe / loop), payload, recommendation, answer. `permission` is a request auto mode passed on in a chat lane. |
| **Process** | card, port, pid, command, startedAt. What the preview service started. |
| **Rule** | project (or shared), text, origin card, status (active / suggested) |
| **Event** | card, at, type, data. Every row of a card's history: `chat` (a message, yours or a session's text block), `error` (a failed or cut-off turn) and `brief` (every version of the brief) so far. The page shows the chat from these rows, never from Claude Code's transcripts, which Claude Code deletes after a while. |

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
POST   /api/cards/:id/stop                Stop the running turn
POST   /api/cards/:id/retry               Send a failed turn's message again
POST   /api/cards/:id/accept              Accept in Try it
GET    /api/for-you                       Everything waiting for you
POST   /api/for-you/:itemId               Answer, approve or decide
GET    /api/lanes/:lane/history           A lane across all cards
GET    /api/rules  · POST · PATCH         Rulebooks and suggested rules
GET    /api/projects · POST · PATCH       Projects and their settings
POST   /api/projects/:id/check            Run the trust probe again
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

1. **Subscription limits** with several sessions running at once. The SDK reports plan usage, but how the hive should pace itself near the limits is still open.
2. **Several copies of one app running side by side:** ports, local databases, and file watchers that also see `.claude/worktrees`.
3. **Comparing screens with the mockup:** whether screenshots plus the tester's judgment are reliable enough, or a pixel diff is needed.
4. **Session archive:** Claude Code deletes old session files after a while, so the archive at Done must run before that happens.
5. **Projects in folders nobody has trusted.** Sessions there run without the project's CLAUDE.md. Adding a project runs a trust probe, a throwaway Haiku session that reports which CLAUDE.md files load, and the project's row warns when the repo has one that doesn't load.
6. **Your own settings reach every session** through `settingSources: ["user", …]`, including all your MCP servers and plugins, which full access lets every role use. The runner sets `permissionMode: "auto"` itself, so changing your own default doesn't change the hive.
7. **A question that waits for you for hours.** The turn that asked holds a `canUseTool` call open until you answer. Whether that holds for hours is untested. If it doesn't, the answer goes to the session as a new turn, as after a restart. The SDK's types also show that a question can resolve on its own after a stretch of idle time (`afkTimeoutMs`), which is untested too.

Copies from an earlier point, fixed-format reports and folder trust were checked on 2026-11-26; the results are in the Feasibility Notes of `CONCEPT.md`.
