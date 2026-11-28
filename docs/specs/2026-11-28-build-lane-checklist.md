# Live Build lane: the developer's checklist in place of the plan

While a card is in Build, the right-hand column now shows the developer's own checklist, ticked off live as it
works, instead of the plan. The plan is the Plan lane's work, and ✓ Plan in the lane strip shows it with every round.
This follows a rule for the whole card page, set here and applied to Build first: **a live lane shows its own work,
and what sent the card back to it; what earlier lanes produced is one click away in the lane strip.** The checklist
is the task list Claude Code keeps through its own tools, switched on for the developer's sessions, read from its
messages and stored on the card.

## Outcome

**What you get:**

- While the developer builds, the right side shows its checklist: each item waiting, in progress or done, updating as
  the developer works. The live Build lane no longer shows the plan.
- When Check sent the card back, its bugs stay on top ("Check found"). When you or Ship sent it back, your words or
  Ship's reason are on top, under "Sent back from Try it" or "Sent back from Ship".
- Until the developer starts a checklist, one muted line says it will show there.
- The checklist is still there after a page reload or a hive restart mid-build.

**How to verify:**

- Sign off a small spec whose plan has a few steps. When Build starts, the right side has no plan and says the
  checklist shows there once the developer starts one. Its checklist appears soon after, and items turn done as it
  works, without a reload.
- Reload the page mid-build: the checklist is there as it last was. ✓ Plan in the lane strip still shows the plan.
- Give feedback in Try it: back in Build, "Sent back from Try it" shows your words above the developer's checklist,
  which carries on from the last visit with the new work added. A Check round that finds bugs: "Check found" shows
  them above it.

## Key decisions

- **A live lane shows its own work** (new). The column next to a live lane's chat holds what that lane is producing,
  plus what sent the card back to it. Ideas, Refine and Spec already work this way. Build follows it from now on.
  Check keeps the build report beside its findings for now: the reviewer is judging that build, and you decide Back to
  Build or Move on from it. Try it, Ship and Done stay as they are.
- **No plan in the live Build lane** (diverges). `docs/specs/2026-11-26-build-lane-developer.md` put the Plan panel
  next to the developer's chat. The plan is the planner's output, and the developer's checklist is how it's being
  worked through.
- **The developer's own checklist is the progress** (new). Claude Code keeps a session's task list through its own
  tools. In Claude Code 2.1.332 they are `TaskCreate` and `TaskUpdate`, which change one item per call, and a new
  item's id comes back in the tool's result. Older versions had `TodoWrite`, which sends the whole list on every call.
  The session runner reads it too, so a version that brings it back still works. It reads only the developer's own
  messages, never its subagents', as the activity line does.
- **The task-list tools are switched on for the developer** (new). An SDK session doesn't get them by default
  (tested on 2026-11-28; `CONCEPT.md`, Feasibility Notes). The developer's sessions start with
  `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, which adds `TaskCreate`, `TaskUpdate`, `TaskList` and `TaskGet` and keeps every
  default tool. The variable isn't documented. If an update drops it, the checklist stays on its empty line and
  nothing else breaks.
- **Stored on the card, for the developer's whole session** (extends). A `checklist` column on `cards`, holding JSON
  as `plan` and `build` do. It mirrors the list the developer session holds, so it isn't emptied when the card comes
  back to Build: the same session carries on its list, and with the per-item tools its updates name items from
  earlier visits. It's emptied only when the hive starts a new developer session. It's working state, not history,
  so no event rows. `CardDetail` gains `checklist: ChecklistItem[] | null`, so a reload or a restart shows it.
- **Live through `checklist.updated`** (extends). A new SSE event carrying the whole list, the way `plan.updated`
  carries the plan.
- **The developer is asked to keep one** (extends). One line in `roles/developer.md`, so the checklist doesn't depend
  on the model choosing to make one.
- **Why it's back, from what the card holds** (reuses). "Check found" is `check.bugs`, as today. "Sent back from …" is
  `Card.feedback`, which holds your Try it words or Ship's reason until the developer's next `done` report.
  `CardDetail` gains `shipAfterCheck`, so the heading can say which lane sent it back.

## Goals

- See how far a build has got, and what the developer is doing, without reading its chat.
- Stop repeating an earlier lane's work in a live lane, and set the rule for the next changes to this area.

## Non-goals

- **Progress through the planner's steps.** The checklist is the developer's own and isn't matched to the plan.
  Ticking off plan steps through hive tools stays rejected, as in `2026-11-26-build-lane-developer`.
- **Subagents.** The SDK reports each subagent's start, progress summaries and end. A line per chunk can come later.
- **The checklist after Build.** Check, Try it and ✓ Build don't show it, and a build round in the history doesn't
  keep it.
- **Other lanes' checklists.** The planner and the reviewer may keep task lists too. Only the developer's is read.
- **Changing Check, Try it, Ship or Done.**

## Design

### Build's right column

Top to bottom, each shown only when it has something:

1. **Sent back from Try it** or **Sent back from Ship:** `Card.feedback`, as written, with its line breaks.
2. **Check found:** the last round's bugs (`CheckView`), as today.
3. **Checklist:** one row per item, in the developer's order. A done item is marked ✓ and muted, the item in progress
   is marked ▶ and stands out, and a waiting one is marked ○. Before there's a list, it reads "The developer's
   checklist shows here once it starts one."

The status is a `data-status` attribute the CSS selects on, per the frontend rules. A blocked or failed turn changes
nothing here: its Retry and Back to Spec are in the chat, and the checklist stays as the developer left it.

### Reading the checklist

The session runner gains a handler, `onChecklist(change)`, called for the session's own tool calls:

```ts
type ChecklistChange =
  | { kind: "replace"; items: ChecklistItem[] }                        // TodoWrite: todos → { id: null, text: content, status }
  | { kind: "add"; id: string; text: string }                          // TaskCreate, once its result gives the id
  | { kind: "update"; id: string; text?: string; status?: ChecklistStatus | "deleted" }; // TaskUpdate

interface ChecklistItem { id: string | null; text: string; status: "pending" | "in_progress" | "completed" }
```

- **`TaskCreate`'s id is only in its result.** The runner keeps the call's subject by `tool_use_id`. When the tool
  result arrives on the next user message, it reads the id and the saved subject from `tool_use_result.task`, and
  reports `add`. When one message carries several results, the structured result can't be told apart, so the id is
  read from the result's text ("Task #3 created successfully: …"). A result without an id is dropped.
- **`TaskUpdate` is held until its result too,** so an update Claude Code refused never reaches the list. A numeric
  task id is read as well as a string.
- **The hive applies a change only for the developer's session,** to the card's stored list, and emits
  `checklist.updated`. `add` puts the item at the end as waiting. `update` with an id it doesn't know does nothing, and
  `deleted` removes the item. A `replace` replaces everything, so a session that switches tools mid-build starts over.
- **The activity line** for these three tools reads "updating its checklist…" instead of "using TaskCreate…".

### Switching the tools on

`RoleTurn` in `ROLE_TURNS` gains `taskTools`, set for the developer only. `turnOptions()` passes it on as
`TurnRequest.taskTools`, and the SDK runner then starts the session with
`env: { ...process.env, CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" }`. The SDK's `env` replaces the whole environment, so
the hive's own is passed on with it. The Role prompts page reads the same table, so `RoleInfo` gains `taskTools`
and the developer's entry says the task-list tools are switched on, as `ARCHITECTURE.md` promises the page shows
what sessions really get.

### When the list is emptied

Only when `startDeveloper` creates a new developer session, which is a card's first build or a card whose session
was lost. A card coming back to Build resumes the same developer, which still holds its list, so the column carries
on from where it was: earlier visits' done items stay, and the developer adds the new work, or writes a new list with
`TodoWrite`, which replaces the old one. Retry, a resumed turn and a restart keep it too. After the card leaves Build
the list stays in the column, but nothing shows it until the card is back in Build.

**Known gap:** a restart that cuts a turn between a `TaskCreate` or `TaskUpdate` call and its result loses that
change. A lost item's later updates do nothing.

### The developer's instructions

`roles/developer.md` gains one bullet: keep a task list as you work, one item per piece of the plan, and keep its
statuses current, because the person follows the build from it. The Role prompts page shows the file as it is, so it
shows this line too. A session keeps the instructions of its first turn, so a developer that already exists would
never see the new line. The messages `startDeveloper` sends on each entry to Build say it too, the way they already
repeat the whole-build instructions.

### Docs and changelog

- `CONCEPT.md`, The Page, Card: the chat sits next to what the lane is producing (the brief, the mockup, the spec, or
  the developer's checklist), and the lane strip leads back to what earlier lanes produced.
- `CONCEPT.md`, Feasibility Notes: what was tested about the task-list tools in an SDK session.
- `ARCHITECTURE.md`: the Card row gains `checklist` (the developer session's task list, as the page shows it in
  Build), and the `ROLE_TURNS` bullet says whether a role's task-list tools are switched on.
- `docs/changelog/2026-11-28-build-lane-checklist.md`, citing `2026-11-26-build-lane-developer` for the Plan panel it
  removes.

## Alternatives considered

- **Files changed so far.** The worktree's diff against main, refreshed as the developer works. It's concrete, but
  it's only a growing list of files, with no sense of how far along the build is.
- **The checklist plus a line per subagent.** Useful on multi-agent builds only. Left for later, on top of this.
- **Only a muted line, with Check's bugs or your feedback when the card was sent back.** A first build, the common
  case, would then show nothing at all.
- **Keep the plan.** It repeats the Plan lane's work, which the lane strip already reaches.
- **A fresh list on each entry to Build,** with the developer told to start a new one. Rejected: the same session
  carries on its own list, and with the per-item tools every update to an earlier item would be lost, leaving the
  column empty while the developer works.
- **Find out which tool the developer uses before building.** Not needed: mirroring the session's list works with
  either.
- **Naming the task tools in the SDK's `tools` option.** It gives the session the tools, but it replaces Claude
  Code's default tool set instead of adding to it.
- **A hive tool for the checklist,** like `write_brief`. It wouldn't depend on an undocumented variable, but it
  would be a second task list beside Claude Code's own. It's the fallback if the variable goes away.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: the lead plus 1 chunk.** The lead settles `ChecklistItem`, `ChecklistChange` and the
  `checklist.updated` event in `packages/shared`. It then builds the runner's reading of both tools in
  `sessions/sdkRunner.ts`, the column and its lifecycle in `db/` and `hive.ts`, the role line and the docs, with
  their tests.
- **Meanwhile a subagent builds the page** against those types: Build's right column in `pages/Card.tsx`, a checklist
  view in `components/`, the `checklist.updated` case in `components/cardState.ts`, and the tests.
- **Opus 5.5 lead, Sonnet 5.5 for the page.** Pairing `TaskCreate` with its result, and keeping the list in step with the developer's session, need care.
  The page transcribes a settled type.
