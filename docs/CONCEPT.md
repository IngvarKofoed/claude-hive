# Claude Hive — Concept

Claude Hive is a kanban board for Claude Code work, in one web page on your machine. An idea goes in as two sentences. You shape it with Claude in conversation: what it is, how it looks, and the spec. Then you let go. Claude plans, builds and checks it on its own, and hands it back for you to try. When you accept it, it lands on main as one clean commit. Every repo you work in is a row on the same board.

## Goals

1. **As much automation as possible, with you in the loop for what's important.**
2. **One overview** of every session, agent and repository.
3. **One window.** Everything happens in one web page. No terminals to juggle.

## Core Idea

Claude's work is cheap and runs in parallel. Your attention is the scarce thing. So the hive puts your attention where it matters most, shaping the idea and trying the result, and runs everything in between without you.

- **The board is the coordinator.** Each lane has a role and plain rules for when a card moves on. No Claude session sits in the middle passing messages between roles.
- **Work-in-progress limits pace the hive to you.** If Try it is full, nothing new gets built. Meanwhile the lanes before the build (Refine, Mockup, Spec) keep cards ready for when you have time.
- **The card carries everything.** Each role reads the card, does its work and writes back. Nothing important lives only inside one session.

## The Board

Lanes are the columns, and projects are the rows (swimlanes). Each lane has a limit on how many cards it may hold.

| Lane | Who | What happens | Moves on when |
| --- | --- | --- | --- |
| **Ideas** | you | You type an idea. Two sentences is enough. | You drag it to Refine. |
| **Refine** | you ⇄ product owner | A chat until the idea is clear. The product owner has already read the repo and the rulebook, and opens with a draft brief: the problem, who it's for, what done looks like, and what's out of scope. | You say **Good**. |
| **Mockup** | you ⇄ designer | A clickable mockup built in the real app, with fake data. You comment by pointing at the screen. A real choice can be built as versions to compare side by side. Skipped when there's nothing to show. | You say **Good**. |
| **Spec** | spec writer, then you | A full spec in the spec format, written in one go from the chats and the mockup. It includes the technical design, worked out by reading the code. A blind review reads it. Its decisions come to you, and its fixes are applied. | You **sign off**. |
| **Plan** | planner | The build plan the spec deliberately leaves out: the steps in order, which chunk each agent owns, the tests, and how each step is checked. | The plan is written. |
| **Build** | developer(s) | Builds to the plan, staffed as the spec's Implementation strategy says. Replaces the mockup's fake data with the real thing. | It's built. |
| **Check** | reviewer, tester | Read-only. They review the whole branch against main and compare the code with the spec (missing, different, extra). They run the spec's How-to-verify checks and compare the screens with the approved mockup. Check fails if any fake data is left. | Everything passes. |
| **Try it** | you | You test by hand, with the app already running and a test guide ready. | You accept, or give feedback. |
| **Ship** | the hive | Lands the card on main as one commit. | It's pushed. |
| **Done** | | The card's full story, kept so you can look back. | |

## Where You Come In

**Refine and Mockup** are back-and-forth chats that go on until you say Good. The agent may say it thinks the card is ready, but only you move it on.

**Spec** is mostly reading. **Sign off** stays greyed out while the review runs, and again if the spec has changed since the review read it.

**Try it** is prepared so your testing is quick:

- the app is running on its own port, with test data;
- a short test guide, written from the spec's How-to-verify bullets;
- what the automated checks covered, so you don't retest it, and what they couldn't check, so you do;
- every decision made without you, each with **Redo the other way**.

Your feedback goes back to the lane it belongs to. The hive picks the lane and shows it, and you can change it with one click:

| You write | Back to |
| --- | --- |
| "I wanted this per printer, not for all printers" (the *what* was wrong) | **Refine**: the same product owner session, which still remembers your chat |
| "The slider should be a dropdown" (the *look* was wrong) | **Mockup** |
| "It crashes when there are no printers" (a bug) | **Build** |

Feedback that changes the what or the look also changes the spec, so the card passes through Spec again, with a new review. A bug leaves the spec as it is.

## Hands Off: What Still Reaches You

Between your sign-off and Try it, the hive works without you. Only these reach you:

1. **Questions the manager can't settle** (see The Manager). They come with its recommendation.
2. **Spec issues that change what you signed off.** The build carries on with "keep as built" until you answer.
3. **Severe issues.** The card stops.
4. **Loops:** the same issue flipping back and forth, or Check sending a card back to Build more times than the round limit.
5. **Approvals:** pushing to main, and anything that's hard to undo, leaves your machine or touches security.

Everything else is decided by the hive and written into the card's history as "decided for you". Each such decision has a **Redo the other way** button. It works like any other fix: the hive resumes the session that made the decision and tells it to switch to the other choice, and the card goes through Check again.

## Key Concepts

### Project

A repository, or a new folder not yet in git. Each project is a swimlane on the board and has its own rulebook.

### Card

One feature, from idea to Done. It carries everything:

- the brief;
- the mockup versions;
- the spec;
- the plan and its amendments;
- issues and their verdicts;
- the decisions made for you;
- the check rounds and your feedback rounds;
- a history tab for every lane.

### Role

Each lane's instructions, model and tools. Roles are enforced through the tools each session gets, not only through instructions:

- **Reviewer and tester** can't edit files.
- **The spec writer** edits only the spec.
- **Refine** doesn't change the repo at all. The brief lives on the card.

### Sessions

- **A new session for each card in each lane,** started with the role's instructions and the card.
- **Conversations continue the same session.** A card sent back to Refine resumes the product owner session that refined it. A card sent back to Build resumes the developer that built it. **Redo the other way** resumes the session that made the decision.
- **Nothing runs between turns.** A kept session costs nothing.

### Rulebook

What the hive knows about how you want things. Each project has one, plus one shared by all projects.

- **Choices you make become rules,** in plain words: *"flux: printer settings live in Preferences"*.
- **You can write rules yourself, both ways:** rules that decide (*"use the existing button styles"*) and rules that make the hive ask (*"always ask before adding a library"*).
- **Every session reads its project's rulebook first.**

## The Mockup Becomes the Build

- **The designer writes real code** in the app's own components and conventions. Its code stays and becomes the start of the build.
- **Fake data is marked** with a marker such as `HIVE-MOCK`. Build replaces it. Check searches for the marker and sends the card back if one is left.
- **Check reviews the whole branch against main,** because the mockup code is never reviewed on its own.
- **The approved mockup is the visual reference.** The tester compares the finished screens with it.
- **The spec can point at mockup code** in its Key decisions, e.g. *"(reuses) the PrinterSettings panel built in the mockup"*.

## Spec Issues During the Build

The builder, reviewer and tester find mismatches between spec and code:

- the spec is silent, unclear or contradicts itself;
- what the spec asks for doesn't fit the code as it really is;
- something is missing, done differently, or added without being asked for;
- a How-to-verify check fails, or can't be carried out as written.

Each becomes an issue on the card. **The build doesn't stop for them.** The builder notes the issue, makes its best guess and keeps going. Issues are judged in a batch at the end of Build and again after Check. Only a blocking issue is judged immediately.

**The spec keeper judges.** It is the spec writer's own session, which carries on after sign-off. It holds your Refine chat, your Mockup comments, the code research and the spec's reasoning. Each batch of issues is a new turn in it: it re-reads the current code, and it remembers its earlier verdicts, so its calls stay consistent.

Each issue gets a verdict:

- **The spec is wrong:** the spec is updated, and the code stays as it is.
- **The code is wrong:** Plan writes a small amendment plan, Build carries it out, and Check re-checks.

Each issue also gets a level:

| Level | Example | What happens |
| --- | --- | --- |
| **Minor** | The spec was silent about the order of a list | The spec keeper decides on its own. |
| **Changes what you signed off** | It touches the Outcome, a Key decision tagged (new), (diverges) or (breaking), or something you'd see | A question to you. The build carries on with "keep as built" until you answer. |
| **Severe** | The approach doesn't work in this codebase, the feature clashes with another part of the product, a security or data risk turns up, the work is far bigger than the spec assumed, or the idea itself looks flawed | **The card stops** and comes to you. It shows what was found, why it matters, the options (redesign → Spec, rethink → Refine, narrow the scope, drop it) and a recommendation. |

**Loop guard:** if the same issue flips back and forth (spec, then code, then spec again), it comes to you instead of looping.

## The Manager

The manager steps in when a session in a hands-off lane asks a question. In Refine, Mockup and Spec you're already in the conversation, so questions there come straight to you.

It works down a ladder:

1. **Is it already answered** by the rulebook, the spec, or your earlier answers on this card or others? Then it answers and notes the source.
2. **Is it really about the spec?** Then it goes to the spec keeper.
3. **Is it minor and invisible to you?** Then the manager decides, and the decision is recorded under "decided for you" with **Redo the other way**.
4. **Otherwise it comes to you, prepared:** which card and lane it's from, what's at stake, the session's original options unchanged, and the manager's recommendation.

- **Options are never retyped.** Code passes the session's question and options through as they are. The manager only adds context and a recommendation.
- **One short-lived manager session per question,** so questions never queue and nothing grows all day.
- **It learns:** when you answer a forwarded question, it suggests a rule for the rulebook.
- **It notes what slipped through.** A question during Build usually means the spec review missed something. The manager records that in the Spec lane's history.
- **Everything it does goes into the card's history.**

## Worktrees

- **Ideas have no worktree.** Entering Refine creates one at `<repo>/.claude/worktrees/<card>`, on a branch `hive/<card>` taken from the latest main.
- **Setup starts at once,** in the background while you chat: local files and dependencies are copied and installed.
- **Refine reads the code from this clean copy,** never from your own checkout.
- **The number of worktrees is bounded** by the lanes' work-in-progress limits.
- **Mockup versions get worktrees of their own.** The designer builds them one after another. When you pick one, the others are deleted.
- **Each card's app runs on its own port.**
- **Lanes commit checkpoints freely** on the card's branch. The card shows how far it is behind main, and Build starts by bringing in the latest main.
- **Parking a card** (back to Ideas) removes the worktree but keeps the branch. Moving the card forward again rebuilds the worktree.
- **Dropping a card** removes the worktree and keeps the branch for a while.
- **Projects not in git** have no worktrees, so their code lanes take one card at a time.

## Ship

Clean history: one commit per card, no merge commits, no branches left behind.

1. Rebase the card onto the latest main.
2. Re-run the checks.
3. **Approve:** *"Land printer font size on main and push?"* A rule can turn this step off for a project.
4. Squash everything into one commit, in the repo's commit style. The message has the card's title, a line or two from the spec's "What you get", the spec's path, and a `Hive-Card:` trailer that links back to the card.
5. Fast-forward main and push.
6. Remove the worktree and the branch.

- **One card ships at a time per project,** so every rebase is against the true latest main.
- **Conflicts go back to Build,** because resolving one means writing code. The card then passes through Check again before shipping.
- **Ship never touches your own checkout's files.** If uncommitted work of yours is in the way, Ship waits and tells you.
- **Nothing is lost by squashing.** Before it squashes, Ship saves each lane's changes into the card's history.

## History and Done

**A card has a history tab for every lane:**

- **Refine:** the chat and the brief;
- **Mockup:** the versions, your comments, and the one you picked;
- **Spec:** the drafts, the review's findings, and your sign-off;
- **Plan:** the plan and its amendments;
- **Build:** what was built, and where it departed from the plan and why;
- **Check:** each round's findings;
- **Try it:** your feedback rounds.

It also shows every judgment, manager action and "decided for you", the time spent in each lane, and the commit the card landed as.

**A lane has a history across all cards.** For example, the Plan lane shows every plan next to what actually happened: *"planned 3 chunks, built in 5 rounds, 2 departures"*. Over time this shows which role needs better instructions.

**Done cards can be searched,** by a word or from a commit through its `Hive-Card:` trailer.

**Sessions are archived when a card reaches Done,** because Claude Code deletes old session files after a while.

## The Page

One page, with several views:

- **Board:** lanes by projects. Each card shows a badge:
  - ● needs you
  - ▶ working
  - ◆ versions to compare
  - ■ stopped

  The lane headers show their work-in-progress limits.
- **For you:** everything waiting for you, across the whole board, oldest first.
- **Card:** opens on the lane the card is in. The chat sits next to the brief, the mockup or the spec. You comment by selecting text in the spec or clicking on the mockup. Tabs show every lane's history.
- **Lane:** the lane's history across all cards.
- **Rulebooks:** read and edit them.

You start an idea by typing into a project's Ideas cell. Closing the page loses nothing: sessions keep running on your machine, and anything waiting for you stays there until you're back.

## A Card's Journey

1. **Ideas.** In flux you type: *"The printer font is too small for some users. Make it adjustable."*
2. **Refine.** The product owner opens with a draft brief and asks: per printer, or for all printers? You answer per printer. After three rounds you say Good.
3. **Mockup.** Two versions: a slider in the print dialog, and a field in the printer settings. You click B's field and write *"max 24"*, then say Good.
4. **Spec.** The spec is written in one go. The review flags one decision: what should existing printers get? You pick 12, then sign off.
5. **Plan, Build and Check** run on their own.
   - Build finds that the settings table has no per-printer column. The spec keeper judges it minor and updates the spec.
   - The tester asks about rounding, and the manager finds the answer in the spec.
6. **Try it.** The app is running on port 5213, with a test guide and two decisions made for you. You find that the label overlaps on small screens, and the hive sends the card to Build. Next time round, you accept.
7. **Ship.** You approve, and one commit lands on main. The card moves to Done.

## Out of Scope for Now

- **Cost tracking and budgets.** The hive runs on your Claude subscription.
- **A lead that coordinates across cards.** Two cards changing the same files can later be caught by a plain code check.
- **Cards that depend on each other.**
- **The hive proposing work on its own.**
- **Access from other devices,** notifications outside the page, and sessions on other machines.

## Open Questions

1. **Lanes per project or card type:** e.g. a bugfix that skips Refine and Mockup.
2. **Role instructions:** where they live, and how the lane histories feed back into them.
3. **Where rulebooks live:** in the repo, or in the hive's own data.
4. **Sessions the hive didn't start:** should the overview also show your terminal sessions, read-only?
5. **Subscription limits:** how should the hive behave near your plan's 5-hour and weekly usage limits? For example, pause the hands-off lanes first.

## Feasibility Notes

Tested on 2026-11-26 with Claude Code 2.1.332 and Agent SDK 0.3.332:

- **Questions reach the host program mid-run.** It answers, and the session carries on.
- **Resume keeps the conversation,** and your skills are available inside SDK sessions.
- **A session can be split, or copied from an earlier message,** though the hive no longer does either. Copies made from one point ran in parallel, each knew only what came before that point, and the original's file stayed byte for byte the same. `forkSession()` can copy from a message before a compaction; `resumeSessionAt` can't. A copy can start mid-turn: a tool call that had no result yet comes back to it as an error.
- **Fixed-format reports arrive valid** (`outputFormat`) after a run of tool calls. But a session that can't fill in a field makes up a value that passes the schema, and one that can't satisfy the schema ends "successfully" with no report. So every report has a way to say it's blocked, and the hive checks that the report is there.
- **A session can move between worktrees.** Resumed with another working folder, it kept its conversation and worked in the new folder. Its transcript stays where the session started. The designer builds mockup versions this way.
- **A chat session can take on the spec keeper's job.** On a later turn it returned a valid fixed-format report, then went back to chatting. Its role instructions stay those of its first turn, so the spec keeper's instructions come with each batch's message.
- **A new worktree needs no trust prompt.** It counts as trusted when a folder above it is. In a folder nobody has trusted, a session runs without the project's CLAUDE.md and doesn't say so, while the repo's hooks still run.
- **Plain `claude -p` is not enough.** Without a host program, sessions can't ask questions, and anything not allowed up front is refused.

Seen in the SDK's type definitions, not yet tested:

- **Your plan's usage** for the 5-hour and 7-day windows.
- **Subagent messages tagged with the agent that started them** (`--forward-subagent-text`).

The spec format is read from `~/.claude/skills/spec-format/` (`format.md` and `review.md`).
