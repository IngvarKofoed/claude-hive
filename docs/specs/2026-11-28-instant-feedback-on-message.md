# Instant feedback on message: a working line while a turn runs

After you press Send, your message appears but the log stays quiet until the session writes its first text or calls
its first tool, which can take several seconds. Now the log's activity line, the muted italic line where "reading
src/app.ts…" shows a tool call, reads "thinking…" whenever a turn runs and nothing else is showing. The page works
it out from what the card already knows (a turn is running, no text is streaming, no question waits), so it shows the
moment your message lands, survives a reload, and needs no new event. Small backend changes fill the gaps: a tool's
line now ends when its result comes back, so the gap until the next tool shows "thinking…" instead of the last tool's
line lingering, and Build's start announces its turn before it merges main.

## Outcome

**What you get:**

- The moment your message shows in the log, a "thinking…" line shows under it, in the same spot and style as a tool's
  line, before any reply text or tool call arrives.
- Throughout a turn, in every lane's log (Refine, Mockup, Spec, Plan, Build, Check), there is always something
  moving: streaming text, a tool's line, or "thinking…".
- It goes when the turn ends or is stopped, and while the session asks you a question.

**How to verify:**

- In Refine, send a message: "thinking…" shows under it at once. When the session reads a file, "reading …" takes its
  place; when the read finishes and the session thinks, "thinking…" is back. While the reply streams in, neither
  shows. When the turn ends, nothing shows under the reply.
- Reload the page mid-turn: "thinking…" (or the next tool's line) is there. Press Stop: it goes when the turn ends.
- When the session asks a question, the line is gone while the question shows. Answer it: "thinking…" is back.
- Watch a card in Build, including after Retry: from the developer's start to its report, the log never sits still
  without a line.
- Stop the hive's backend and press Send: the error shows as today, and no "thinking…" appears.

## Key decisions

- **Worked out on the page from the card's turn state** (extends). `Chat.tsx` shows
  `activity ?? (turnRunning && !streaming && !pending ? "thinking…" : null)` in the existing `.activity` line. No new
  event and no new field: `CardDetail.turnRunning`, `turn.started` and `turn.ended` already exist, so a reload shows it
  for free.
- **No optimistic state on Send** (reuses). The line arrives with your own message, from the same request:
  `Hive.sendMessage` emits `chat.message` and `turn.started` before it responds. A send that fails never started a
  turn, so there is nothing to take back, and the error shows as now.
- **A tool's line ends with its result** (extends). `SdkRunner` clears the activity once no tool call of the
  session's own is still waiting for its result, counted across messages. Today the line lingers until the next tool
  call or the turn's end, so the gap between tools would never show "thinking…".
- **A turn that can't start takes its mark back** (extends). `Hive.startTurn` resolves the role and the hive tools
  before it marks the session running and emits `turn.started`. Today a broken role file throws after that, leaving
  the card "working" with no turn and no `turn.ended`; with this feature it would also leave "thinking…" on screen.
- **Any turn on the card counts, whoever runs it** (reuses). The line follows `anyTurnRunning`, as the Stop button
  does. That includes the spec reviewer during a review (whose tool lines already show in the Spec chat), Build's
  merge before the developer starts, and Build waiting for the worktree's setup. For the merge, `startDeveloper` now
  emits `turn.started` when it marks the card as starting, so a start without a lane change (Retry in Build, a block
  the keeper settled) shows the line too.
- **Fixed label "thinking…"** (new). A constant in `Chat.tsx`, lowercase with an ellipsis like the tool lines.

## Goals

- No silent gap between pressing Send and the first sign of the session working.
- The same in the hands-off lanes' logs, while a session thinks between tools.

## Non-goals

- Making sessions start or reply faster.
- Showing the model's thinking text.
- Typing dots, or a busy Send button.
- A sign that a message sent into a running turn was received.
- The board's ▶ working badge, which already exists.
- Remembering the current tool's line across a reload. A reload mid-tool shows "thinking…" until the next tool call or
  text.
- Lanes without a log. Try it and Done have none, so a spec keeper's `answers` turn in Try it shows nothing there; the
  committer's turn at Ship doesn't go through `startTurn` and so never marks a turn running.

## Design

### What the line shows

`Chat` already gets `activity` (the tool line from `chat.activity`) and `streaming` (text being written) from
`useCardLive`, and `detail.turnRunning` and `detail.pending` from the card. It renders one line:

```ts
const WORKING = "thinking…";
const line = activity ?? (detail.turnRunning && !streaming && !detail.pending ? WORKING : null);
```

in place of today's `{activity ? <p className={styles.activity}>…`, with the same class and position: under the
streaming bubble, above a pending question. So:

- **Before the first text or tool:** the turn runs and nothing else shows, so "thinking…".
- **A tool call:** `chat.activity` brings "reading …", which wins.
- **The tool's result:** the runner clears the activity (below), so "thinking…" again.
- **Text streaming:** the streaming bubble is showing, so no working line. When its message lands, `streaming`
  clears, and "thinking…" shows until the next text, tool or the turn's end.
- **A question, or any other pending item:** hidden while it waits. When you answer, the pending item clears; the turn
  carries on (or a new one starts, if the asking turn is gone), and "thinking…" is back.
- **Stop:** the turn is still running until the interrupt lands, so the line stays until `turn.ended`. That is
  accurate: the session hasn't stopped yet.
- **The turn ends:** `turn.ended` clears `turnRunning`, `activity` and `streaming` (`cardState.ts`, unchanged).

`PastChat`, the read-only chat of a finished lane, stays without any line.

### Scrolling

The log's follow effect in `Chat` lists `activity` in its dependencies; it lists the shown `line` instead, so the log
stays at its bottom when "thinking…" appears or goes. As with the activity line today
(`docs/specs/2026-11-28-card-columns-scroll.md`), a change to the line never raises "↓ New messages" on its own.

### A tool's line ends with its result

In `SdkRunner.start` (`packages/backend/src/sessions/sdkRunner.ts`), the loop keeps the ids of the session's own
`tool_use` blocks that have no result yet (subagents' messages are skipped there already). In the `user` branch, each
`tool_result` removes its id; when none are left, it calls `handlers.onActivity(null)`. With parallel calls in one
message, the last tool's line stays until every call has its result, so "thinking…" never shows while a tool still
runs. `AskUserQuestion` already gives a null line; its result, after you answer, clears it again, which is harmless.

### A turn that can't start

`Hive.startTurn` does `updateSession(turnRunning: true)`, `setState("working")` and emits `turn.started`, and only
then builds the request, where `this.deps.role(session.role)` throws on a broken role file. The session's
`lastMessage` is still recorded first, so Retry sends the message again after a start that failed. The role (and
`hiveToolsFor`) move above the running mark, so a throw leaves no running mark, no working state and no
`turn.started` behind, and `sendMessage`'s caller gets the error as today. If `runner.start` itself throws, `startTurn` resets the session's `turnRunning` and rethrows, and on the way
it follows the same guards as a turn's normal end: nothing more for a background turn (the setup, which never set the
card working), and `needs-you` plus `turn.ended` only when `anyTurnRunning(cardId)` is false. A turn that fails to
start while another runs on the card (the developer inside `startDeveloper`'s `starting` window) leaves the line and
Stop in place. A review's findings going to the spec writer are not such a start: they are sent from the reviewer's
turn-end handler, after the reviewer's turn has left `turns`. `onReviewEnded` catches a failed start there, clears
`reviewApplying` and adds the error line "The review's findings can't be sent to the spec writer: …" with Review
again, and the handler then goes on to clear the line and emit `needs-you` and `turn.ended`.

### Build's start announces its turn

`startDeveloper` adds the card to `starting` and sets it working, but emits `turn.started` only on the
wait-for-setup path, and otherwise not until `startTurn`, after the merge of main. A fetch sees `starting` through
`anyTurnRunning`, so entering Build by a lane change shows the line, but a start with no lane change (Retry in Build,
a block the keeper settled, an answered keeper question) shows no line and no Stop during the merge. It now emits
`turn.started` right after `this.starting.add(cardId)`; its `finally` already emits `turn.ended` when nothing runs.
The wait-for-setup path's own `turn.started` then repeats it, which is harmless.

### Where it shows

Every card page lane that renders `Chat` gets it with no other change: Refine and Mockup (the default view), Spec,
Plan, Build, Check, and Ship's Landing panel. No lane-specific code.

## Open questions

- **Q:** Is "thinking…" the right word when Build waits for the worktree's setup, which can take minutes, or while
  the spec reviewer reads the spec? **Default:** yes, keep one label. The chat already carries a note that Build waits
  for setup, and the reviewer's tool lines already show in the Spec chat. "working…" is the fallback if it reads
  wrong when you try the feature.
- **Q:** Should the spec reviewer's turn show the working line in the spec writer's chat at all? **Default:** yes. Its
  tool lines show there today, and the reply box already says "Wait for the review", so the line only confirms
  something is running.

## Alternatives considered

- **An optimistic "sending" flag on Send.** Rejected: your message isn't optimistic either, and both land together
  from the same request on localhost. A local flag would need its own rules for when to clear.
- **The backend emits "thinking…" as a `chat.activity` at turn start and after each tool result.** Rejected: activity
  isn't stored, so a reload would lose it, while `turnRunning` is already on the card.
- **Leave a tool's line until the next tool call** (today's behaviour). Rejected: the brief asks for the working line
  between tools, and a lingering "running npm test…" claims a tool still runs while the model thinks.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Sonnet 5.5.** Four small edits on one thread (`Chat.tsx`, `sdkRunner.ts`, `Hive.startTurn`,
  `Hive.startDeveloper`), each a few lines and checked together in one Refine chat and one Build start. Nothing to hand off, and no `(new)` or `(diverges)` decision
  needing Opus to interpret.

## Amendments

- 2026-11-28: "A turn that can't start" now says `lastMessage` is recorded before the role is resolved, and only the running mark, the working state and `turn.started` are left out. Retry sends `lastMessage` again, so it has to be there after a start that failed.
- 2026-11-28: "A turn that can't start" no longer lists a review's findings as a start made while another turn runs, and says `onReviewEnded` catches a failed findings start with an error line and Review again. Nothing else runs at that point, and the code fix for the earlier issue made this path end like any failed start.
