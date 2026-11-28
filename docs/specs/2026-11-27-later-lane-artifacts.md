# Card page: what the later lanes produced, round by round

Looking back at a finished lane from the lane strip now shows what that lane produced, every time it ran, instead of
only what the card holds now. ✓ Plan shows every plan the card had, ✓ Build each round's build report, ✓ Check each
round's findings, and ✓ Try it each round of your feedback and when you accepted. The newest round is on top and open,
and older ones fold under their heading. When a card comes back to Try it, the Try it panel also shows the feedback
you gave before. A Done card also shows the spec it landed with, read from its landed commit.
All of it comes from event rows the hive already writes and has never read, so existing cards get their history at
once. This is the second slice of `docs/specs/2026-11-27-card-lane-artifacts.md`, which left these for later.

## Outcome

**What you get:**

- Looking back at Plan, Build, Check or Try it shows every round that lane produced, newest on top and open, older
  rounds folded under their heading. Try it shows each piece of feedback you gave, and "Accepted" once you accepted.
- When a card comes back to Try it, the Try it panel shows the feedback you gave before, folded.
- A Done card shows the spec it landed with, both looking back at ✓ Spec and on its Done page.
- Cards already on the board get this history straight away, as far back as each lane has been recording.

**How to verify:**

- Take a card through Build, a Check round with bugs, Build again and a Check round with none. From Try it, open
  ✓ Build: Round 2 is on top and open, Round 1 folded below it. ✓ Check shows Round 2's "No bugs." on top and Round 1's
  bugs folded below.
- Give feedback in Try it once. When the card is back in Try it, the panel has "Your earlier feedback" folded, and
  opening it shows what you wrote. Accept this time, and land the card. On the Done card, ✓ Try it shows "Accepted" on
  top and your feedback below it.
- On the same Done card, open ✓ Spec: the spec is there, folded under its path, as it is in the landed commit. It's
  still there after the hive restarts.
- A card whose lane recorded nothing shows the same view as before this change.

## Key decisions

- **History from the event rows the hive already writes** (reuses). Every plan, build report, Check round, piece of
  feedback, acceptance and landing has been written to `events` since its lane was built (`hive.ts`: `addEvent(…,
  "plan" | "build" | "check" | "feedback" | "accept" | "landed", …)`), and nothing reads them. Reading them needs no
  new table and no migration, and existing cards get their history at once.
- **One `history` field on the card** (extends). `CardDetail` gains `history`, built from those rows by a new
  `HiveDb` read of a card's events by type, and sent with every card fetch, as `pastChats` is. The page already reloads
  the whole card when its lane changes, and every row of a lane is written before that lane becomes past, so no new
  live event is needed. (A Check round that finds bugs again writes its row while the card stays in Check. That's fine
  because Check's rounds show only once Check is past. The feedback the live Try it panel shows is written as the card
  leaves Try it.)
- **Every round, newest on top, older ones folded** (extends). The fold is the `<details>` shape `SpecView` already
  uses for the spec. The newest round is what you came for. The older ones stay a click away without making the
  panel long.
- **A landed card's spec is read from its landed commit** (new). `git show <landed.commit>:<specPath>` in the
  project's repo, cached per card in memory, since a landed commit never changes. It fills the card's `spec`, so ✓ Spec
  and the Done page show it. The spec stays a repo document, never copied into the database, as
  `docs/specs/2026-11-26-spec-lane-review-gate.md` decided.
- **The Spec lane stays the spec alone** (reuses). The review's findings, the sign-off and the drafts aren't recorded.
- **"Finished" stays board order** (reuses). A lane before the current one is a link, as in the first slice. History
  doesn't make a later lane a link, since the strip would then show a lane ahead of the card as done. The one live view
  that gains history is Try it's (below): earlier feedback is what you need when you test again.

## Goals

- See what each later lane produced at the time, not just what the card holds now.
- Show Try it's feedback rounds, which nothing shows today.
- Show a landed card's spec.

## Non-goals

- **Mockup.** Its lane isn't built.
- **The Spec lane's drafts, review findings and sign-off.** The Spec lane shows the spec alone.
- **Lane visits:** time spent per lane, and a lane's history across all cards. Both need the `LaneVisit` table
  `ARCHITECTURE.md` plans, which is a spec of its own.
- **Plan amendments.** The spec keeper that triggers them isn't built. When it is, an amendment is one more plan row
  and shows up here with no change.
- **The files changed in earlier build rounds.** A build row holds the developer's report, and the files are worked
  out after it's stored. Only the latest round, still on the card as `build`, lists them.
- **Times on rounds.** The page has no date formatting yet; rounds are told apart by their number.

## Design

### What each later lane shows

| Lane | Each round shows | Rounds come from |
| --- | --- | --- |
| **Spec** | The spec, folded under its path. On a landed card, read from the landed commit. | Not rounds: the spec |
| **Plan** | The plan (`PlanView`) | `plan` rows: one per plan the planner wrote |
| **Build** | What was built, where it departed from the plan and why, and the issues and decisions the developer reported that round. The newest round also lists the files changed. | `build` rows: one per `done` report |
| **Check** | The reviewer's summary, the bugs, and the spec issues the reviewer reported that round (`CheckView`, which gains the issues) | `check` rows: one per finished round |
| **Try it** | Your feedback, as you wrote it. "Accepted" when you accepted. | `feedback` and `accept` rows |
| **Ship** | Unchanged: the Landing chat and where it landed (`DonePanel`) | |

Every lane keeps its read-only chat on the left, as in the first slice. Only the right-hand column changes.

### Rounds

- **Newest on top.** The newest round is open. Every older one is folded under its heading, and a click opens it.
- **Headings.** Plans are "Plan 1", "Plan 2", oldest first. Build rounds and Check rounds are "Round 1", "Round 2" in
  the same way, numbered in the order they ran, so no two share a heading. A Check round's number can differ from the
  chat's ("Round 2 found 3 bugs"), which counts toward the round limit and starts over after a new plan, after your
  feedback and after Ship sends the card back. `CheckView` takes the number to show. Try it's rounds are
  "Feedback 1", "Feedback 2", with one "Accepted" above them. Try it is past only in Ship or Done, so its last row is
  always an acceptance. An earlier acceptance that Back to Try it undid isn't shown.
- **A lane with no rows** shows what the card holds now, exactly as the first slice does. That only happens for a card
  that went through the lane before it recorded anything.
- **One round** shows open, under its heading, with nothing folded.

### Where it comes from

`HiveDb` gains a read of a card's events of given types, oldest first, like `chatsByLane` does for chat. `Hive.card()`
builds the history from it:

```ts
/** What the later lanes produced, newest round first (docs/specs/2026-11-27-later-lane-artifacts.md). */
interface CardHistory {
  plans: Plan[];
  builds: BuildRound[];   // summary, departures, and that round's reported issues and decisions
  checks: CheckRecord[];  // CheckRound, plus the spec issues the reviewer reported that round
  tryit: TryItRound[];    // { kind: "feedback"; text } | { kind: "accepted" }
}
```

- **Build rows hold the developer's report as it came in.** Its issues and decisions have no ids yet; the page keys
  them by position.
- **The history is always sent,** for the current lane too. It's small, building it per lane would only save a few
  rows, and the live Try it panel uses its feedback.
- **Nothing is written that isn't written today.** The rows exist; this change only reads them.

### Earlier feedback in Try it

When a card in Try it has feedback rows, the Try it panel (`TryItPanel`) gains a fold, "Your earlier feedback", shut,
below its feedback box. Open, it lists "Feedback 2", "Feedback 1", newest on top, each as you wrote it. A card on its
first visit to Try it has no rows and shows no fold. Every feedback row is written as the card leaves Try it, and the
page reloads the card when it comes back, so the fold is always up to date.

### A landed card's spec

When a card has `landed` and its worktree is gone, `GET /api/cards/:id` reads the spec with
`git show <landed.commit>:<specPath>` in the project's repo, through a new git service function. The result is cached
per card in memory, since the commit never changes. The read is async, so the route calls `Hive.cardForPage()`, which
reads it and then builds the detail with `card()`. `card()` stays synchronous, for the many tests that call it.

- **It fills `spec`** as `{ path, text, review: "fresh" }`: it was reviewed and signed off before it landed. Looking
  back at ✓ Spec and the Done page both already show `spec` when there is one, so the Done page gains the spec, folded.
- **`card()` fills it directly,** not through `refreshSpec`, which reads the worktree and sends `spec.updated` when
  the spec changes. A landed spec never changes, so it sends nothing.
- **A read that fails** (a project moved, a file renamed in the commit) leaves `spec` null and isn't cached, so the
  next fetch tries again. The first slice's note stays: "The spec can't be shown here: it's on main at `<path>`."
- **Before the card lands,** the spec is read from the worktree as today.

### Docs and changelog

- `ARCHITECTURE.md`: the Event row lists the types written today: `chat`, `error`, `brief`, `plan`, `build`, `check`,
  `feedback`, `accept`, `landed` and `setup`.
- `CONCEPT.md`'s History and Done already lists these. Its Spec bullet ("the drafts, the review's findings, and your
  sign-off") stays ahead of the code, and this change says so in its changelog.
- A changelog entry, `docs/changelog/2026-11-27-later-lane-artifacts.md`, citing `2026-11-27-card-lane-artifacts`.

## Alternatives considered

- **A lane-visit table.** Record each visit and hang its output off it. It also gives time per lane and a lane's
  history across cards, but every move would need changing, and existing cards would start empty. Left for its own spec.
- **A copy when the card leaves a lane.** Simple to read, but it duplicates the event rows, misses rounds within a
  lane, and gives existing cards nothing.
- **Only the last round.** Simpler, but earlier rounds' reports and bugs would be visible nowhere.
- **A lane with history as a link, even a later one.** It would show the rounds of a lane ahead of the card, but the
  strip would then mark a lane the card hasn't reached as done. Only Try it's earlier feedback was worth showing live.
- **Check rounds under the chat's numbers.** They'd match the chat beside them, but Check's count starts over after
  every piece of feedback, so two folds called "Round 1" would be common. A time beside each was also turned down.
- **Every round open.** Nothing to click, but a card with three Check rounds would be a long column of bugs that were
  already fixed.
- **The spec copied into the database at landing.** Rejected again for the same reason as before: the spec is a repo
  document, and the landed commit holds the exact text.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: the lead plus 1 chunk.** The lead first settles `CardHistory` in `packages/shared`, then builds the
  backend: the events read in `db/`, `Hive.card()`'s history, and the landed-spec read in `git/` and `hive.ts`, with
  their tests.
- **Meanwhile a subagent builds the page** against `CardHistory`: the rounds view in `PastArtifact` (`pages/Card.tsx`)
  with its fold, Try it's feedback list, the earlier-feedback fold in `TryItPanel`, and the tests.
- **Opus 5.5 lead, Sonnet 5.5 for the page.** The landed-spec read and the fallback rules need judgment. The rounds
  view transcribes a settled type into existing views.
