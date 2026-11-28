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

Lanes are the columns, and projects are the rows (swimlanes). The page can also show the board by project, with the lane written on each card (see The Page). Each lane has a limit on how many cards it may hold.

| Lane | Who | What happens | Moves on when |
| --- | --- | --- | --- |
| **Ideas** | you | You type an idea: a title, and a text of two sentences or so. You can edit both until it starts. | You drag it to Refine, or press Start. |
| **Refine** | you ⇄ product owner | A chat until the idea is clear. The product owner has already read the repo and the rulebook, and opens with a draft brief: the problem, who it's for, what done looks like, and what's out of scope. | You say **Good**. |
| **Mockup** | you ⇄ designer | A clickable mockup, made however the designer thinks best. You comment by pointing at the screen. A real choice can be built as versions to compare side by side. Skipped when there's nothing to show. | You say **Good**. |
| **Spec** | spec writer, then you | A full spec in the spec format, written in one go from the chats and the mockup. It includes the technical design, worked out by reading the code. A blind review reads it. Its decisions come to you, and its fixes are applied. | You **sign off**. |
| **Plan** | planner | The build plan the spec deliberately leaves out: the steps in order, which chunk each agent owns, the tests, and how each step is checked. | The plan is written. |
| **Build** | developer | Brings in the latest main first, then builds to the plan. One developer per card, which hands chunks to its own subagents when the spec's Implementation strategy calls for several agents. | It's built. |
| **Check** | reviewer, tester | Read-only. They review the whole branch against main and compare the code with the spec (missing, different, extra). They run the spec's How-to-verify checks and compare the screens with the approved mockup. | Everything passes. |
| **Try it** | you | You test by hand, with the app already running and a test guide ready. | You accept, or give feedback. |
| **Ship** | the hive | Lands the card on main as one commit. | It's on main. |
| **Done** | | The card's full story, kept so you can look back. | |

## Where You Come In

**Refine and Mockup** are back-and-forth chats that go on until you say Good. The agent may say it thinks the card is ready, but only you move it on.

**Spec** is mostly reading. You press **Review** when you think the spec is ready. **Sign off** stays greyed out until a review has run, while it runs, and again if the spec has changed since the review read it.

**Try it** is prepared so your testing is quick:

- the app is running on its own port, with test data, started by the hive from the commands the worktree's setup worked out;
- a short test guide, written from the spec's How-to-verify bullets;
- what the automated checks covered, so you don't retest it, and what they couldn't check, so you do;
- every decision made without you, so you can ask for any of them the other way in your feedback;
- any question about a spec change that waits for you, with the spec keeper's recommendation.

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
2. **Spec issues that change what you signed off.** They come with the spec keeper's recommendation. The card goes on to Try it as built, and the question waits for you there.
3. **Severe issues.** The card stops.
4. **Loops:** the same issue flipping back and forth, or Check sending a card back to Build more times than the round limit.
5. **Approvals:** pushing to main.

Everything else is decided by the hive and written into the card's history as "decided for you". Try it lists these decisions. If you want one the other way, you say so in your feedback, like any other change.

## Key Concepts

### Project

A repository. A folder that isn't one yet becomes one when you add it: the hive runs `git init` and commits what's there. Each project is a swimlane on the board and has its own rulebook.

### Card

One feature, from idea to Done. It carries everything:

- the brief;
- the mockup versions;
- the spec;
- the plan and its amendments;
- issues and their verdicts;
- the decisions made for you;
- the check rounds and your feedback rounds;
- every lane's history, reached from the lane strip on its page.

### Role

Each lane's instructions and model. Every session has the same full access, in Claude Code's auto mode. The instructions tell each session its role and whether it may change code, and for now nothing else enforces that:

- **Reviewer and tester** don't change files.
- **The spec writer** edits only the spec.
- **Refine** doesn't change the repo at all. The brief lives on the card.

### Sessions

- **A new session for each card in each lane,** started with the role's instructions and the card.
- **Conversations continue the same session.** A card sent back to Refine resumes the product owner session that refined it. A card sent back to Build resumes the developer that built it.
- **Nothing runs between turns.** A kept session costs nothing.

### Rulebook

What the hive knows about how you want things. Each project has one, plus one shared by all projects.

- **Choices you make become rules,** in plain words: *"flux: printer settings live in Preferences"*.
- **You can write rules yourself, both ways:** rules that decide (*"use the existing button styles"*) and rules that make the hive ask (*"always ask before adding a library"*).
- **Every session reads its project's rulebook first.**

## Mockups

- **How a mockup is made is the designer's call:** in the app itself, or as a page of its own. The hive adds nothing of its own to it.
- **The approved mockup is the visual reference.** The tester compares the finished screens with it.

## Spec Issues During the Build

The builder, reviewer and tester find mismatches between spec and code:

- the spec is silent, unclear or contradicts itself;
- what the spec asks for doesn't fit the code as it really is;
- something is missing, done differently, or added without being asked for;
- a How-to-verify check fails, or can't be carried out as written.

Each becomes an issue on the card. **The build doesn't stop for them.** The builder notes the issue, makes its best guess and keeps going. Issues from Build and Check collect on the card and are judged together, in one batch once Check passes. Only a blocking issue is judged immediately.

**The spec keeper judges.** It is the spec writer's own session, which carries on after sign-off. It holds your Refine chat, your Mockup comments, the code research and the spec's reasoning. Each batch of issues is a new turn in it: it re-reads the current code, and it remembers its earlier verdicts, so its calls stay consistent.

Each issue gets a verdict:

- **The spec is wrong:** the spec is updated, and the code stays as it is.
- **The code is wrong:** Plan writes a small amendment plan, Build carries it out, and Check re-checks.

Each issue also gets a level:

| Level | Example | What happens |
| --- | --- | --- |
| **Minor** | The spec was silent about the order of a list | The spec keeper decides on its own. |
| **Changes what you signed off** | It touches the Outcome, a Key decision tagged (new), (diverges) or (breaking), or something you'd see | A question to you, with the spec keeper's verdict as its recommendation: keep it as built, or change the code. The card goes on to Try it as built, and the question waits there. Choosing to change the code sends the card to Plan for an amendment. |
| **Severe** | The approach doesn't work in this codebase, the feature clashes with another part of the product, a security or data risk turns up, the work is far bigger than the spec assumed, or the idea itself looks flawed | **The card stops** and comes to you. It shows what was found, why it matters, the options (redesign → Spec, rethink → Refine, narrow the scope, drop it) and a recommendation. |

**A batch with mixed results:** spec fixes are made at once, every code fix goes into one amendment, and questions for you wait in Try it.

**Loop guard:** if the same issue flips back and forth (spec, then code, then spec again), it comes to you instead of looping.

## The Manager

The manager steps in when a session in a hands-off lane asks a question. In Refine, Mockup and Spec you're already in the conversation, so questions there come straight to you.

It works down a ladder:

1. **Is it already answered** by the rulebook, the spec, or your earlier answers on this card or others? Then it answers and notes the source.
2. **Is it really about the spec?** Then it goes to the spec keeper.
3. **Is it minor and invisible to you?** Then the manager decides, and the decision is recorded under "decided for you".
4. **Otherwise it comes to you, prepared:** which card and lane it's from, what's at stake, the session's original options unchanged, and the manager's recommendation.

- **Options are never retyped.** Code passes the session's question and options through as they are. The manager only adds context and a recommendation.
- **One short-lived manager session per question,** so questions never queue and nothing grows all day.
- **It learns:** when you answer a forwarded question, it suggests a rule for the rulebook.
- **It notes what slipped through.** A question during Build usually means the spec review missed something. The manager records that in the Spec lane's history.
- **Everything it does goes into the card's history.**

## Worktrees

- **Ideas have no worktree.** Entering Refine creates one at `<repo>/.claude/worktrees/<card>`, on a branch `hive/<card>` taken from the latest main.
- **Setup starts at once,** in the background while you chat. A setup session picks the local files the app needs from your checkout, such as `.env` files and local databases, and the hive copies them. It installs dependencies, and works out how to start the app and its tests on the card's own ports.
- **Refine reads the code from this clean copy,** never from your own checkout.
- **The number of worktrees is bounded** by the lanes' work-in-progress limits.
- **Mockup versions get worktrees of their own.** The designer builds them one after another. When you pick one, the others are deleted.
- **Each card has its own ports,** so its app runs beside your own copy. When the card leaves Build, Check or Try it, whatever still listens on them from its worktree is stopped.
- **Lanes commit checkpoints freely** on the card's branch. The card shows how far it is behind main, and Build starts by bringing in the latest main.
- **Parking a card** (back to Ideas) removes the worktree but keeps the branch. Moving the card forward again rebuilds the worktree.
- **Dropping a card** removes the worktree and keeps the branch for a while.
- **Deleting a card** is for test cards and dead ideas: it stops everything the card runs, removes its worktree and its branch, and erases the card and its history from the hive. Work that isn't on main is lost, and the page says so before you confirm.

## Ship

Clean history: one commit per card, no merge commits, no branches left behind.

1. **Approve:** you press **Land on main**, and the rest runs without stopping. A rule can turn this step off for a project.
2. Squash the card into one commit on top of the latest main, without touching any working folder. A short session writes the message in the repo's commit style, and the hive ends it with the spec's path and a `Hive-Card:` trailer that links back to the card.
3. Re-run the checks: the tests the worktree's setup found, run on the squash.
4. Push that commit to main. If main has moved since step 1, start again from step 1.
5. Bring your checkout's main up to date, when that's safe.
6. Remove the worktree and the branch.

- **One card ships at a time per project,** so every squash lands on the true latest main.
- **Squashing first** means a conflict is met once, against the finished change, and not again in every checkpoint commit.
- **Conflicts go back to Build,** because resolving one means writing code. The card then passes through Check again and comes straight back to Ship, with no second Try it.
- **Ship never touches your uncommitted work.** Main is pushed without going through your checkout. Your checkout's main is updated only when main isn't checked out there, or it is and you have no uncommitted changes. Otherwise Ship tells you, and in a project with no remote it waits.
- **One base for the whole hive.** With a remote, worktrees, Build's merge and Ship all work from a freshly fetched `origin/main`. Ship refuses while your local main has commits origin lacks: you push them first.
- **Uncommitted work in the card's worktree doesn't land.** Land on main is refused while there is any, and offers to discard it.

## History and Done

**A card keeps every lane's history.** On the card's page, the lane strip takes you back to any lane it has finished: its chat, read-only, next to what the lane produced.

- **Ideas:** the idea, its title and text;
- **Refine:** the chat and the brief;
- **Mockup:** the versions, your comments, and the one you picked, kept as its screenshot;
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

- **Board,** in two layouts, one click apart:
  - **By lane:** lanes by projects. The lane headers show their work-in-progress limits.
  - **By project:** a panel for each project, as many side by side as the screen fits, with no lane columns. Each card shows which lane it's in, and a project's cards stay in lane order, so a card only moves when it changes lane.

  In both, each card in progress shows a badge:
  - ● needs you
  - ▶ working
  - ◆ versions to compare
  - ■ stopped
- **For you:** everything waiting for you, across the whole board, oldest first.
- **Card:** opens on the lane the card is in. The chat sits next to the brief, the mockup or the spec, each half the width. The two halves scroll on their own, and the reply box stays in view. You comment by selecting text in the spec or clicking on the mockup. The lane strip at the top takes you back to any finished lane, read-only.
- **Lane:** the lane's history across all cards.
- **Rulebooks:** read and edit them.
- **Role prompts,** behind the ☰ menu: what each lane's sessions are told. For each role, its instructions and what its sessions get on top of them: the report they end with, and the hive's own tools.

You start an idea with New idea in the header, or by typing its title into a project's Ideas cell or panel, which opens New idea for that project. Closing the page loses nothing: sessions keep running on your machine, and anything waiting for you stays there until you're back. If the hive itself restarts, cut-off work picks up again, and your answers still reach the session that asked.

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
- **Questions reach the host in auto mode too.** `AskUserQuestion` went to the host, and the session used the answer.
- **Auto mode doesn't stop risky actions it reads as your request.** Deleting a folder outside the project, a force push to main and posting `.env` to an address all ran without reaching the host. Taken from a file in the repo instead, the model held back by itself and asked for confirmation in its reply.
- **A chat session can take on the spec keeper's job.** On a later turn it returned a valid fixed-format report, then went back to chatting. Its role instructions stay those of its first turn, so the spec keeper's instructions come with each batch's message.
- **A new worktree needs no trust prompt.** It counts as trusted when a folder above it is. In a folder nobody has trusted, a session runs without the project's CLAUDE.md and doesn't say so, while the repo's hooks still run.
- **Plain `claude -p` is not enough.** Without a host program, sessions can't ask questions, and anything not allowed up front is refused.

Seen in the SDK's type definitions, not yet tested:

- **Your plan's usage** for the 5-hour and 7-day windows.
- **Subagent messages tagged with the agent that started them** (`--forward-subagent-text`).

The spec format is read from `~/.claude/skills/spec-format/` (`format.md` and `review.md`).
