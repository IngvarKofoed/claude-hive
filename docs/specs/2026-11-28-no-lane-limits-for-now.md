# No lane limits for now

The By lane headers show "limit 3", "limit 2" and so on, and CONCEPT.md and ARCHITECTURE.md say work-in-progress limits pace the hive. Nothing enforces them: they are placeholder numbers in the shared lane list, recorded as such in `2026-11-26-board-refine-chat-slice`. You don't want limits for now, so this card removes them everywhere they're promised: the `limit` field and its header text in the code, every lane-limit sentence in the two source-of-truth docs, the "limit N" line in the board mockup, and the owed follow-up about limits deadlocking. Round limits, plan usage limits and time limits are a different thing and stay.

## Outcome

**What you get:**

- The By lane headers show only the lane's name and who works in it. No header says "limit N".
- CONCEPT.md and ARCHITECTURE.md no longer mention lane or work-in-progress limits, and say nothing in their place.
- The board mockup in `docs/mockups/Main.dc.html` matches the page: no "limit N" under the lane headers.
- A changelog entry says lane limits were removed and why.

**How to verify:**

- Open the board in By lane: every header has the lane name and, where there is one, who works in it, and nothing else. By project looks as before.
- `grep -niE "work-in-progress|lane limit|laneLimits|lanes, limits|has a limit" docs/CONCEPT.md docs/ARCHITECTURE.md docs/CLAUDE_TODO.md` finds nothing, while `grep -ni "round limit" docs/CONCEPT.md docs/ARCHITECTURE.md` still finds the round-limit lines.
- `grep -rn "limit" packages/shared/src packages/frontend/src` finds nothing about lanes, and the frontend type-checks and its tests pass.
- Read `docs/mockups/Main.dc.html`, which renders only on the design tool's canvas, not in a browser: the lane header template has just the `{{ lane.name }}` and `{{ lane.who }}` lines, and no entry in the `lanes` array has a `limit` key.

## Key decisions

- **Delete the field, don't hide it** (breaking). `limit` goes from `LaneInfo` and from every `LANES` entry in `packages/shared/src/index.ts`. Its only reader is the header in `packages/frontend/src/pages/Board.tsx`, so the contract change stays inside this repo. A field nobody reads would keep inviting someone to enforce it.
- **Remove from the docs outright, with no "parked" note** (diverges). The docs park other undecided things in place ("A per-role permissions policy is parked"). Here the person chose to remove completely: the sentences go, and nothing says limits might come back.
- **The mockup follows the page** (reuses). `packages/frontend/CLAUDE.md` says "the look is the mockup", so the mockup loses its limit line too. Otherwise the next screen built from it would bring the line back.
- **Only lane limits go** (reuses). Check's round limit (`CHECK_ROUNDS`), the keeper's cap of two fix rounds, plan usage limits, the setup and app time limits, and the phrase "a role's limits" (what its instructions allow) all mean something else and stay word for word.
- **The deadlock follow-up is deleted** (reuses). `docs/CLAUDE_TODO.md` deletes an item once it no longer applies. With no limits there is nothing to deadlock on.
- **One new changelog entry, history untouched** (reuses). `docs/changelog/2026-11-28-no-lane-limits.md` cites `2026-11-26-board-refine-chat-slice`. Older entries and specs that mention limits stay as written.

## Goals

- What the page shows and what the docs say both match how the hive behaves: there are no lane limits.
- Leave nothing behind that suggests limits exist or are planned.

## Non-goals

- Round limits: Check's round limit and the keeper's cap of two fix rounds.
- Subscription and plan usage limits (the 5-hour and 7-day windows), and the open question and risk about them.
- Any other way of pacing the hive in place of limits.
- Setup and app time limits.
- Editing older changelog entries and specs.

## Design

### Code

- **`packages/shared/src/index.ts`:** delete `limit: number | null` and its doc comment from `LaneInfo`, and the `limit: …` key from each of the ten `LANES` entries. Nothing else in the lane list changes.
- **`packages/frontend/src/pages/Board.tsx`:** delete the `{lane.limit !== null ? <span className={styles.limit}>…</span> : null}` line in the By lane header row. The header cell keeps its name and `who` spans as they are.
- **`packages/frontend/src/pages/Board.module.css`:** the shared `.who, .limit { … }` rule becomes `.who { … }` with the same declarations.

No backend file reads lane limits, and no database column or setting holds them, so the backend doesn't change.

### Docs

Each change deletes text. Only a sentence that would read wrong is reworded.

| File, section | Now | After |
| --- | --- | --- |
| CONCEPT, Core Idea | The bullet "**Work-in-progress limits pace the hive to you.** If Try it is full, … for when you have time." | The bullet is gone. The section keeps its other two bullets. |
| CONCEPT, The Board | "… (see The Page). Each lane has a limit on how many cards it may hold." | The last sentence is gone. |
| CONCEPT, Worktrees | The bullet "**The number of worktrees is bounded** by the lanes' work-in-progress limits." | The bullet is gone. |
| CONCEPT, The Page | "**By lane:** lanes by projects. The lane headers show their work-in-progress limits." | "**By lane:** lanes by projects." |
| ARCHITECTURE, Overview diagram | The Board engine box reads "lanes, limits," / "moves, loop guard". | "lanes, moves," / "loop guard", padded so the box keeps its width. |
| ARCHITECTURE, parts table | Board engine: "Lanes, work-in-progress limits, card moves, round limits and the loop guard." | "Lanes, card moves, round limits and the loop guard." |
| ARCHITECTURE, Project Structure | `board/  # Lanes, limits, moves, round limits, loop guard` | `board/  # Lanes, moves, round limits, loop guard` |
| ARCHITECTURE, Data Model | Project: "name, path, trustWarning, laneLimits. …" | "name, path, trustWarning. …" |
| CLAUDE_TODO | The item "**Work-in-progress limits can deadlock** — …" | The item is gone. |

The Hands Off list's "more times than the round limit", the Card Moves rows on round limits, the keeper's "usual round limit", Open question 5 and Risk 1 (subscription limits), and both "a role's limits" lines stay as they are.

### Mockup

In `docs/mockups/Main.dc.html`, delete the third `<span>` in the lane header (`{{ lane.limit }}`, the monospace 10px line), and the `limit: '…'` key from each of the ten objects in the `lanes` array. `docs/mockups/canvas.json` and the other mockups don't mention limits.

### Changelog

`docs/changelog/2026-11-28-no-lane-limits.md`. The lead says the board no longer shows lane limits and the docs no longer promise them. They were placeholders nobody enforced (cite `2026-11-26-board-refine-chat-slice`), and limits aren't wanted for now. `## Detail` records:

- what stays: round limits, plan usage limits, and the setup and app time limits;
- that the deadlock follow-up went with the limits;
- that nothing paces the hive now, so the number of cards in a lane, and of worktrees, has no bound;
- the rejected options: hiding the field, and a "parked" note in the docs.

## Open questions

- **Q:** Should the By lane bullet in CONCEPT's The Page say what the headers show now ("each header shows the lane and who works in it")? **Default:** no. The Board table already says who works in each lane, and the bullet reads fine as "lanes by projects."

## Alternatives considered

- **Hide the text and keep the field.** The smallest change, but it leaves a number in `LANES` that the docs no longer explain and that someone might later enforce. Rejected: the brief wants the field gone.
- **Mark limits as parked in the docs.** The way the docs handle the per-role permissions policy. Rejected in Refine: you chose "Remove completely".
- **Leave the mockup alone, since it's only a reference.** Rejected in Refine: you chose to strip it too, because the page is built from the mockup.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Sonnet 5.5.** Three code files, four doc files and a new changelog entry, all deletions spelled out above. Nothing could be handed off without first explaining the rest. Where the developer is fixed on Opus, it does this itself: writing a subagent's brief would take longer than the edits.

## Amendments

- 2026-11-28: The mockup check in How to verify now reads `Main.dc.html`'s source, where it used to open the file in a browser. `docs/mockups/README.md` says `.dc.html` files render only on the design tool's canvas, so the browser check couldn't be carried out.
