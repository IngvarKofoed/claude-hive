# First slice: board, Refine chat and session runner

The hive's first working slice. You add a project, type an idea into its Ideas cell, drag the card to Refine,
and chat on the card page with a product owner session that has read the repo through a fresh worktree. The
product owner opens with a draft brief and keeps it next to the chat through a `write_brief` tool the hive
provides. Under it sit the pieces every later lane needs: the npm workspace, SQLite, the live event stream, and
the session runner on the Agent SDK. It also corrects two stale lines in `packages/backend/CLAUDE.md`.

## Outcome

**What you get:**

- `npm run dev` starts the hive on `127.0.0.1` and opens a board with all ten lanes as columns and your projects
  as rows. The header shows the app's version.
- You add a project by its path, type an idea into its Ideas cell, and drag the card to Refine. Its worktree
  appears at `<repo>/.claude/worktrees/<card>` on branch `hive/<card>`.
- On the card page the product owner opens with a draft brief. You chat with it, its replies appear as they're
  written, and the brief panel updates whenever it changes the brief.
- When the product owner asks a question, it shows in the chat with its options. Your pick, or your own words,
  go back to it.

**How to verify:**

- Add a repo, create an idea and drag it to Refine. `git worktree list` in the repo shows the card's worktree
  on `hive/<card>`, and the card page shows the product owner's first reply and a brief.
- Send a message. The reply appears word by word, and the brief panel changes when the product owner updates
  the brief.
- Stop the backend mid-conversation, start it again and reload the page. The chat, the brief and the card's
  lane are all still there, and your next message continues the same conversation.
- After the whole flow, `git status` in your own checkout shows nothing new or changed.

## Key decisions

- **The brief is written through a hive tool** (new). The runner gives the product owner a `write_brief` tool
  from an in-process MCP server (`createSdkMcpServer`, server name `hive`). Each call replaces the card's
  brief in SQLite and pushes it to the page. Refine never writes to the repo, as `CONCEPT.md` says. Chosen
  over a brief file in the worktree and a fixed-format reply per turn (see Alternatives).
- **The brief has fixed sections** (new). `write_brief` takes `title`, `problem`, `whoItsFor`,
  `whatDoneLooksLike[]`, `outOfScope[]` and `openPoints[]`. The middle four are the brief's parts from
  `CONCEPT.md`. `title` names the card, and `openPoints` holds what is still being asked. `title` and `problem`
  are required; the lists may be empty. The page renders the sections without a Markdown library, and later
  lanes can read each part. The mockup's "Rules applied" block waits for the rulebook.
- **One session runner for every role** (new). `packages/backend/src/sessions/` wraps `query()` with the
  options `ARCHITECTURE.md` fixes: the `claude_code` preset plus the role's instructions,
  `permissionMode: "auto"`, `settingSources: ["user", "project", "local"]`, streaming input,
  `includePartialMessages`, a hive-chosen `sessionId` on the first turn and `resume` after it. It runs one turn
  at a time per session. Only the product owner uses it in this slice, but it is built for every lane.
- **Questions go through `canUseTool` to the chat** (reuses the tested behaviour). Every role asks with
  `AskUserQuestion`, in Refine too. It becomes a `PendingItem` and a question with option buttons in the chat.
  Your pick, or your own words, goes back as the tool's `answers`. Calls to the hive's own tools are allowed
  there too. Auto mode decides everything else.
- **The chat lives in the hive's database** (new). Each finished text block is an `Event` row and its own bubble.
  The page never reads Claude Code's transcript files, which Claude Code deletes after a while. Partial text
  and tool activity only travel over the event stream.
- **Trust is checked when a project is added** (new). A short throwaway session in the repo reports which
  `CLAUDE.md` files load, the probe tested on 2026-11-26. If the repo has one and none loads, the project
  carries a warning before any card starts. This is risk 5 in `ARCHITECTURE.md`.
- **The worktree folder is hidden from your checkout through the repo's exclude file** (new). That file lives
  in the git folder rather than the working tree, so adding `.claude/worktrees/` there keeps `git status` in your
  checkout clean without touching any of your files. Its path comes from `git rev-parse --git-path
  info/exclude`, which also works when `.git` is a file.
- **Stack and new dependencies** (reuses `ARCHITECTURE.md`). The workspace has npm packages `shared`, `backend`
  and `frontend`.
  - Backend: Express, `better-sqlite3`, `@anthropic-ai/claude-agent-sdk` and `zod` (the SDK's `tool()` takes a
    zod schema), run with `tsx` in dev.
  - Frontend: React, Vite, CSS Modules on the mockup's tokens, and `react-router` for its two pages.
  - Tests: Vitest, with React Testing Library on the frontend.
  - Drag and drop uses the browser's own API, with no library.

## Goals

- Prove the session runner, the event stream and worktree creation end to end, in the one lane where you're in
  the loop.
- Lay the workspace, database and page skeleton every later slice builds on.

## Non-goals

- **Lanes:** Good, Mockup and every later lane. The board shows those lanes as empty columns, and a card stays
  in Refine.
- **Other parts of the hive:** For you, the manager, rulebooks, Ship, park and drop.
- **Limits:** lane limits are shown in the lane headers but not enforced.
- **Projects:** `git init` for plain folders, a project's setup command and local files, and the preview
  service.
- **Brief features:** comments made by selecting text in the brief, and highlighting what changed in it.
- **Restarts:** the full restart recovery for hands-off lanes. This slice only needs what a chat lane needs.
- **Cleanup:** with no park or drop, worktrees and branches from test cards are removed by hand.

## Design

### Workspace

- **Packages:** `packages/shared` holds the types both sides use: API bodies, event-stream messages and the
  brief.
- **`npm run dev`** at the root starts the backend (`tsx watch`, on `127.0.0.1:${HIVE_PORT:-4317}`) and Vite.
  Vite sends `/api` through to the backend.
- **Version:** each package's `predev` and `prebuild` run `scripts/gen-version.mjs`, so the header and
  `GET /api/health` show the version. This settles the oldest item in `docs/CLAUDE_TODO.md`, and that line is
  deleted in the same change.
- **Data:** the database is `~/.claude-hive/hive.db`.
- **Only the page may call the API.** Binding to `127.0.0.1` doesn't stop a web page you visit from reaching
  the hive through DNS rebinding, and this API starts full-access sessions on paths and prompts the caller
  picks. So the backend:
  - refuses a request whose `Host` isn't `127.0.0.1` or `localhost` on its own port;
  - refuses a foreign `Origin`;
  - sends no CORS headers;
  - accepts JSON bodies only.

### API

The endpoints this slice builds, a subset of `ARCHITECTURE.md`'s API. `stop`, `retry` and `check` are new.

```
GET    /api/board                         Projects × lanes with their cards
POST   /api/projects                      Add a project { path }; runs the trust probe
POST   /api/projects/:id/check            Run the trust probe again
POST   /api/cards                         New idea { projectId, text }
GET    /api/cards/:id                     The card: brief, chat, waiting question
POST   /api/cards/:id/move                { lane: "refine" }
POST   /api/cards/:id/messages            Chat message { text }
POST   /api/cards/:id/stop                Stop the running turn
POST   /api/cards/:id/retry               Send a failed turn's message again
POST   /api/for-you/:itemId               Answer a waiting question
GET    /api/health                        Status and the app's version
GET    /api/events                        The event stream
```

### Data

The slice creates only the tables it uses, with the fields from `ARCHITECTURE.md` it needs. Later slices add
the rest.

- **Project:** name, path, and whether the trust warning is on.
- **Card:** project, title, idea text, lane, state (`working` / `needs-you`), branch, worktree path, brief
  (JSON). The `brief` field is new, and the Data Model table gains it when this lands.
- **Session:** card, lane, role, kind, sessionId, startedAt, whether a turn is running, and whether the session
  exists yet, meaning a first turn got far enough to create it.
- **PendingItem:** card, session, kind (`question`), payload (the question and options as asked), answer.
- **Event:** card, at, type, data.
  - `chat` rows hold messages (`from: "you" | "product-owner"`, text).
  - `brief` rows hold every brief change, so the brief's history is kept from the start.
  - `error` rows hold failed turns.

### Board and moves

- **`POST /api/projects { path }`** adds a project. The path must be an existing git repo with a `main` branch,
  and anything else is refused with a message saying why. The path is resolved to the repo's root
  (`git rev-parse --show-toplevel`), and a root that is already a project is refused.
- **The trust probe** runs as the project is added. It is one turn in the repo root:
  - model Haiku 5.5, `persistSession: false`, no tools, and the same `settingSources` as every session;
  - `getContextUsage().memoryFiles` is read before the query closes.

  If the repo has a `CLAUDE.md` and none loaded, the project is still added, but its row warns that Claude Code
  doesn't trust the folder. The fix it shows is to open Claude Code in the repo once and accept. A "Check again"
  action re-runs the probe. Worktrees inside a trusted repo inherit its trust, so one check covers them. Worktrees always start from `main`, which is what the
  docs assume everywhere. Plain folders, and the `git init` that `CONCEPT.md` promises for them, come in a later
  slice. The project's name is the folder name.
- **`POST /api/cards { projectId, text }`** creates a card in Ideas. Its title is the idea's first sentence,
  cut to 60 characters, until the product owner gives it one through `write_brief`.
- **`POST /api/cards/:id/move { lane: "refine" }`** is the only move in this slice, so `board/` has one rule:
  Ideas → Refine. Any other move is refused with `409`.
- **Entering Refine,** the git service:
  1. runs `git worktree add <repo>/.claude/worktrees/<slug> -b hive/<slug> main`, where the slug is made from
     the title plus a short id;
  2. adds `.claude/worktrees/` to the repo's exclude file if it isn't there yet.

  The card's lane changes only once the worktree exists. If either step fails, the card stays in Ideas, and the
  tile shows git's reason. Then the runner starts the product owner.

### Session runner

- **Each turn is one `query()` call.** Its options:
  - `cwd`: the card's worktree;
  - `systemPrompt`: `{ type: "preset", preset: "claude_code", append: <role instructions> }`;
  - the role's `model`, `permissionMode: "auto"` and `settingSources: ["user", "project", "local"]`;
  - `includePartialMessages: true`;
  - `mcpServers: { hive }`, built for this card;
  - `canUseTool`.

  The first turn passes the `sessionId` the hive chose. Every later turn passes `resume`.
- **Streaming:**
  - text deltas go out as `chat.delta` events;
  - each finished text block is stored as a `chat` event, its own bubble, and sent as `chat.message`;
  - each tool call goes out as a passing `activity` event ("reading src/market.ts…"), which isn't stored.

  A page reloaded mid-turn shows every finished bubble, and the block being written appears once it's done.
  The result ends the turn: the session is marked idle, and the card becomes `needs-you`.
- **Failures:** a turn can end in an error result, or `query()` can throw (not logged in, plan limit, SDK
  error). Either way:
  - the error is stored as an `error` event and shown in the chat with **Retry**;
  - the session is marked idle and the card becomes `needs-you`.

  Retry sends the failed turn's message again. It passes `sessionId` if the session doesn't exist yet and
  `resume` if it does, so a first turn that failed before creating the session can still start.
- **One turn at a time per session.** A message you send while a turn runs joins that turn through the input
  stream, as `ARCHITECTURE.md` says. The exception is a message sent while a question waits: it answers the
  question instead (see Questions). `POST /api/cards/:id/stop` calls `interrupt()`.
- **The first turn starts automatically on entering Refine.** Its message gives the idea text and asks the
  product owner to read the repo and open with a draft brief.
- **The runner sits behind an interface,** so the backend's tests run it as a fake that replays scripted SDK
  messages, as `packages/backend/CLAUDE.md` requires.

### The product owner role

`roles/product-owner.md` has front matter at the top (`model: opus`, `kind: conversation`), then its
instructions:
- read the repo and don't change any file;
- keep the brief current through `write_brief`, and call it whenever the brief changes;
- ask questions with `AskUserQuestion`, never in the reply, as the role-instruction rule in `ARCHITECTURE.md`
  says. An open question still goes through it, with the likely answers as options, because you can always
  answer in your own words;
- say when it thinks the brief is ready, but leave moving the card to you.

### Questions

`canUseTool` behaves like this:

- **`AskUserQuestion`:** stores a `PendingItem`, sends `question.asked` and sets the card to `needs-you`, then
  waits. When you answer on the page, it returns `{ behavior: "allow", updatedInput: { ...input, answers } }`.
- **`mcp__hive__*`:** allowed.
- **Anything else auto mode passes on:** shown in the chat as an allow-or-deny question. None did in our tests,
  so this path is rare.

How a question shows and is answered:

- **Each question in the call** shows its options as buttons, or as toggles when it is multi-select, plus a
  free-text field. One Send answers every question in the call.
- **The answer** goes into `answers`, keyed by the question's text: a picked label, comma-separated labels, or
  your own words. That is the field the model reads.
- **A message you type in the reply box while a question waits** answers it: the text becomes the answer to every
  question in the call you haven't picked an option for.

If the backend restarts while a question waits, the turn is gone but the `PendingItem` isn't. Your answer then
goes to the session as a new turn, with the question and options it asked. The same path applies when the
`canUseTool` call itself is aborted or times out.

A turn cut off by a restart is not resumed automatically, unlike the hands-off lanes in `ARCHITECTURE.md`. The
session is left idle, the chat says the last reply was cut off, and you carry on by sending a message. You're in
the conversation, so an automatic retry would only talk over you.

### The page

Two pages, styled from `docs/mockups/` (`Main.dc.html`, `CardRefine.dc.html`) on the tokens in
`docs/mockups/README.md`. Both use REST plus one `EventSource` on `/api/events`.

- **Board:**
  - all ten lanes as columns, with who works in each and its limit;
  - projects as rows, each with an "Add an idea" input in its Ideas cell;
  - card tiles with a badge: ▶ while a turn runs, ● when it's your turn, and git's reason when a move failed;
  - drag a tile from Ideas to Refine to start it;
  - an "Add project" form for a path, and the trust warning with "Check again" on a project's row.
- **Card:**
  - a header with the title, the state, and the branch and worktree path;
  - the lane steps;
  - the chat on the left:
    - a bubble per text block, with streaming text;
    - the passing activity line while a turn runs;
    - questions with option buttons and a free-text field;
    - error lines with Retry;
    - a reply box and Stop;
  - the brief on the right, one block per section.
  - No Good button yet.

### `packages/backend/CLAUDE.md`

Two lines change:

- **The stale Safety line,** "it never edits files in a project's own checkout; at Ship it only fast-forwards
  main and pushes", becomes: "it never touches uncommitted work in a project's own checkout; at Ship it pushes
  main and updates the checkout's main only when that's safe (`docs/ARCHITECTURE.md`, Git)".
- **The `claude-api` skill line** sends the builder to the reference for the Claude API SDK, which says it
  doesn't cover the Agent SDK the hive uses. It now points at the Agent SDK's own type definitions,
  `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`. The builder reads them before writing or changing code
  that calls `query()`, `canUseTool`, `resume`, `outputFormat`, the in-process tool server or plan usage. Every
  option is documented there with comments, and today's SDK tests worked from them.

### Docs that change with this slice

These land with the code, with a changelog entry:
- in `ARCHITECTURE.md`'s Data Model:
  - `Card.brief`;
  - the chat and errors as `Event` rows;
  - `Session`'s "turn running" and "exists yet" fields;
  - the project's trust warning;
- the `hive` tool server in its Sessions section, and the `stop`, `retry` and `check` endpoints in its API;
- risk 5, now handled by the trust probe when a project is added;
- in Restarts and Long Waits, that a chat lane's cut-off turn waits for you instead of being resumed;
- the two backend `CLAUDE.md` lines above.

## Alternatives considered

- **A brief file in the worktree** (`.hive/brief.md`). It's the simplest option, but Refine would change the
  worktree, which `CONCEPT.md` rules out. The file would have to be kept out of checkpoints and Ship, and the
  page would only see the brief at the end of a turn.
- **A fixed-format reply every turn** (`{ reply, brief }`). The reply text would sit inside JSON, which makes
  streaming awkward, and every chat turn would have to produce a report.
- **Prose questions in the chat lanes** (raised by the review). The product owner could have asked in prose, as
  the mockup shows. Rejected: every role asks through `AskUserQuestion`, so questions work the same in every
  lane, and the free-text answer keeps open questions open.
- **One bubble per turn holding only the final reply** (raised by the review). That would be closer to the
  mockup, but it hides what the product owner said along the way. Every text block is kept instead.
- **Checking trust after the first turn** (the first draft). Rejected: by then the first turn has already run
  without the project's `CLAUDE.md`.
- **Reading the chat back from Claude Code's transcripts** (`getSessionMessages`). Claude Code deletes old
  session files, and the hive should own its history.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: the lead plus 2 chunks.** The lead sets up the workspace and pins `packages/shared` (API
  bodies, events, brief). It then builds the backend core: the session runner, the `hive` tool,
  `canUseTool`, the database, the routes and the event stream, plus the final integration.
- **The two chunks run in parallel** once `shared` is pinned. One builds the git service in
  `packages/backend/src/git/` (worktree add, the exclude line), with tests on a throwaway repo. The other
  builds the frontend in `packages/frontend/` (board and card pages) against the shared types.
- **Opus 5.5 for the lead, Sonnet 5.5 for both chunks.** The runner and the hive tool are the `(new)` parts
  that need interpreting. The git service and the UI follow settled interfaces and the mockup.
