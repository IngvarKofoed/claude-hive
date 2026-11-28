# Claude Hive — Architecture

## Overview

Claude Hive is a local web app. A Node backend runs on your Mac and drives every Claude session through the Claude Agent SDK, and a React page in your browser shows the board. The backend's parts split along one line: **plain code decides where things go, and Claude sessions do the work and the judging.**

- The **board engine** moves cards between lanes by fixed rules. No model routes work.
- Every Claude session, whether a lane's role or a manager, is started by the **session runner**. It runs on the Agent SDK as an ordinary Claude Code session.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                             Browser (React)                                             │
│       Board · For you · Card · Lane history · Rulebooks · Projects · Project chats · Role prompts       │
└─────────────┬───────────────────────────────────────────────────────────────────────┬───────────────────┘
              │                                                                       ▲ SSE: live events
              ▼ REST: moves, chat, comments, answers, sign-off                        │
              │                                                                       │
┌─────────────┴───────────────────────────────────────────────────────────────────────┴───────────────────┐
│                                     Hive backend (Node, localhost)                                      │
│                                                                                                         │
│ ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐  │
│ │ Board engine         │  │ Question router      │  │ Spec keeper          │  │ Review gate          │  │
│ │ lanes, moves,        │  │ chat lanes → page,   │  │ spec writer session, │  │ blind review,        │  │
│ │ loop guard           │  │ else manager ladder  │  │ one turn per batch   │  │ spec hash            │  │
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
| **Board engine** | Lanes, card moves, round limits and the loop guard. It reads each role's fixed-format report and decides the next lane. |
| **Session runner** | Starts, resumes and stops sessions. Applies each role's instructions and model, and runs every session with full access in auto mode. Catches questions through `canUseTool`. |
| **Project chats** | A project's chat sessions, with no card and no lane: their own tables, turn loop and drafts. Runs in the project's own folder. |
| **Question router** | Questions in the chat lanes go straight to the page. Questions in hands-off lanes go to the manager ladder. |
| **Spec keeper** | Judges each batch of spec issues as a new turn in the spec writer's session, which carries on after sign-off. |
| **Review gate** | Runs the blind spec review and tracks the spec's hash, so sign-off is only possible on reviewed text. |
| **Git service** | Worktrees, setup, checkpoints, bringing in main, and Ship. |
| **Preview service** | Gives each card's app its own port, starts and stops it, and takes screenshots for the mockup reference and the tester. |
| **History** | Every event on every card, each lane's changes, and the archive at Done. |

**REST** carries everything you do, and **SSE** (Server-Sent Events) pushes everything that happens. The page keeps one SSE connection open. Chat summaries on the board stay current through the `projectChat.updated` and `projectChat.deleted` events.

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
│   │       ├── board/         # Lanes, moves, round limits, loop guard
│   │       ├── sessions/      # Session runner, role loading, canUseTool
│   │       ├── questions/     # Question router and manager ladder
│   │       ├── chats/         # Project chats: their turn loop, questions and drafts
│   │       ├── spec/          # Spec keeper, review gate, spec-format loading
│   │       ├── git/           # Worktrees, setup, checkpoints, ship
│   │       ├── preview/       # Ports, running apps, screenshots
│   │       ├── history/       # Event log, lane diffs, archive
│   │       └── db/            # SQLite schema and queries
│   └── frontend/
│       └── src/
│           ├── styles/        # tokens.css: every color, font, size, spacing and radius, and nothing else
│           ├── pages/         # Board, For you, Card, Lane, Rulebooks, Projects, Role prompts
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
| `setup` | Refine, in the background | Sonnet | Only git-ignored local files, through the hive's copy tool, and dependencies; never tracked files | Work, new for each run |
| `designer` | Mockup | Opus | Only its mockup folder, `docs/mockups/<card>/` | Conversation |
| `spec-writer` | Spec | Opus | Only the spec file | Conversation, carried on after sign-off as the spec keeper |
| `spec-keeper` | Spec, then the lane the card is in | Opus | Only the spec file | Instructions that ride in the spec writer's session, sent at the top of each keeper message |
| `feedback-reader` | Try it | Opus | Nothing; reads your Send back feedback | Instructions that ride in the spec writer's session, sent at the top of the pick's message |
| `spec-amender` | Spec | Opus | Only the spec file | Instructions that ride in the spec writer's session, sent at the top of each amendment's message |
| `planner` | Plan | Opus | Nothing in the repo; writes the card's plan | Work |
| `developer` | Build | Opus, as the lead; each chunk on its own model through subagents | Code, in the card's worktree | Work |
| `reviewer` | Check | Opus | Nothing | Work, new for each round |
| `tester` | Check | Sonnet | Nothing; runs the app and takes screenshots | Work, new for each round |
| `manager` | any hands-off lane | Sonnet | Nothing; uses the hive's lookup tools | One-off, one for each question |
| `project-chat` | A project's chat, not a lane | Opus | Nothing; reads the person's checkout | Conversation, one per chat, run in the project's folder |
| `idea-draft` | A project's chat, not a lane | Opus | Nothing | Instructions that ride in the chat's session, at the top of each draft message, with the report `IDEA_DRAFT_SCHEMA { status, reason, title, text }`, listed in `ROLE_TURNS` |
| `spec-reviewer` | Spec | Fable | Nothing; reads only the spec file and `review.md` | One-off, blind |
| `committer` | Ship | Sonnet | Nothing; writes the commit message a card lands with | One-off |

- **One developer per card.** When the spec's Implementation strategy calls for several agents, the developer session runs them as its own subagents. So a card has one developer report, one session to resume, and one session committing in its worktree.
- **The developer is always Opus.** It does the plan's Opus chunks itself and gives each chunk on another model to a subagent on that model, through Claude Code's Agent tool. It merges, integrates, tests and reports on every card.
- **Every session has the same full access,** in Claude Code's auto mode, which the runner sets itself. A role's limits are only in its instructions: they say what the session is and whether it may change code. A reviewer doesn't edit because it's told not to, and nothing else stops it. A per-role permissions policy is parked.
- **What a role gets beyond its file** is in one table, `ROLE_TURNS` in `hive.ts`: the spec-format files appended after its instructions, the report schema its turns end with, the hive's own tools it's offered, and whether Claude Code's task-list tools are switched on (the developer's are, for its checklist). Every turn is started from it, and the Role prompts page reads it too, so the page shows what sessions really get.
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
    mcpServers: { hive },            // the hive's own tools, in-process: write_brief, copy_local_files, set_mockup
    allowedTools: hiveToolNames,     // the hive's own tools never wait on a permission check
    canUseTool,                      // questions, and anything auto mode passes on
  },
});
```

| Kind | Used for | How |
| --- | --- | --- |
| **Conversation** | Refine, Mockup, Spec: chats with you; the spec keeper after sign-off; project chats | One session per card per lane, resumed on every message, and again when feedback sends the card back. The designer builds mockup versions one after another in its session, resumed in each version's worktree. The spec writer's session carries on after sign-off, and each batch of spec issues is a new turn in it. A project chat has one session for its whole life, with no card, run in the project's own folder; `ProjectChats` drives the session runner itself. |
| **Work** | Plan, Build, Check | One session per card per lane. A card sent back resumes the same developer. Reviewer and tester start fresh each round. |
| **One-off** | Manager, spec reviewer | A new session, discarded after one answer |

**Role reports.** Each hands-off role ends its turn with a report checked against a JSON schema (`outputFormat`). The board engine routes on its fields, never on prose:

- **planner:** the steps, the chunks with the files each owns, the tests, and how each step is checked. The report is the plan: it's stored on the card, with no hive tool and no file in the repo;
- **spec reviewer:** findings, each a `decision` or a `fix`, with where, what's at stake, and the options;
- **developer:** what was built, departures from the plan, issues, and decisions made without you;
- **reviewer:** bugs, each with where in the code and what's wrong, which fail the round; and spec issues, in the developer's shape;
- **tester:** each How-to-verify bullet marked `pass`, `fail` or `cant-verify`, with evidence;
- **spec keeper:** one judgment for each open issue, with `issueId`, `verdict` (`spec-wrong`, `code-wrong` or `no-change`), `level` (`minor`, `changes-signoff` or `severe`), `reason`, `recommendation` (for `changes-signoff` and `severe`) and `repeats` (the earlier issue it's the same problem as, or null);
- **feedback reader:** each point of your Send back feedback, `bug` or `spec`, with why. `laneAfterSendBack` sends the card to Spec if any point is `spec`, otherwise to Build;
- **spec amender:** what the amendment changed, `review` (`true` or `false`), and why;
- **manager:** the ladder step, the answer or recommendation, and its source.

- **A report must be there to count.** The board engine routes only on `structured_output`. A turn that ends without one stops the card, even when its result says `success`: a session that can't satisfy the schema gives up in prose and still ends "successfully". `stop_reason` is no guide either, since a good report ends on `tool_use`.
- **Every report can say it's blocked:** a `status` of `done` or `blocked`, with a reason. Without it, a session that can't fill in a field makes up a value that passes the schema.

## Card Moves

| From | Event | To |
| --- | --- | --- |
| Ideas | You drag the card, or press Start | Refine, and the worktree is created. The card gets its ports, and the worktree's setup starts in the background. |
| Refine | You say **Good · on to Mockup** | Mockup. The hive makes the card's folder, `docs/mockups/<card>/`, sets `Card.mockup`, and starts the designer. A designer role that can't be loaded refuses the move. |
| Refine | You say **Good · skip to Spec** | Spec, with `Card.mockup` null: the lane strip shows "– Mockup". |
| Mockup | You say **Good · keep in docs/mockups** | Spec, after committing the folder alone as `Mockup: <title>`, with a `README.md` holding the link for a Claude Design mockup. Refused until the designer has named a mockup with `set_mockup`, for a folder of pages that's empty, and while the designer works or asks. A git error leaves the card in Mockup. |
| Mockup | You say **Good · don't keep** | Spec, with nothing committed. The folder stays in the worktree for the spec writer to read. |
| Spec | You press **Keep it after all**, for a mockup you didn't keep whose folder still has files | Stays in Spec. The folder is committed as Keep would, and a note goes in the chat. No turn starts, and the review isn't touched. |
| Spec | You **sign off** (only when the review is fresh) | Plan, and the spec writer's session carries on as the spec keeper. A mockup you didn't keep is deleted from the worktree after the spec is committed, so Build's checkpoint can't commit it; a failed delete refuses sign-off. |
| Spec | An amendment's turn reports `review: false`, and you haven't written in the chat | Plan, signed off on its own. The planner gets the spec's diff since the amendment started and plans only what's left. |
| Spec | An amendment's turn reports `review: true` | Stays in Spec while the blind review runs by itself, told what the amendment changed. Once it's fresh, Plan, signed off on its own unless you took over. |
| Spec | You wrote in the chat while an amendment was open | Stays in Spec once its turn ends: you sign off. A review the spec writer skipped counts for the text it vouched for. Answering its questions doesn't count as writing. |
| Spec | An amendment's turn is `blocked`, has no report, or fails, or signing off on its own fails | Stays in Spec, with Retry for the turn, or an error line for you to press Sign off |
| Plan | The planner's report is `done` | Build. Its plan is stored on the card, Check's rounds start over, the hive merges main into the card's branch, and the developer starts, or is resumed after a revised spec. Build first waits for a setup that's running, or runs one for a worktree that never had one. |
| Plan | The planner's report is `blocked` or missing | Stays in Plan, with the reason, Retry and **Back to Spec** |
| Plan | You press **Back to Spec** on a blocked plan | Spec. The planner's reason goes to the spec writer, and the spec needs a new review and sign-off. |
| Build | The developer's report is `done` | Check, with the issues found so far still on the card. The report is stored first, then the hive commits a checkpoint, and a new reviewer starts the next round. |
| Build | The report is `blocked`, the first in this Build visit | Stays in Build while the spec keeper judges the block. If it's about the spec, the keeper settles it and the developer is resumed, or a question waits for you on the card in Build and the developer is resumed with your answer. |
| Build | The keeper judges the block `no-change`, or the report is `blocked` a second time in the visit, or missing, or `done` while a merge of main is unfinished | Stays in Build, with the reason, Retry and **Back to Spec** |
| Build | The keeper judges the block `severe`, or a keeper turn fails | Stays in Build, with an error line, **Back to Spec** (and Retry after a failed turn) |
| Build | You press **Back to Spec** on a blocked build | Spec, after aborting an unfinished merge and committing the partial work. The developer's reason goes to the spec writer; after a new sign-off the planner re-plans and the same developer carries on. |
| Plan, Build, Check | You press **Back to Spec** while an amendment is open | Spec, still the same amendment. Your words and held answers stay for the developer, and the amendment's turn and its sign-off rules apply again. |
| Check | The reviewer finds a bug in round 1, or the tester finds a failure | Build, counting one round. The hive merges main again and resumes the same developer with the bugs. Spec issues wait on the card for the round that passes. |
| Check | Round 2 or later still finds bugs | Stays in Check, with **Back to Build** (one more round) and **Move on** (to Try it as built), until ■ stopped exists |
| Check | The reviewer's report is `blocked` or missing | Stays in Check, with Retry (a new reviewer for the same round) and **Move on** |
| Check | You press **Back to Build** or **Move on** | Build, with the last round's bugs, or Try it |
| Check | Everything passes, and the card has open spec issues | Stays in Check while the spec keeper judges the batch |
| Check | Everything passes, and there are no open issues, or the batch needs no code fix | Try it, or Ship for a card that Ship sent back, unless a question waits for you. Questions wait in Try it. |
| Check | The batch has a `code-wrong` / `minor` issue that isn't a repeat, and fewer than two keeper fix rounds have run since sign-off | Build. The hive merges main again and resumes the same developer with the fixes, and Check starts again at round 1. |
| Check | The batch has a `severe` verdict | Stays in Check, with the keeper's finding, **Back to Spec** and **Move on** |
| Check | You press **Move on** after a `severe` verdict | Try it as built: the severe issue and every `code-wrong` issue in the batch become questions |
| Check | A keeper turn fails (an error, Stop, `blocked`, or a report that misses an issue) | Stays in Check, with Retry and **Move on**. Move on takes the card to Try it with its open issues marked "Not judged". |
| Check | You press **Back to Spec** after a `severe` verdict | Spec. The keeper's finding goes to the spec writer, and the spec needs a new review and sign-off. Every issue still open or waiting is closed as "Settled in Spec". |
| Try it | You press **Send back** with feedback | Stays in Try it while the spec keeper reads it, a `send-back` turn in `Card.judging` with your words in `Card.sendBack`. When it ends, the card moves without asking, by the rows below. |
| Try it | Every point of the keeper's reading is `bug` | Build. Your words go to the same developer, with your held Change the code answers, and Check starts again from round 1. |
| Try it | Any point is `spec` | Spec, as a new amendment. The app stops, unsettled issues are settled, your words and held Change the code answers wait for the developer, and the spec writer's amendment turn starts. |
| Try it | The pick fails: `blocked`, no report, stopped, or cut off twice | Stays in Try it, with Retry, **Back to Build** and **Back to Spec**, which send your stored words there. Accept waits until you send them or Edit them away. |
| Try it | You answer a question with **Keep it as built**, or in your own words | Stays in Try it. The spec keeper changes the spec in an `answers` turn, and the hive commits it. |
| Try it | You press **Send back** with only Change the code answers held, once every question is answered | Build at once, with nothing to read. The issues answered **Change the code**, or in your own words, go to the same developer, and Check starts again at round 1. They don't count toward the keeper fix rounds. |
| Try it | You accept | Ship |
| Ship | You press **Back to Try it**, before landing starts | Try it |
| Ship | You press **Land on main**, and the commit reaches main | Done, after removing the worktree and branch |
| Build, Check, Try it | The card moves to another lane | That lane, after stopping what listens on the card's ports from inside its worktree |
| Ship | A conflict with the latest main | Build. After Check passes, it comes straight back to Ship. |
| Ship | A test fails on the squash, and you press **Back to Build** | Build, the same way, with the test output |
| Ship | A test fails, the push is refused, or main keeps moving | Stays in Ship, with the reason and Retry |
| Ship | It's on main | Done |
| any | A severe issue, or a round limit or the loop guard trips | Stays put, marked ■ stopped, with a card waiting for you. Until ■ stopped exists, a severe issue is an error line with buttons, as above. |
| any before Ship | You park it | Ideas. The worktree is removed and the branch kept. |
| any | You delete it | Gone, after everything it runs is stopped: its worktree and branch are removed and its rows deleted. Refused while it lands on main or moves. |

## Lane Actions

What you can do to a card in a lane (CONCEPT.md, Lane Actions) is defined once, in `packages/shared/src/laneActions.ts`. `LANE_ACTIONS` lists each lane's actions in display order, and the pure `laneActions(input)` returns the ones on offer, each with its label, whether it's enabled, and why not. It has two readers: the card page runs it on the live `CardDetail`, and `Hive.forYou()` runs it for each listed card, which gives every For you entry its `actions`. An error line's `actions` say which error actions it offers, and only the lane's last chat line offers them. `addError` is typed so that a literal lane accepts only the actions it lists. The definition decides only what the page offers: the server's guards (`Hive.good`, `signoff`, `retry` and the rest) are unchanged and still decide, from state the page never sees, such as a move under way or git at the moment of landing. The card page's components report each lane action they press, once its call succeeds, through a context in `frontend/src/components/laneActions.ts`; the Card page goes back to For you after any but Stop when its location state (React Router's, set by the For you entry's link and carried by the lane strip) says it was opened from there.

## Questions and Permissions

`canUseTool` catches **questions** (`AskUserQuestion`). Permission requests are decided by Claude Code's auto mode, which every session runs in.

- **In a chat lane,** a question goes straight to the page as part of the conversation.
- **In a hands-off lane,** a question goes to the manager ladder. Until the manager exists, the planner's, the developer's and the reviewer's questions come straight to you on the card page, like a chat lane's. The setup's questions are refused: it runs in the background with nobody to ask. So are the spec keeper's, during its turns, and the feedback reader's. An amendment's spec writer may ask you: the card is in Spec, so its questions are Spec chat.
- **In a project chat,** a question goes to the chat's page, kept on the chat's row, and puts a ● on the project's Chat button. It never reaches For you or the header's count. A permission request auto mode passes on is denied, since a chat never needs to change anything.
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
- **A chat's cut-off turn isn't resumed.** The chat gets an error line and waits for your next message. A draft left drafting becomes failed.
- **Answers outlive the turn that asked.** A question or Approve item waiting for you is a `PendingItem` row. If the turn that asked is gone when you answer, the answer goes to that session as a new turn, together with the question and options it asked.
- **The card apps the hive runs end with it.** At startup it sweeps a Try it card's ports and starts its app again, unless you stopped it: your Stop is stored on the card.
- **A landing survives a restart.** The hive stores the squash commit before the push. At startup, one whose commit is on main is finished; any other is undone, the worktree goes back to its branch, and Retry starts the landing over.

## Spec Keeper and Review Gate

**Review gate.**

1. **Review** is a button you press when you think the spec is ready.
   - It stores the spec's hash and starts the blind spec reviewer, a one-off Fable session that isn't kept.
   - The reviewer is given only the spec path and `review.md`, and returns a fixed-format report of findings.
   - While it runs, you can't message the spec writer.
2. **The findings go to the spec writer as one message.** It applies the fixes, and puts each decision to you with `AskUserQuestion`, using the reviewer's options. A decision you already settled is noted, not asked again.
3. **When that review turn finishes, the file's hash is recorded as the reviewed text,** so the answers you gave during it count as reviewed.
   - A review turn that is stopped, cut off or fails leaves the review unfinished, and Retry re-sends the findings.
   - Findings from a spec that changed during the review are dropped.
4. **Sign off** is enabled only while the spec on disk matches that hash. A changed spec greys it out until a new review has read it.
   - The hive reads the spec from disk, never from a session: after every turn, on every fetch, and by watching the spec's folder.
   - Signing off commits only the spec file on the card's branch.

**Spec keeper.**

- After sign-off, the spec writer's session carries on as the spec keeper. Nothing is frozen and nothing is copied.
- Its instructions live in `roles/spec-keeper.md` and are sent at the top of each keeper message, with the report format. The session's system prompt stays the spec writer's, because it is recorded at the first turn. `ROLE_TURNS` has a `spec-keeper` entry with its report, so the Role prompts page shows what the keeper gets.
- Judgments are batched: issues from Build and Check collect on the card and are judged in one batch once Check passes, while the card stays in Check. A blocking issue is judged at once, once per Build visit, while the card stays in Build. Each batch is a new turn in that session, given the open issues, the issues judged earlier on the card, and how to read the branch (`git diff <base>...HEAD`). The session remembers its earlier verdicts.
- `Card.judging` records which kind of turn is under way (`batch`, `as-built`, `blocking`, `answers` or `send-back`), so a restart, Retry and the end of the turn all know. A cut-off keeper turn is resumed once, like any hands-off turn.
- **The report must judge every open issue exactly once.** Anything else is a failed turn.
- **`spec-wrong`:** the session edits the spec in the worktree, and adds a dated line to `## Amendments` at the end of the spec. A repeat, or a level above `minor`, isn't edited.
- **`code-wrong`:** the card goes to Build with the issue in `Card.keeperFixes`, and the same developer is resumed. Check starts again at round 1, and its reviewer is asked to verify those fixes. An unfixed one is a bug, and goes through Check's usual round limit. `keeperRounds` counts these rounds since sign-off, and at two, further code fixes come to you as questions.
- **`no-change`:** nothing is edited.
- **`changes-signoff`, and any repeat:** the verdict becomes the recommendation on a question to you: keep it as built, or change the code. The card goes on to Try it as built.
- **`severe`:** the card stays where it is, with an error line and Back to Spec (and Move on in Check).
- **After each keeper turn,** the hive commits the spec file alone as `Spec keeper: <title>`, if it changed. While a merge of main is unfinished, git refuses a single-file commit, so the hive skips it, and the edit goes in with the developer's merge commit or the next checkpoint.
- **The keeper can't use `AskUserQuestion`** during its turns: `canUseTool` refuses it, because the session's lane is Spec and the question would reach the page as a Spec-chat question. Anything for you goes into the judgment.
- **Questions are ordinary `question` pending items** that carry `issueIds`, aligned with their questions. The item hangs on the spec writer's session, and the hive routes your answer itself: no session reads it. When the card enters Try it, one item holds every waiting issue, including those from earlier batches.
- **Your answers.** Keep it as built, and answers in your own words, go to the keeper in one `answers` turn at once, while the card stays in Try it. For your own words the keeper writes your decision into the spec without judging it again. A `no-change` issue answered Keep it as built needs no turn. Change the code answers, and your own words, are held on the issue until Send back.
- **The loop guard** is the `repeats` link, which any repeat sends to you whatever its verdict, plus the cap of two keeper fix rounds. `Issue.flips` counts the repeats in a chain, for history.

**Send back and amendments** (`docs/specs/2026-11-28-try-it-send-back.md`).

- **The pick** is a `send-back` keeper turn, with `roles/feedback-reader.md` at the top of its message. It reads your Try it words, edits nothing, and its questions are refused like the keeper's. `laneAfterSendBack` picks the lane from its points, and the card moves when the turn ends: nobody confirms it.
- **An amendment** is an `Amendment` row, opened by a pick that says Spec and closed when the card next enters Try it. `Card.amendment` points at it while it's open. Its `base` is the branch's head when it opened, and every "diff since the amendment started" is `git diff <base> -- <spec>`, so the keeper's earlier spec commits aren't counted as the amendment.
- **The amendment turn** is a spec writer turn with `roles/spec-amender.md` at the top of its message, ending with the amendment report. Its questions reach the page as Spec chat. It's resumed once after a restart, unless you took over.
- **After it,** plain code goes on: a `review: false` report records the spec's hash as `Amendment.skippedHash`; a message you write in the Spec chat sets `takenOver` and leaves Sign off to you; otherwise `review: true` starts the blind review, its brief adding the amendment's summary and diff, and a fresh review or a skipped one signs off on its own through `Hive.signoff`'s path.
- **The Sign off gate** is open while the review is fresh, or while the spec on disk matches `Amendment.skippedHash` (review state `skipped`). The automatic sign-off uses the same gate, and a failed one leaves an error line for you to press Sign off.
- **The planner and the developer** get the amendment's own messages: the spec's diff and "plan only what's left", then the new plan with your words and held answers. `Amendment.step` says how far the amendment is (`amending`, `spec`, `plan`, `build`, `after`), so only its first Build visit gets the amendment's message.
- **Check's reviewer and the keeper** are told every piece of your Try it feedback, oldest first. A difference you asked for is still reported, so the spec catches up, and the keeper judges it `spec-wrong` and `minor` where the spec doesn't already settle the point.

## Git

| When | What the git service does |
| --- | --- |
| Project added | Only a repo's top folder is added as it is. An empty folder (`.DS_Store` doesn't count), a new one you confirmed, or a repo's top with no commits and no files gets `git init -b main` (skipped when there's already a `.git`, where `HEAD` is pointed at `main`) and an empty first commit in your own git identity; a failed commit leaves the folder as it was. A folder with files that isn't a repo, a folder inside a repo, a worktree and git's own data are refused, naming the repo by its main checkout (by its bare repo or git dir when git knows no checkout) |
| Card enters Refine | `git worktree add <repo>/.claude/worktrees/<card> -b hive/<card> <base>`, where the base is a freshly fetched `origin/main`, or main without a remote; then the worktree's setup in the background. A setup session picks the git-ignored local files the app needs, and the hive copies them: never over an existing file, as copy-on-write clones, never from outside the checkout. The session installs dependencies and works out how to start the app and its tests on the card's ports. |
| Card enters Mockup | The card's folder `docs/mockups/<card>/` is made, named after the worktree. Keep commits it alone with `commitFile`; sign-off deletes one you didn't keep. |
| Mockup versions | One worktree per version, branched from the card's. The designer builds them one after another. The ones you don't pick are removed. |
| Each lane exit | A checkpoint commit on `hive/<card>` of everything left (`git add -A`, with `--no-verify`, since a checkpoint never lands on main), never over an unfinished merge. The lane's diff is saved to the card's history. Check, which changes nothing, makes none. |
| Build starts | Merge the base into `hive/<card>`: a freshly fetched `origin/main`, or local main without a remote (a merge, never a rebase). A merge that stops on conflicts, or that git refuses, is told to the developer as its first job. The card shows how many commits it's behind. |
| Ship | One project at a time: Land on main (the approval) → fetch → squash onto the base with `merge-tree` and `commit-tree`, touching no working folder; a conflict goes to Build → the message from the `committer` session, with `Spec:` and `Hive-Card:` lines → switch the worktree to the commit and run the setup's test command → `git push origin <commit>:refs/heads/main`, never forced (squash again if main moved, up to 3 times), or a fast-forward of local main without a remote → update your checkout's main only when it's safe → remove the worktree and branch |
| Park / Drop | Remove the worktree and keep the branch (Drop deletes it after a while) |
| Delete | `git worktree remove --force`, or `git worktree prune` when the folder is already gone, then `git branch -D hive/<card>`. A step that fails is reported, and the card is deleted anyway. |

Ship never touches uncommitted work in your checkout. It updates your checkout's main only when main isn't checked out there, or it is and the checkout is clean. Otherwise it tells you, and in a project with no remote it waits.

## Preview Service

- **Each project sets a run command** that takes its port from an environment variable.
- **Each card has a block of 10 ports** from 5200–5999, assigned when its setup starts and checked free. The setup works out how to start the app on them: each process's command, folder and port.
- **In Try it the hive runs the app** from those commands, as its own child processes, each in its own process group: it starts when the card enters Try it, and stops on Stop, when the card leaves Try it, and when the hive exits. Each command is checked first: its port must be the card's, its folder inside the worktree. The page shows each process's state, link and last output lines.
- **It keeps a list of what it started** and only ever stops those processes. Besides those, when a card leaves Build, Check or Try it, the hive stops what listens on the card's ports from inside its worktree, whoever started it.
- **Screenshots** are taken with Playwright: of the approved mockup at Good, and of the built screens in Check for the tester to compare.

## Data Model

| Table | Key fields |
| --- | --- |
| **Project** | name, path, trustWarning. The setup session decides each card's local files, install, start commands and test command, so there's no project-level run or test command. |
| **Card** | project, chatId (the project chat it came from; null for a typed idea, and nulled when the chat is deleted), title (starts as the idea's title; the brief's title replaces it in Refine), ideaTitle, ideaText, lane, state (working / needs-you / stopped), branch, worktreePath, brief, mockup (the card's mockup once it has entered Mockup: its folder `docs/mockups/<card>`, what the designer last named with `set_mockup`, a page or a link, and whether you kept it; null for a card that skipped Mockup. The folder's files are read from disk on each fetch), moveError, port (the first of the card's 10), setup (the worktree's setup: what was copied, how to start the app and its tests), feedback (your Try it words, until the developer's next `done` report), appStopped (you stopped its app in Try it), landing (a landing under way: base, commit, pushed), landed (the commit it landed as, and whether your checkout's main followed), shipAfterCheck (Ship sent it back to Build, so after Check it returns to Ship), specPath (always under `docs/specs/` in the worktree), reviewedSpecHash, reviewApplying (a review's findings sent but not yet applied in full), plan (the planner's report), build (the developer's last `done` report, with the files changed against main; cleared each time the card enters Build), check (Check's last finished round: its number, the reviewer's summary and the bugs; cleared when a new plan is done), judging (which keeper turn is under way: batch / as-built / blocking / answers / send-back, and its issue ids), sendBack (your Send back words while the keeper reads them, or after its pick failed; cleared when the card leaves Try it), amendment (the open amendment, from Send back until the card next enters Try it), keeperFixes (the issues going to the developer, and the lane they came from; cleared on the developer's next `done` report), keeperRounds (keeper fix rounds since sign-off; cleared at sign-off), blockJudged (this Build visit has had its keeper turn; cleared when the card enters Build), checklist (the developer session's own task list, read from its `TaskCreate` / `TaskUpdate` calls and shown live in Build; emptied only when a new developer session starts), waitingSince (when the card started waiting for you: set when it starts needing you, or changes lane while it does; For you sorts on it) |
| **LaneVisit** | card, lane, enteredAt, leftAt, outcome, round |
| **Session** | card, lane, role, kind, sessionId, startedAt, turnRunning, existsYet (a first turn created it, so later turns `resume`), lastMessage (what Retry sends again) |
| **Version** | card, label, worktreePath, screenshot, picked |
| **Amendment** | card, n, words (your Try it feedback), points (the keeper's reading), base (the branch's head when it opened), step (amending / spec / plan / build / after), takenOver (you wrote in the Spec chat), summary, review and reason (the spec writer's report), skippedHash, signedOff (auto / you), reviewed |
| **Issue** | card, foundIn, where (the spec's section), problem, guess (what was built instead), status (open, spec-fixed, no-change, sent, fixed, judged, severe, waiting, held, kept, settled), the keeper's judgment (verdict, level, reason, recommendation, repeats), answer (yours), flips (the repeats in a chain) |
| **Decision** | card, lane, what, alternative, sessionId, source |
| **PendingItem** | card, session (where the answer goes), kind (question / permission / approve / severe / loop), payload, recommendation, answer. `permission` is a request auto mode passed on in a chat lane. |
| **Chat** | project, title, sessionId, existsYet, turnRunning, lastMessage, pending (the question waiting for you), draft (the idea-draft turn's state and result), createdAt, updatedAt |
| **ChatEvent** | chat, at, type (`chat` or `error`), data. The chat page shows its messages from these rows. A "Made an idea" note's data also holds the card's id, which the chat page links to; a note whose card no longer exists shows as plain text. |
| **Rule** | project (or shared), text, origin card, status (active / suggested) |
| **Event** | card, at, type, data. Every row of a card's history: `chat` (a message, yours or a session's text block), `error` (a failed or cut-off turn), `brief` (every version of the brief), `plan` (every plan), `build` (every `done` report), `check` (every finished round, with its spec issues), `judged` (every keeper turn's judgments), `feedback` (your Try it words), `accept`, `landed` and `setup` so far. The page shows the chat from these rows, never from Claude Code's transcripts, which Claude Code deletes after a while, and a card's history of plans, builds, Check rounds and feedback from them too. |

## API

```
GET    /api/board                         Projects × lanes with their cards
POST   /api/cards                         New idea { projectId, title, text, chatId? }
PATCH  /api/cards/:id                     Edit an idea { title, text }, only in Ideas
POST   /api/cards/:id/move                Drag { lane }; also park and drop
DELETE /api/cards/:id                     Delete the card: { left } lists anything git left behind
GET    /api/cards/:id                     The card with every lane's history
POST   /api/cards/:id/messages            Chat in the current lane { text }
POST   /api/cards/:id/comments            Comment { on: spec | mockup, anchor, text }
POST   /api/cards/:id/good                Leave Refine { skipMockup? } or Mockup { keep }
GET    /api/cards/:id/mockup/<path>       A file of the card's mockup folder, sandboxed and never cached
POST   /api/cards/:id/keep-mockup         Commit a mockup you didn't keep, while the card is in Spec
POST   /api/cards/:id/review              Start the blind review of the spec
POST   /api/cards/:id/signoff             Leave Spec (refused unless the review is fresh)
POST   /api/cards/:id/back-to-spec        Send a blocked plan or build, a Check stopped by a severe verdict, or a failed Send back pick, back to Spec
POST   /api/cards/:id/back-to-build       One more Check round for a card Check stopped, or a failed Send back pick to Build
POST   /api/cards/:id/move-on             Move a card Check stopped, couldn't review, or couldn't judge, on to Try it
POST   /api/cards/:id/versions/:v/pick    Pick a mockup version
POST   /api/cards/:id/feedback            Send back { text, lane? }: without a lane the keeper reads it and the card goes to Build or Spec; text may be empty when Change the code answers are held
DELETE /api/cards/:id/send-back           Edit: clear your stored Send back words after a failed pick
POST   /api/cards/:id/stop                Stop the running turn
POST   /api/cards/:id/retry               Send a failed turn's message again
POST   /api/cards/:id/accept              Accept in Try it
GET    /api/cards/:id/ship                What Land on main would do now
POST   /api/cards/:id/land                Land on main { discard? }
POST   /api/cards/:id/back-to-tryit       Out of Ship, until Ship is built
POST   /api/cards/:id/setup               Set up the worktree (again)
POST   /api/cards/:id/app/start           Start the card's app in Try it · /app/stop · /app/restart
GET    /api/for-you                       Everything waiting for you, each with its lane actions
GET    /api/roles                         Every role: its file, and what its sessions get beyond it
POST   /api/for-you/:itemId               Answer, approve or decide
GET    /api/projects/:id/chats            The project's chats, newest first
POST   /api/projects/:id/chats            New chat with its first message { text }
GET    /api/chats/:id                     One chat, with its messages, question and draft
POST   /api/chats/:id/messages            Chat { text }
POST   /api/chats/:id/answer              Answer the chat's question { itemId, answers }
POST   /api/chats/:id/stop                Stop the chat's turn
POST   /api/chats/:id/draft               Make it an idea: start the draft turn
DELETE /api/chats/:id/draft               Close the draft
DELETE /api/chats/:id                     Delete the chat; ideas made from it keep their copy
GET    /api/lanes/:lane/history           A lane across all cards
GET    /api/rules  · POST · PATCH         Rulebooks and suggested rules
GET    /api/projects · POST · PATCH       Projects and their settings; POST { path, create? } answers { missing } for a folder that doesn't exist
POST   /api/projects/:id/check            Run the trust probe again
GET    /api/folders?path=                 The folder names that complete a typed path, as whole field values
GET    /api/usage                         Plan usage: 5-hour and 7-day windows
GET    /api/health                        Status and the app's version
GET    /api/events                        SSE stream
```

The mockup route is the one exception to the local-only guard: a sandboxed mockup page runs in an opaque origin, so its own module scripts, fonts and `fetch()` calls arrive with `Origin: null`. Only `GET` and `HEAD` of a mockup file are let through with it, and only that route sends `Access-Control-Allow-Origin: *`. Every other route still refuses any Origin that isn't the hive's own.

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
| Frontend | React, TypeScript, Vite, CSS Modules on design tokens (CSS custom properties); `react-markdown` and `remark-gfm` render specs |
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
2. **Several copies of one app running side by side:** ports, local databases, and file watchers that also see `.claude/worktrees`. Each card's own ports and copied local files cover the first two for apps whose ports can be set from outside; a port fixed in a tracked file, a server database and file watchers remain.
3. **Comparing screens with the mockup:** whether screenshots plus the tester's judgment are reliable enough, or a pixel diff is needed.
4. **Session archive:** Claude Code deletes old session files after a while, so the archive at Done must run before that happens.
5. **Projects in folders nobody has trusted.** Sessions there run without the project's CLAUDE.md. Adding a project runs a trust probe, a throwaway Haiku session that reports which CLAUDE.md files load, and the project's row warns when the repo has one that doesn't load.
6. **Your own settings reach every session** through `settingSources: ["user", …]`, including all your MCP servers and plugins, which full access lets every role use. The runner sets `permissionMode: "auto"` itself, so changing your own default doesn't change the hive.
7. **A question that waits for you for hours.** The turn that asked holds a `canUseTool` call open until you answer. Whether that holds for hours is untested. If it doesn't, the answer goes to the session as a new turn, as after a restart. The SDK's types also show that a question can resolve on its own after a stretch of idle time (`afkTimeoutMs`), which is untested too.

Copies from an earlier point, fixed-format reports and folder trust were checked on 2026-11-26; the results are in the Feasibility Notes of `CONCEPT.md`.
