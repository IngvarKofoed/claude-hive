# Spec keeper: spec issues judged after Check, and settled without you where they can be

Today the spec issues that Build and Check report only collect on the card. Nothing judges them, so a card can land
with a spec that's wrong in places. This slice adds the spec keeper. The spec keeper is the spec writer's own session,
carried on after sign-off. Once Check passes, the keeper judges the card's open issues in one turn. Each issue gets a
verdict and a level:

- **Settled by the keeper:** a minor spec fix is made in the spec, with a dated line in a new `## Amendments` section.
  A minor code fix goes straight back to the same developer, the way Check's bugs do.
- **Brought to you:** anything that changes what you signed off, or that comes back after it was settled, waits for you
  in Try it. A severe issue stops the card.

A blocked build goes to the keeper at once, before it stops. The developer and the reviewer report only issues that
would change something.

## Outcome

**What you get:**

- **Issues are judged:** when Check passes, the spec keeper judges every open issue. Its messages show in the Check
  chat, and each issue on the card shows its verdict, its level and the keeper's reason.
- **Minor ones are settled without you:**
  - A spec fix lands in the spec, along with a dated line under `## Amendments`, and is committed on the card's branch.
  - A code fix goes to the same developer, and Check's next reviewer verifies it.
  - After two rounds of code fixes, further ones come to you instead.
- **The rest comes to you:**
  - In Try it, one question per issue that changes what you signed off, or that came back: **Keep it as built** or
    **Change the code**, with the keeper's recommendation.
  - Answering never takes the card away from you. Change the code answers go to Build with your own feedback when
    you press Send to Build. Answers in your own words are also written into the spec.
  - A severe issue stops the card with the keeper's finding, **Back to Spec** and **Move on**.
- **A blocked build gets one keeper turn:** if the block is about the spec, the keeper settles it and the developer
  carries on, or it comes to you right then, on the card in Build. A block that isn't about the spec, or a second one
  in the same visit, stops with Retry and Back to Spec as today.
- **Never stuck on the keeper:** a keeper turn that fails offers Retry, and in Check also Move on, which takes the
  card on with its issues marked "Not judged".
- **Fewer, real issues:** the developer and the reviewer leave out what wouldn't change the spec or the code, such
  as lint errors already on main or a test that fails only in the worktree.

**How to verify:**

- **A spec fix:** build a small card whose spec is silent on something the developer has to decide. After Check
  passes, the Check chat shows the keeper judging. The spec on `hive/<card>` has the fix and an `## Amendments` line,
  in a `Spec keeper:` commit. The card is in Try it with the issue marked "Spec fixed".
- **A code fix:** with the fake runner's keeper report saying `code-wrong` / `minor`, the card goes back to Build. The
  developer's message lists the issue with the keeper's reason. After the developer's report, Check starts again at
  round 1, and the reviewer's message asks it to verify that fix.
  - A third such batch since sign-off gives a question in Try it instead.
- **A question:** with a `changes-signoff` verdict, the card reaches Try it with the question, and Accept is refused.
  - **Keep it as built:** the keeper changes the spec and adds an Amendments line, and Accept works again.
  - **Change the code:** the card stays in Try it, and Accept stays refused. Send to Build, with or without feedback,
    takes the card to Build, and the developer's message holds the issue and your words.
- **Severe, a repeat, a blocked build:**
  - A `severe` verdict leaves the card in Check with Back to Spec.
  - An issue the keeper marks as a repeat of an earlier one becomes a question in Try it, whatever its level.
  - A developer report of `blocked` starts a keeper turn, and the developer is resumed with its answer. A `no-change`
    verdict, or a second block, shows Retry and Back to Spec.
  - A keeper report that misses an issue leaves the card in Check with Retry and Move on.

## Key decisions

- **The keeper is a turn in the spec writer's session** (reuses `ARCHITECTURE.md`, Spec keeper;
  `2026-11-26-worktree-resume-keeper-turn`).
  - Its instructions are in a new `roles/spec-keeper.md` and are sent at the top of each keeper message, since the
    session keeps the system prompt of its first turn.
  - `ROLE_TURNS` gets a `spec-keeper` entry with its report, so the Role prompts page shows what the keeper gets.
- **A third verdict, `no-change`** (diverges from the docs' two verdicts). Some issues need neither a spec fix nor a
  code fix: lint errors already on main, or a check that passes anyway. Without this verdict, a keeper has to make up
  an edit to fill the schema.
- **Code fixes go straight to the same developer** (diverges from the docs' "Plan writes a small amendment plan";
  reuses `startDeveloper`'s way in for Check bugs and Try it feedback).
  - There's no planner turn, and Check starts again at round 1.
  - A minor code fix is small by definition, since a large one is `severe`, and the developer already holds the plan.
  - CONCEPT and ARCHITECTURE change to match.
- **Questions are pending items that point at issues** (extends `PendingItem`).
  - A keeper question is an ordinary `question` item, so the card page and For you show it as they already do.
  - It carries `issueIds`, so plain code routes your answer: no session reads it.
  - The item hangs on the spec writer's session.
- **Severe stops the card with an error line** (reuses the error-line-with-buttons pattern; ■ stopped isn't built).
  - In Check it offers Back to Spec and Move on. In Build it offers Back to Spec.
  - Back to Spec now also works from Check.
- **Loop guard: any repeat comes to you, plus a cap in code** (diverges from the docs' "flip back and forth").
  - The keeper links an issue to an earlier one it repeats. A repeat means the automatic fix has already failed once,
    so it becomes a question whatever its verdict.
  - Because that link is a model's judgment, code also caps keeper fix rounds at `KEEPER_FIX_ROUNDS = 2` since sign-off.
    After that, code fixes come to you as questions. Every fix round restarts Check, so `CHECK_ROUNDS` alone can't
    bound this loop.
- **A blocked build gets one keeper turn per Build visit** (extends today's blocked-build handling). A `no-change`
  verdict, or a second block, falls back to today's Retry and Back to Spec, so blocks that aren't about the spec
  can't loop.
- **Spec changes after sign-off are committed by the hive, one file only, each with an Amendments line** (reuses
  sign-off's `commitFile`; the Amendments section is new). The body is edited so it reads true, and `## Amendments` at
  the end records what changed and when.
- **A bar for what's an issue** (extends `roles/developer.md`, `roles/reviewer.md` and the report schemas' issue
  descriptions). Report something only if the keeper would change the spec or the code after reading it.

## Goals

- No card reaches Try it or Ship with spec issues nobody has judged, unless you move it on past a keeper that failed.
- The spec on main describes what was built.
- You see only the issues that need your call.
- A build blocked by the spec carries on when the keeper can settle it, instead of waiting for you.

## Non-goals

- **The manager,** and sending a session's question to the keeper (step 2 of the manager's ladder).
- **■ stopped as a state of its own,** and severe's other ways out: rethink → Refine, narrow the scope, drop the card.
  Back to Spec is the way out for now.
- **Judging issues on cards already past Check.** Their issues stay unjudged.
- **A blocked plan going to the keeper.** It keeps Retry and Back to Spec.
- **Amendments lines for Back to Spec revisions.** Those are followed by a new review and sign-off.

## Design

### The batch

A batch is the card's **open issues**: those with no verdict yet. It's judged when the card would leave Check going
forward:

- **Check passes:** `onReviewerEnded` would move the card to Try it or Ship, and the card has open issues. The card
  stays in Check and gets the note "Round N: no bugs. The spec keeper is judging K issues." Then the keeper's turn
  starts. With no open issues, the card moves on as today.
- **Move on:** the batch is judged as built, so every `code-wrong` verdict becomes a question instead of a fix. You
  chose to try the card as it is.

`Card.judging` records which kind of turn the keeper is in: `batch`, `as-built`, `blocking` or `answers`. A restart,
Retry and the end of the turn all read it. The keeper's turns are hands-off turns: a cut-off one is resumed once after
a restart. Retry sends the same message again. What a failed turn offers is under "After the batch".

**The message** has four parts:
- the keeper instructions from `roles/spec-keeper.md`;
- the open issues, each with its id, where it was found, the spec's section, the problem, and what was built;
- the issues judged earlier on this card, each with its id, section and verdict, so the keeper can mark a repeat;
- how to read the branch: `git diff <base>...HEAD` in its working folder.

**The report** (`KEEPER_SCHEMA`) has `status`, `blockedReason`, `summary`, and one `judgment` per open issue:

| Field | Meaning |
| --- | --- |
| `issueId` | The issue judged |
| `verdict` | `spec-wrong` (the spec changes), `code-wrong` (the code changes), `no-change` (neither) |
| `level` | `minor` (the keeper settles it), `changes-signoff` (it touches the Outcome, a Key decision tagged (new), (diverges) or (breaking), or something you'd see), `severe` (the approach doesn't work, a clash, a security or data risk, far more work, or a flawed idea) |
| `reason` | Why, in a sentence or two |
| `recommendation` | For `changes-signoff` and `severe`: what the keeper would do. Empty for `minor` |
| `repeats` | The id of an earlier issue on this card that this is the same problem as, or null |

A report counts only if it judges every open issue exactly once. Anything else is a failed keeper turn, with "The
spec keeper didn't judge every issue."

**During the turn,** the keeper edits the spec for each `spec-wrong` / `minor` issue that isn't a repeat. It changes
nothing for any other verdict.

### Amendments

Every spec change the keeper makes adds one line to `## Amendments` at the end of the spec. The keeper creates the
section if it isn't there.

```
## Amendments

- 2026-11-28: The list is sorted by name. The spec didn't say, and Build had to choose.
```

The body is edited in place so that it reads true; the Amendments section is the history. After each keeper turn the
hive commits the spec file alone, as `Spec keeper: <title>`, if it changed. Ship's squash takes it along. While a merge
of main is unfinished (a blocked build can stop mid-merge), git refuses a single-file commit. The hive then skips the
commit, as checkpoints already do, and the edit goes in with the developer's merge commit or the next checkpoint.

### After the batch

The judgments are stored on the issues, along with a `judged` history event. Then plain code decides, in
`board/moves.ts` (`laneAfterJudging`), first match winning:

1. **Any `severe`:** the card stays in Check, with an error line holding the keeper's reason and recommendation, and
   Back to Spec and Move on. Move on takes it to Try it as built: the severe issue and every `code-wrong` issue in the
   batch become questions.
2. **Any `code-wrong` / `minor` that isn't a repeat, in a `batch` turn, while fewer than `KEEPER_FIX_ROUNDS = 2`
   keeper fix rounds have run since sign-off:** the card goes to Build. Its fix list is stored in `Card.keeperFixes`,
   `Card.keeperRounds` counts one more, and Check starts again at round 1.
3. **Otherwise:** Try it. A card Ship sent back goes to Ship instead, unless a question waits.

**An issue waits for you** if any of these holds:
- it's `changes-signoff`;
- it's a repeat;
- it's `code-wrong` in an `as-built` turn, or after the fix rounds are used up;
- it's `severe` and you pressed Move on.

Such an issue waits on its row with no answer. When the card enters Try it, the hive raises one question item holding
every waiting issue. That includes waiting issues from an earlier batch, so a card that went through Build first still
asks them.

**Back to Spec** closes every issue that is still open, waiting for you, or judged and not yet acted on, as "Settled
in Spec". The spec writer's message lists them. None of them is judged or asked after the new sign-off.

**A keeper turn that fails** (an error, Stop, a `blocked` report, or a report that misses an issue) leaves an error
line with the reason:
- **In Check:** Retry and Move on. Move on after a failed keeper turn skips the keeper, and the card goes to Try it
  with the open issues marked "Not judged".
- **In Build:** Retry and Back to Spec, as a blocked build has today.
- **In Try it:** Retry. Your answers are kept, and their spec changes wait for the Retry.

**The keeper doesn't ask questions mid-turn.** During a keeper turn, `canUseTool` refuses `AskUserQuestion`, as it does
for setup and the spec reviewer: "Put it in the judgment as `changes-signoff`, or report `blocked`." Without this, the
question would reach the page as a Spec-chat question, because the session's lane is `spec`.

### Back to the developer

`startDeveloper` gets a third way in, next to Check's bugs and your feedback: `Card.keeperFixes`. Its message lists
each issue with its section, the problem, what was built, the keeper's reason, and your words if you wrote any. Then
come "Fix each, then end with your report", the merge note, and the whole-build rule. Like `feedback`, the field is
cleared on the developer's next `done` report.

Each issue sent is marked `fix: sent`. The next Check round's reviewer gets these issues to verify, the way it gets the
last round's bugs, and they're left out of its "already on the card" list. One that isn't fixed is a bug, so it goes
through Check's usual bug loop and round limit. When a round passes, every `sent` issue becomes `fixed`.

### Your answer in Try it

The question shows at the top of the Try it panel. Each issue is one question, worded like this: "<section>:
<problem>. The spec keeper recommends …". There are two options, with the keeper's choice first:

- **Keep it as built:** the spec changes to describe what was built.
- **Change the code:** the code changes to match the spec.

An answer in your own words counts as Change the code, carrying your words.

**Answering never moves the card,** so you can keep trying it. Plain code routes each answer, never a session:

- **Every Keep it as built, and every answer in your own words,** goes to the keeper in one `answers` turn, right away,
  while the card stays in Try it.
  - For Keep it as built: "Change the spec to describe what was built."
  - For your own words: "The person decided this. Make the spec say it." This writes your decision in; it doesn't
    judge it again.
  - Each change gets an Amendments line, and the hive commits the spec afterwards.
  - A `no-change` issue answered Keep it as built needs no edit and no Amendments line. If that's every answer in the
    turn, no turn runs.
- **Every Change the code, and every answer in your own words,** is held on its issue. When you press **Send to
  Build**, the held issues go to the developer by the `keeperFixes` path, together with any feedback you wrote. The
  feedback box may be empty when issues are held. Check then starts again at round 1. You asked for these, so they
  don't count toward `KEEPER_FIX_ROUNDS`.

Send to Build waits until every question is answered. Accept waits until every question is answered, no Change the
code answer is held, and no keeper turn runs. `startDeveloper`'s message can then carry both your feedback and the
held issues.

### A blocked build

The first `blocked` report in a Build visit goes to the keeper. Its reason becomes an issue: found in Build, section
"Blocking", problem = the reason, built = "Nothing yet: the build stopped here". The keeper judges it at once in a
`blocking` turn while the card stays in Build. That turn is given, and judges, only the blocking issue. Any other open
issues wait for the batch after Check.

A second `blocked` report in the same visit gets today's error line with Retry and Back to Spec, with no keeper turn.
`Card.blockJudged` records that the visit has had its turn, and entering Build clears it.

What follows the judgment is the first row that matches, top to bottom:

| Judgment | What follows |
| --- | --- |
| `severe` | Stays in Build with the error line and Back to Spec |
| `no-change`, any level | The block isn't about the spec (a missing credential, a failed install). Today's error line, with the keeper's reason, Retry and Back to Spec |
| `changes-signoff`, or a repeat | A question now, on the card in Build, with **Change the spec** and **Keep the spec**. Change the spec runs an `answers` turn that edits the spec, the hive commits it, and then the developer is resumed as for `spec-wrong`. Keep the spec resumes the developer with "The spec stands: <reason>". An answer in your own words counts as Change the spec: the `answers` turn writes your decision into the spec, and the developer is resumed with it. |
| `spec-wrong` / `minor` | The keeper fixes the spec, and the hive commits it. The developer is resumed: "The spec keeper changed the spec: <reason>. Carry on." |
| `code-wrong` / `minor` | The developer is resumed: "The spec stands: <reason>. Carry on." |

A missing report, or a `done` report over an unfinished merge, keeps Retry and Back to Spec as today. Issues in a
blocked report are not stored, since the next `done` report lists them again.

### What counts as an issue

The "Spec issues" bullet in `roles/developer.md` and `roles/reviewer.md`, and the `issues` descriptions in both
schemas, get the bar:

> Report an issue only if the spec keeper would change the spec or the code after reading it: the spec blocked you,
> forced a departure, made you choose between readings that build different things, contradicts itself or the code,
> or has a How-to-verify check that can't be carried out as written. Leave out wording, naming and structure, a gap
> you filled the obvious way, and anything that isn't about the spec, such as a tool or test that fails on main too,
> or a local environment problem. Say those in your summary.

### Data and events

- **`issues`:** gains `repeats`, `recommendation`, `answer` and `fix` (`sent` / `fixed`). The existing `verdict`,
  `level` and `reason` are filled in. `flips` counts the repeats in a chain, for history.
- **`SpecIssue`:** gains the judgment, your answer and the fix state.
- **`cards`:** gains `judging`, `keeper_fixes`, `keeper_rounds` (cleared at sign-off) and `block_judged`.
- **Question items:** a `question` item gains optional `issueIds`, aligned with its questions.
- **Chat:** `ChatAuthor` gains `spec-keeper`. A keeper turn's text goes to the chat of the lane the card is in, not to
  Spec's.
- **The page:** the issue list's heading becomes "Spec issues". Each issue shows one state: "Waiting for the spec
  keeper", "Not judged", "Spec fixed", "Sent to the developer", "Code fixed", "No change", "Waits for you", "Severe",
  "Settled in Spec" or your answer. The keeper's reason is shown under it.

### Docs

- **CONCEPT, Spec Issues During the Build:**
  - code fixes go to the developer, not Plan;
  - the `no-change` verdict;
  - the bar for what's an issue;
  - the Amendments section;
  - any repeat comes to you, and two fix rounds at most;
  - a keeper that fails can be moved past.
- **ARCHITECTURE:**
  - Card Moves:
    - a blocked build goes to the keeper once per visit;
    - Check passing with code fixes goes to Build;
    - Back to Spec from Check;
    - Move on after a severe verdict or a failed keeper turn;
  - the Spec keeper section;
  - the keeper's report under Role reports;
  - the Issue fields in the Data Model;
  - `spec-keeper` in the roles table, as instructions that ride in the spec writer's session.

## Alternatives considered

- **Only flips come to you** (a repeat with a changed verdict, or the docs' second flip). Rejected: a repeat with the
  same verdict means the fix didn't take, and settling it again the same way would loop.
- **Your own words go back to the keeper,** which judges again. Rejected: words that differ from "keep it" are almost
  always a change you want made. The keeper writes them into the spec, but doesn't judge them.
- **Your own words go only to the developer.** Rejected: the spec would go stale, and the next batch could judge your
  choice as `code-wrong`.
- **Change the code moves the card at once.** Rejected: a bug you found while trying the card couldn't go with it,
  and answering early would take the card away from you.
- **Move on always skips the keeper.** Rejected: the issues would reach Try it and Ship unjudged, which is what this
  slice ends. Move on skips it only after a keeper turn has failed.

- **An amendment plan from Plan** (the docs' way). Rejected: it adds an Opus planner turn per code fix, and Check's bugs
  and your feedback already go straight to the developer.
- **A round limit instead of a per-issue loop guard.** Rejected: you asked for the loop guard now. The cap of two
  fix rounds sits alongside it as a backstop, not in its place.
- **No check that a keeper code fix was made.** Rejected: the next reviewer is told not to re-report issues already on
  the card, so an unfixed one would ship marked as fixed.
- **Only Back to Spec after a severe verdict.** Rejected: a severe call you disagree with would cost a new review,
  sign-off and plan to get past.
- **Raising questions while the card is in Check.** Rejected: the docs want you to try the card as built before you
  answer, and the card shouldn't wait on you before Try it.
- **A fresh keeper session per batch.** Already rejected in `2026-11-26-no-session-copies`: the spec writer's session
  holds the chats and the spec's reasoning.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: the lead plus 2 chunks.** The lead builds the backend core in `packages/backend/src/hive.ts`,
  `board/moves.ts`, `spec/reports.ts`, `db/index.ts` and `packages/shared/src/index.ts`, writes `roles/spec-keeper.md`
  and the role bars, and writes the fake-runner tests, settling the shared types first. Then, in parallel:
  - one subagent builds the page (`BuildView`, `TryItPanel`, chat author) against those types;
  - one subagent updates `docs/CONCEPT.md` and `docs/ARCHITECTURE.md` from the Docs list.
- **Opus 5.5 lead, Sonnet 5.5 for both chunks.** The routing and restart handling interpret `(diverges)` decisions;
  the page and the doc edits follow settled text.
