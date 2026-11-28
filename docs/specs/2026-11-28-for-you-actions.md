# For you actions: one definition of what you can do to a card in a lane

**Lane actions** become a named concept: what you can do to a card in a lane, from Good and Sign off to Retry, Stop
and Land on main. One pure function in `packages/shared` defines them: each lane's actions, their labels, when each
is offered, when it's enabled and why not. The card page reads it in place of the enable rules now spread over
`GoodBar`, `ReviewBar`, the chat's error lines, `TryItPanel` and `ShipPanel`. The backend reads it to give every For
you entry its buttons. So the two can't disagree, and you can unblock a card from For you without opening it. Land
on main asks you to confirm first and shows what landing will do. The server's own guards stay as they are and
still have the last word.

## Outcome

**What you get:**

- **Buttons on For you:** a Refine entry offers Good, a Spec entry Review and Sign off, a stuck card the buttons on
  its error line (Retry, Back to Spec, Back to Build, Move on), and a Ship entry Land on main and Back to Try it.
  Discard them and land is offered in Land on main's confirmation. A card in Try it, whatever it waits for, and a
  question entry look as they do today.
- **A greyed button says why,** in the same words the card page uses.
- **Land on main from For you asks first.** The confirmation shows the landing's steps and warnings, and the files a
  discard throws away.
- **"Lane actions" in CONCEPT.md**, with each lane's list, and one definition in the code that both pages read.

**How to verify:**

- With a Refine card waiting for your reply, press **Good** on For you. The card moves to Spec without you opening it,
  the entry leaves the list and the count drops.
- With a Spec card that has no review yet, For you shows **Review** enabled and **Sign off** greyed, with "Run the
  review first". That's the line next to Sign off on the card page. Press Review: the entry leaves while the
  review runs.
- On a Build card stopped by a blocked build, For you shows **Retry** and **Back to Spec**. Press Back to Spec, and
  the card is in Spec with the spec writer working: the developer's reason goes to it as its turn's message, and
  its reply says what it changed in the spec.
- On a Ship card, **Land on main** opens a confirmation that lists the steps (squash, tests, push) and any warnings.
  Cancel changes nothing. Confirm starts the landing, and the entry leaves. With uncommitted files in the worktree,
  the confirmation lists them, greys its Land on main with the reason and offers **Discard them and land**.
- An action the server refuses shows the server's message in its entry. The card page shows the same buttons in the
  same places as before.

## Key decisions

- **One definition, in `packages/shared`** (new). `packages/shared/src/laneActions.ts` exports `LANE_ACTIONS`, each
  lane's actions in display order, and a pure `laneActions(input)` that returns the actions on offer, each with its
  label, `enabled` and `reason`. It's shared because both sides run it. The frontend runs it on the card page,
  from the live `CardDetail`. The backend runs it for For you, because only the server knows a listed card's running
  turn, open question and last chat line.
- **The server's guards stay authoritative and unchanged** (reuses). `Hive.good`, `signoff`, `retry` and the rest
  keep every check they have, including the state the page never sees (`moving`, a landing in flight, git status at
  the moment of landing). The definition decides only what the page offers. Its reasons reuse the card page's
  words.
- **`ForYouItem` gains `actions`** (extends, shared type). `Hive.forYou()` evaluates `laneActions` for each listed
  card and keeps For you's subset (Design: What For you offers). It stays sync. The list never reads a Ship card's
  plan, because that needs git on every reload of the header count, and git changes send no event. The confirm row
  reads the plan instead.
- **For you calls the existing card endpoints** (reuses). Each button posts to the same route as its card page
  twin (`/good`, `/review`, `/signoff`, `/retry`, `/back-to-spec`, `/back-to-build`, `/move-on`, `/land`,
  `/back-to-tryit`). No new route or event. The list refreshes through the events it already listens to, and
  after a successful press.
- **`ErrorAction` becomes a subset of `LaneActionId`** (extends). It keeps the same strings, so error lines already
  stored stay valid. An error line's `actions` still say which lane actions it offers, but only while it's the
  lane's last chat line, which is the rule the server already applies. So on the card page an older error line
  higher up in the chat loses its buttons, which the server refused anyway. Its "Review again" button reads
  "Review", the action's one label.
- **Only landing confirms, and only on For you** (new). On the list, Land on main is always enabled and opens a
  confirm row in the entry, the pattern `DeleteCard` uses. The row reads the plan, then shows its reasons and files,
  and Discard them and land when there's uncommitted work. The card page doesn't confirm: it shows the plan right
  beside the button. The plan's steps and warnings move out of `ShipPanel` into a `ShipPlanView`
  that both render.
- **Question and permission entries show no lane actions** (new). Every action on such a card waits on the answer.
  Good, for example, is refused while a question is open. So the entry keeps its form and Open the card.

## Goals

- One place in the code that says what you can do to a card in each lane, under a name later work can refer to.
- Unblocking a card from For you, without opening it, for everything but testing.
- The card page and For you agree on what's enabled and why.

## Non-goals

- **Delete.** It's a card control, not a lane action, and stays on the card page only.
- **Try it's Accept and Send to Build on For you:** you test on the card page anyway.
- **Building park or drop.** CONCEPT.md lists park as a lane action. The code adds it when it's built.
- **Actions for parts that aren't built:** ■ stopped, severe-issue options beyond today's buttons, the manager,
  Ship's Approve item, Mockup versions.
- **New actions, or changes to what an action does or when the server allows it.**
- **One action bar on the card page.** Each button stays in the component it's in now.
- **Chat replies from For you.**

## Design

### The definition

```ts
type LaneActionId =
  | "start" | "good" | "review" | "signoff" | "retry" | "back-to-spec" | "back-to-build" | "move-on"
  | "send-to-build" | "accept" | "land" | "discard-and-land" | "back-to-tryit" | "stop";

const LANE_ACTIONS: Record<Lane, readonly LaneActionId[]> = {
  ideas: ["start"],
  refine: ["good", "retry", "stop"],
  mockup: [],                                  // comes with Mockup's slice
  spec: ["review", "signoff", "retry", "stop"],
  plan: ["retry", "back-to-spec", "stop"],
  build: ["retry", "back-to-spec", "stop"],
  check: ["retry", "back-to-build", "move-on", "back-to-spec", "stop"],
  tryit: ["send-to-build", "accept", "retry"],
  ship: ["land", "discard-and-land", "back-to-tryit", "retry", "back-to-build", "stop"],
  done: [],
};

interface LaneActionState { id: LaneActionId; label: string; primary: boolean; enabled: boolean; reason: string | null }

function laneActions(input: LaneActionInput): LaneActionState[];   // offered ones only, in LANE_ACTIONS order
```

`LaneActionInput` is what the rules read, all of it on `CardDetail` or `ShipPlan` today. It holds the lane,
`turnRunning`, `pending`, the lane's last chat line, the spec's review state and whether the spec has text, the
issues' statuses, `landing`, the Ship plan (null until read), and whether Try it's feedback box has text.

The rules, first matching reason winning:

| Action | Label | Offered when | Disabled → reason |
| --- | --- | --- | --- |
| start | Start | in Ideas | never; the idea form checks its own fields |
| good | Good | in Refine | a turn runs or a question is open → "Wait for the product owner to finish" |
| review | Review | in Spec | a turn runs → "Wait for the spec writer to finish"; no spec text → "Wait for the spec writer to write the spec"; running or applying → "Wait for the review"; unfinished → "Finish the review first"; fresh → "Already reviewed" |
| signoff | Sign off | in Spec | today's `signOffReason`, moved here |
| retry, back-to-spec, back-to-build, move-on | Retry, Back to Spec, Back to Build, Move on | the lane's last chat line is an error that lists it | a turn runs → "Wait for the running turn to finish" |
| send-to-build | Send to Build | in Try it | a question is open or an issue waits → "Answer the spec keeper's question first."; a turn runs → "The spec keeper is working. Wait for it to finish."; an empty box with no held answer → disabled, no reason, like any empty form |
| accept | Accept | in Try it | the first two reasons above; an answer is held → "Changes you asked for go to Build with Send to Build." |
| land | Land on main | in Ship | landing → "Landing…"; no plan yet → "Reading what landing will do…"; busy → "Another card of this project is landing."; unpushed → "Your local main has N commits that aren't on origin. Push them first."; checkout blocks → "Your checkout has main checked out with uncommitted changes. Commit or stash them first."; uncommitted work → "Uncommitted work in the card's worktree won't land." |
| discard-and-land | Discard them and land | the plan lists uncommitted work | Land on main's reasons, except the last |
| back-to-tryit | Back to Try it | in Ship | landing → "The card is landing." |
| stop | Stop | a turn runs | never |

Good, Sign off, Send to Build and Land on main are `primary`, as on the card page now. Every reason is a sentence the
card page already shows, apart from Review's, which it now shows too (below). Each action's line in the table
matches what its component computes today, so the card page's behaviour doesn't change. Stopped Build and Check
cards keep working as now, because their buttons come from the error line's own `actions`.

**Every action an error line can carry is in its lane's list.** `laneActions` offers only what the lane lists, so
an action left out would drop off the error line. One example is Refine's Retry after the product owner's turn
fails (`addError(cardId, session.lane, …, ["retry"])`). A test checks the actions of each `addError` call against
the list of the lane it writes to.

### The card page reads it

A helper in the frontend, `laneActionsFor(detail, extras)`, builds the input from the live `CardDetail`. `extras`
holds the Ship plan from `ShipPanel` and the feedback box from `TryItPanel`. Each component takes its actions from
the result by id and stops computing `enabled` itself:

- `GoodBar`: Good's `enabled` and reason. Its hint, "Happy with the brief? Move on to the spec.", stays its own.
- `ReviewBar`: Review and Sign off. `signOffReason` goes.
- `Chat`: the error-line buttons, only on the lane's last line when it's an error. `ERROR_ACTION_LABEL` goes. The
  footer's Stop uses the definition's Stop.
- `TryItPanel`: Send to Build, Accept and Retry. `whyDisabled` becomes the first reason of Send to Build or Accept.
- `ShipPanel`: Land on main, Discard them and land and Back to Try it. Its `blocked` logic goes, and the plan is
  rendered by `ShipPlanView`.
- `IdeaPanel`: Start's label only.

Every disabled lane-action button gets its reason as its `title` too, so Review's reason shows on the card page
without a new line in the layout. One frontend map, `LANE_ACTION_CALLS`, maps each id that takes no body to its
`api` call. Chat's error lines and For you use it; Send to Build and Start keep their forms.

### What For you offers

`Hive.forYou()` builds each listed card's input from the database and session runner: `anyTurnRunning`,
`openPendingFor`, `lastChatItem` for the card's lane, `refreshSpec` and `issuesFor`. It never reads the Ship
plan. It sets `ForYouItem.actions` to `forYouActions(item)` in `board/forYou.ts`:

- **A card in the Try it lane, whatever its kind, and question and permission entries:** none. That includes a Try
  it card stuck on a failed spec keeper turn, whose Retry stays on the card page.
- **A Ship entry:** Land on main, always enabled, since it only opens the confirm row, and Back to Try it, as the
  definition says. Back to Build shows too when the error line offers it. Discard them and land isn't on the list:
  the confirm row offers it. Ship's Retry is left out (Open questions).
- **Any other entry:** the offered actions among Good, Review, Sign off, Retry, Back to Spec, Back to Build and Move
  on. Stop never shows: a listed card isn't working, apart from a question asked mid-turn.

What each entry says (`whatItWants`) is unchanged.

### The entry

`ForYouEntry` renders the item's `actions` as compact buttons before its link, and the link becomes secondary when
there are any. A disabled button is greyed, and under the row a muted line names each disabled action's reason
("Sign off: Run the review first"). While a press runs, every button in the entry is disabled. A failure shows in
the entry's error line, the one a failed answer uses today. A success calls a new `reload()` on `ForYouProvider`,
so the entry never shows a stale button while it waits for an event.

### Confirming a landing

Pressing Land on main on an entry swaps its button row for a confirm row inside the entry, the way `DeleteCard`
does:

- **The heading:** "Land *title* on main?"
- **The plan,** read from `GET /api/cards/:id/ship` when the row opens and rendered by `ShipPlanView`: the steps,
  the warnings, and the uncommitted files that a discard throws away. It's read only here, so the files listed are
  the ones in the worktree at the moment you confirm. A plan that can't be read shows its error in the row, with
  Cancel.
- **The buttons:** `laneActions` against that plan decides Land on main, and Discard them and land when the plan
  lists uncommitted work, each greyed with its reason when it's blocked. Cancel and Escape close the row.

No other action confirms.

### Docs this changes

- **`CONCEPT.md`:** a short **Lane Actions** section after Where You Come In. It defines the term, lists each
  lane's actions (the table above, plus Park in Refine through Try it, Good and Pick a version in Mockup), and says
  that Delete is a card control and that chat, answers and the app's controls aren't lane actions. The Page's For
  you bullet adds that entries offer their lane's actions, except Try it's.
- **`ARCHITECTURE.md`:** a **Lane Actions** paragraph after Card Moves, naming `laneActions` in `packages/shared`, its
  two readers, and that the server's guards still decide. The API line for `GET /api/for-you` adds "each with its
  lane actions".
- **A changelog entry,** `docs/changelog/2026-11-28-lane-actions.md`, that revisits `2026-11-27-for-you`. That entry
  says that answering stays with the card page for everything but questions; that's no longer true.

## Open questions

- **Q:** Should Land on main confirm on the card page too? **Default:** no. The plan sits right beside the button
  there, and a confirmation would only repeat it.
- **Q:** Ship's Retry starts the landing over, the same as Land on main. Should For you offer it? **Default:** no.
  Land on main is in the same entry, and it confirms first; a Retry would land without asking.
- **Q:** Should park go in `LANE_ACTIONS` before it's built? **Default:** no. CONCEPT.md lists it, and the code adds it
  together with the move it makes, so the table never lists something that can't be pressed.
- **Q:** Is Drop a lane action or a card control? **Default:** a card control, like Delete: it ends the card from any
  lane. CONCEPT.md says so in the Lane Actions section.

## Alternatives considered

- **The server computes the actions for the card page too** (`CardDetail.actions`). Rejected: the card page patches
  its state live from events (`turn.started`, `pending.updated`, `chat.message`), so server-computed actions would go
  stale between full loads, or need a new event.
- **The definition only in the frontend,** with `ForYouItem` carrying what the rules read (running turn, last chat
  line, review, Ship plan, issues). Rejected: the item would carry the card's internals, and every new rule would
  widen the API.
- **The server's guards call `laneActions`.** Rejected: the guards need state the page never sees, and rebuilding
  them risks changing when an action is allowed, which this card leaves alone.
- **Hiding disabled actions on For you.** Rejected in Refine: a greyed button with its reason tells you what the card
  is waiting for.
- **Confirming Good and Sign off on For you, or making them secondary buttons** (from the review, since neither can
  be undone). Rejected: one click, as on the card page.
- **Reading each Ship card's plan in the list,** to grey Land on main there. Rejected: git on every reload of the
  header count, a stale greyed button with no event to refresh it, and a second read of the plan the confirm row
  makes anyway.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: the lead plus 2 chunks.** The lead builds `packages/shared/src/laneActions.ts` and its tests,
  `ForYouItem.actions`, the backend (`Hive.forYou()`, `forYouActions` in `board/forYou.ts`), and extracts
  `ShipPlanView` from `ShipPanel`. Then, in parallel: one subagent moves the card page's components (`GoodBar`,
  `ReviewBar`, `Chat`, `TryItPanel`, `ShipPanel`, `IdeaPanel`) onto `laneActionsFor`. The other builds the For you
  side (`ForYouEntry`, the confirm row, `reload()` in `forYou.tsx`, `LANE_ACTION_CALLS`). The lead writes the docs
  and changelog and makes the integration pass.
- **Opus 5.5 lead, Sonnet 5.5 for both chunks.** The rule table is where the design is interpreted. Both chunks
  wire settled components to a settled function.

## Amendments

- 2026-11-28: The third How-to-verify bullet now says the developer's reason goes to the spec writer as its turn's message, not that it shows in the spec writer's chat. Back to Spec, which this card leaves alone, never writes the reason as a chat line.
