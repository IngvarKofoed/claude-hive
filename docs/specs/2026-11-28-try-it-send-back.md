# Send back from Try it, and amendments

Today Try it has one way back, **Send to Build**. Feedback that is really a spec change goes to the developer, who
builds it. Then Check's reviewer compares the code with the unchanged spec and reports your change as a mismatch. The
spec keeper, which never saw your words either, can judge it `code-wrong` and send the card back to have it undone.

This slice replaces Send to Build with **Send back**. The spec keeper reads your feedback, and code sends the card to
**Build** for a bug, or to **Spec** for anything that changes the spec. Either way it goes without asking you, and
feedback never goes to Refine or Mockup. A spec change becomes an **amendment**: a numbered round that the card
carries through Spec, Plan, Build, Check and Try it, where each role handles just that change. The spec writer makes it
and decides whether it needs the blind review. The card then signs off on its own, unless you took over in the chat.
The planner plans only what's left to build. Check's reviewer and the keeper are told what you asked for, so it's never
undone.

## Outcome

**What you get:**

- **One Send back button in Try it.** The spec keeper reads your feedback, and the card goes to Build or Spec by itself.
  The chat says where it went and why, and how the keeper read each point.
- **A spec change is an amendment:**
  - The card goes to Spec as "Amendment 1", then 2, 3 and so on.
  - The spec writer changes only what the amendment needs, and adds an `## Amendments` line.
  - It runs the blind review only when it thinks the change needs one, and can ask you questions on the way.
  - The card then signs off and goes on to Plan by itself, unless you wrote in the chat.
- **A small plan for a small change.** The planner plans only what the amendment leaves to build. The same developer
  builds it, together with any bugs from the same feedback.
- **What you asked for is never undone.** Check's reviewer and the spec keeper see all your Try it feedback. A
  difference you asked for is written into the spec, not sent back to Build.
- **Try it's history lists each amendment as a round:** your words, what changed in the spec, whether it was reviewed,
  and whether it signed off by itself or with you.

**How to verify:**

- **A spec change:** in Try it, write *"the limit should be 32, not 24"* and press **Send back**. After the keeper reads
  it, the card goes to Spec by itself:
  - the Spec chat shows Amendment 1, with the keeper's reading;
  - the spec has the change and an `## Amendments` line;
  - when the spec writer skips review, the card moves on to Plan without you;
  - the new plan covers only the limit.
- **A review:** with the fake runner's amendment report set to `review: true`, the blind review starts by itself. Once
  it's fresh, the card moves on to Plan.
- **Questions and the chat:** when the spec writer asks you a question during the amendment, the card still moves on by
  itself once you've answered and the turn ends. When you write in the Spec chat yourself, it waits for your Sign off.
- **A bug:** write *"it crashes when there are no printers"* and press Send back. After the keeper reads it, the card
  goes to Build by itself, with your words in the developer's message.
- **Both at once:** write both points in one message. The card goes to Spec, and after the new plan, the developer's
  message also holds the crash.
- **A failed pick:** make the pick turn end with no report. The card stays in Try it with an error line offering
  Retry, Back to Build and Back to Spec.

## Key decisions

- **Feedback goes to Build or Spec, and a spec change is an amendment** (diverges). CONCEPT.md sends a wrong *what* to
  Refine and a wrong *look* to Mockup. Those routes are dropped for good: every spec change goes to Spec, where the spec
  writer already holds your Refine chat and the mockup comments.
  - An amendment is a row on the card: its number, your words, the keeper's reading, and what came of it. It's open
    from Send back until the card is next in Try it, even while the card is stuck partway.
  - Only Try it's Send back makes one. Back to Spec from Plan, Build or Check while an amendment is open stays part of
    it. Outside one, Back to Spec works as today.
  - What only needs code, meaning your bug points and any held Change the code answers, stays on the card. It reaches
    the developer when the card gets to Build at the end of the same trip.
- **The keeper reads, code picks, nobody asks** (extends). Send back starts a turn in the spec writer's session, as the
  keeper. It edits nothing and reports each point of your feedback as `bug` or `spec`.
  - `laneAfterSendBack()` in `board/moves.ts` picks Spec if any point is `spec`, otherwise Build. That follows the rule
    that card moves come from report fields.
  - The card moves as soon as the turn ends. A wrong pick costs a round, not your attention: you catch it at the next
    Try it, and send back again. An amendment whose review is skipped signs off as soon as its turn ends, so stepping
    into the Spec chat is no safety valve, and isn't meant to be one.
  - Only a pick turn that fails waits for you, with both lanes offered.
- **The spec writer decides on review** (new). The amendment's first turn ends with a fixed-format report:
  `review: true | false` and why. With `true`, the hive starts the blind review at once. Its brief adds what the
  amendment changed, and it reports only on that and on anything it breaks. Its findings go to the spec writer as today.
- **Signed off on its own unless you took over** (diverges). Today only you sign off, after a fresh review. An amendment
  signs off by itself once its turns end. Answering the spec writer's questions doesn't change that. Writing in the Spec
  chat yourself does: from then on it's an ordinary Spec visit, where you sign off, and a review the spec writer skipped
  counts as done for the text it vouched for.
- **The planner plans what's left** (extends). Its message names the amendment and gives the spec's diff since the
  amendment started, and it plans only the steps that bring the branch in line. `Hive.backToSpec`'s re-plan stays a
  full plan.
- **Instructions ride in the spec writer's session** (reuses). `roles/feedback-reader.md` (the pick) and
  `roles/spec-amender.md` (the amendment's turn) are sent at the top of their messages, as `roles/spec-keeper.md` is.
  `ROLE_TURNS` gets an entry for each with its report, so the Role prompts page shows them.
- **Send to Build becomes Send back** (breaking). The lane action id `send-to-build` becomes `send-back` in
  `packages/shared/src/laneActions.ts`. Everything that uses it is in this repo. A failed pick's error line reuses
  the existing error actions `back-to-build` and `back-to-spec`, added to Try it's `LANE_ACTIONS`. In Try it they post
  `/feedback` with a `lane`.

## Goals

- A spec change from Try it lands in the spec and is never reverted by Check or the keeper.
- A small spec change costs a small round, and doesn't need you unless you want in.
- You don't sort your own feedback or confirm where it goes: you write it, and the hive takes it from there.

## Non-goals

- **Back to Spec outside an amendment.** It keeps its full revision, review by you and re-plan.
- **Answers to the keeper's questions.** Keep it as built, and answers in your own words, still change the spec in place,
  as `2026-11-28-spec-keeper` built them. They add `## Amendments` lines but aren't rounds.
- **Grouping every lane's history by amendment.** Try it's history lists the rounds. The other lanes' histories stay
  as they are.

## Design

### Send back and the pick

`POST /api/cards/:id/feedback { text, lane? }` keeps its route and body:

- **Without `lane`,** it starts the pick: a keeper turn of a new kind, `send-back`, in `Card.judging`, so a restart, a
  Retry and the end of the turn know which turn ran.
  - The card stays in Try it with its badge on working, and your words are stored in `Card.sendBack = { text }`.
  - The route is refused while a keeper question waits or a turn runs, as Send to Build is today.
- **With `lane`** (`build` or `spec`), it moves the card at once, with `text` as your feedback. The page uses it after a
  failed pick. Empty text with held Change the code answers needs nothing read, so the page sends `lane: "build"` at
  once, as today.

The pick's report, `SEND_BACK_SCHEMA`:

```ts
{ status: "done" | "blocked", reason: string,
  points: { what: string; kind: "bug" | "spec"; why: string }[] }
```

`roles/feedback-reader.md` defines the two kinds:

- `bug`: the code should change and the spec stays, because the spec covers the point, or because the obvious fix
  changes nothing you signed off;
- `spec`: the point changes what the spec says, such as its Outcome, a Key decision, or behavior or a look it describes.

The turn edits no file, and its questions are refused, as the keeper's are.

When the turn ends:

- **A `done` report:** the card moves to `laneAfterSendBack(points)`, as below. A note in the chat of the lane it
  enters gives the keeper's reason and each point with its kind.
- **A `blocked` or missing report, a Stop, or a cut-off turn that fails again:** the card stays in Try it with an error
  line offering Retry, **Back to Build** and **Back to Spec**.
  - The two backs post `lane` with the stored text.
  - Retry runs the pick again with `SEND_BACK_SCHEMA`. `keeperOptions` picks the report by turn kind, so `send-back` gets
    its own schema, not the keeper's.
  - The Send back form also shows **Edit** (a form control, not a lane action). It puts your words back in the box and
    clears `Card.sendBack` and `judging`. From there you can change the words and press Send back for a new pick, or
    empty the box and Accept.
  - Accept is greyed ("Send your feedback, or edit it away first") while `Card.sendBack` is set.

Both moves, into Build and into Spec, clear `Card.sendBack` and `judging`.

### Into Build

Into Build works as Send to Build does today (`Hive.feedback`):

- the app stops;
- `Card.feedback` holds your words, and a `feedback` event records them;
- held answers go along as `keeperFixes`;
- the same developer is resumed, and Check starts again at round 1.

### Into Spec: the amendment

The move reuses `backToSpec`'s body:

- the app stops;
- `open`, `judged`, `severe` and `waiting` issues become `settled`, as today;
- `reviewedSpecHash`, `reviewApplying` and `judging` are cleared.

The one difference from `backToSpec`: held Change the code answers are not settled. They go to `keeperFixes` and become `sent`, as `Hive.feedback` does
today, and wait there for the developer.

Then:

- **A new `Amendment` row:**
  - card, number (the card's next), your words, the keeper's points;
  - `base`, the commit at the branch's head when the amendment starts. Diffs of the spec "since the amendment started"
    are taken from it, so the keeper's earlier spec commits aren't mistaken for the amendment;
  - `takenOver: false`.

  `Card.amendment` points at the row while the amendment is open, until the card next enters Try it.
- **`Card.feedback` is set to your words and kept,** and a `feedback` event records them. The developer gets the bug
  points along with the new plan. This differs from `backToSpec`, which clears `Card.feedback`.
- **The amendment turn:** the spec writer is resumed with `roles/spec-amender.md`, your words, the keeper's points and
  the settled issues.
  - It changes only what the amendment needs, and adds an `## Amendments` line.
  - It may ask you with `AskUserQuestion`. The card is in Spec, so the question reaches the page as Spec chat.
  - It ends with `AMENDMENT_SCHEMA`: `{ status, summary, review: boolean, reason }`.

**After the amendment turn.** A `done` report goes on as follows:

1. **`review: false`:** record the spec's hash as `Amendment.skippedHash`, whatever else holds, so a skipped review
   counts for that text even after you took over.
2. **`takenOver`:** stop here, as an ordinary Spec visit. `takenOver` is set when you send a message in the Spec chat
   while the amendment is open. Answering the spec writer's questions doesn't set it. A typed message that answers a
   waiting question counts as an answer, as `sendMessage` already treats it.
3. **`review: false`:** sign off.
4. **`review: true`:** start the blind review, as the Review button does. Its brief adds:
   - "This is Amendment N to a signed-off spec";
   - the writer's summary;
   - the spec's diff since the amendment started.

   Once the review is fresh, sign off unless `takenOver`. A review is fresh when it had no findings, or when the turn
   that applies them has finished.

A `blocked` or missing amendment report doesn't sign off. It leaves an error line with Retry, which re-sends the
amendment turn's message, and its report starts the steps above again.

A review that fails, is stopped, or reads a spec that changed during it shows its error line and Review, as today. A
review you start by hand still ends in the automatic sign-off unless you took over.

**Signing off on its own** goes through `Hive.signoff`'s path, with a note in the chat: "Amendment N signed off on its
own" and "review skipped: <reason>" or "reviewed". A sign-off that fails leaves the card in Spec with an error line,
for you to press Sign off. It can fail when the spec commit fails, when the delete of an unkept mockup fails, or when the
spec has changed since its hash was recorded.

**The Sign off gate during an amendment.** Sign off is enabled when the review is fresh. It's also enabled when the spec
on disk matches `Amendment.skippedHash`. The automatic sign-off uses the same gate.

The sign-off records `signedOff: "auto" | "you"` and `reviewed: boolean` on the amendment. Try it's history reads them.

**Back to Spec while an amendment is open.** An amendment's small plan or build can block, or Check's keeper can stop
the card on a severe issue. Back to Spec then stays part of the same amendment:

- `backToSpec` keeps `Card.feedback` and `keeperFixes`, where today it clears them.
- Its turn is an amendment turn: `roles/spec-amender.md`, the reason the card stopped, and `AMENDMENT_SCHEMA`.
- The steps after the amendment turn apply as above: the spec writer decides on review, the card signs off on its own
  unless you took over, and the planner plans only what's left, from the same `base`.

Park isn't built yet. When it is, parking ends an open amendment.

### Plan and Build

When the card enters Plan with `Card.amendment` set, the planner's message says:

> This is Amendment N: <summary>. The spec's diff since the amendment started is below. The branch already builds the
> spec before it. Plan only what's left to bring the branch in line.

`PLAN_SCHEMA` is unchanged.

In Build, `Card.amendment` selects `startDeveloper`'s revised-spec message (today's `again` branch) ahead of the
feedback branch, so the developer gets the new plan, and no "Sent back from Try it" note is added.
- The message names the amendment.
- When `Card.feedback` is set, it adds "The person's Try it feedback, which also had these points: …".
- When `keeperFixes` is set, it adds the held code changes, as today's Try it fix message lists them.
- The developer's next `done` report clears both, as today.

### What the reviewer and the keeper are told

`reviewerMessage` and `keeperMessage` (batch and as-built turns) list every `feedback` event on the card, oldest first,
since later words win over earlier ones. They also give the amendment's number and summary when one is open.

- **Reviewer:** "The person asked for these. A difference from the spec that they asked for is still a spec issue, so
  the spec catches up. Say in it that they asked for it."
- **Keeper:** "What the person asked for in Try it stands where the spec doesn't already settle the point. An issue
  that is one of these is `spec-wrong` and `minor`. Where an amendment or a later answer settled a point differently,
  the spec wins."

### The docs

- **CONCEPT.md:**
  - **Try it:** the feedback table becomes Build (a bug) and Spec (anything that changes the spec, as an amendment).
    The hive sends it there without asking. The Refine and Mockup rows go, and so does "Feedback that changes the what
    or the look…".
  - **Key Concepts:**
    - a short "Amendment" entry;
    - Sessions: a card sent back to Spec resumes the spec writer, replacing the line about Refine.
  - **The Board, and Where You Come In:** an amendment signs off on its own unless you take over in the chat.
  - **Mockups:** where an amendment changes the look, the spec's words win over the approved mockup.
  - **Lane Actions:** Send to Build becomes Send back, and Try it gains Back to Build and Back to Spec on a failed
    pick's error line.
- **ARCHITECTURE.md:**
  - **Card Moves:** the Try it, Spec and Plan rows, and the Back to Spec rows for an open amendment.
  - **Roles:** `feedback-reader` and `spec-amender`.
  - **Data Model:** `Amendment`, `Card.amendment`, `Card.sendBack`, and `send-back` in `judging`.
  - **API:** the `/feedback` line.
  - **Spec Keeper and Review Gate:** the amendment's gate.
- **A changelog entry:** `docs/changelog/2026-11-28-try-it-send-back.md`.

## Alternatives considered

- **Amend in place:** the keeper writes a small change into the spec and the card goes straight to Build. Rejected:
  it was a third place feedback could go, next to the lanes, and it was confusing.
- **Refine and Mockup as places feedback goes,** as CONCEPT.md had it. Dropped: the spec writer already holds both
  chats, and two destinations are easier to pick between than four.
- **Confirming the pick before the card moves:** it would catch a misread, but now that an amendment signs off on its
  own, a wrong pick costs only a round. The next Try it is where you catch one.
- **Every Back to Spec as an amendment:** one concept everywhere. Not for now: those trips stay full revisions.
- **Always the full review and a full re-plan:** the safest, but a one-line change would cost a whole Spec visit, and
  points you settled before would be raised again.
- **A one-off Sonnet session picks:** cheaper, but telling a bug from a change to what you signed off needs the spec's
  reasoning, which only the spec writer's session holds.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: the lead plus 1 chunk.** The lead (Opus 5.5) builds the backend and shared types, in this order:
  - the pick turn and `laneAfterSendBack`;
  - the `Amendment` row and the move into Spec;
  - the amendment turn and its sign-off rules;
  - the planner's and developer's messages;
  - the reviewer's and keeper's messages;
  - the two role files, and a test for each new Card Moves row.

  It also writes the docs and the changelog.
- **Then a Sonnet 5.5 subagent** builds the frontend against the finished shared types:
  - the Try it panel's Send back and failed-pick lines (`TryItPanel.tsx` and its test);
  - the amendment in Try it's history and in the Spec chat;
  - the rename in `Card.test.tsx` and `laneActions.test.ts`.

  It's UI over a settled backend, with its own files.
