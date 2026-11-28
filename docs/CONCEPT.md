# Claude Hive — Concept

Claude Hive is a kanban board for Claude Code work, in one web page on your machine. An idea goes in as two sentences. You shape it with Claude in conversation: what it is, how it looks, and the spec. Then you let go. Claude plans, builds and checks it on its own, and hands it back for you to try. When you accept it, it lands on main as one clean commit. Every repo you work in is a row on the same board.

## Goals

1. **As much automation as possible, with you in the loop for what's important.**
2. **One overview** of every session, agent and repository.
3. **One window.** Everything happens in one web page. No terminals to juggle.

## Core Idea

Claude's work is cheap and runs in parallel. Your attention is the scarce thing. So the hive puts your attention where it matters most, shaping the idea and trying the result, and runs everything in between without you.

- **The board is the coordinator.** Each lane has a role and plain rules for when a card moves on. No Claude session sits in the middle passing messages between roles.
- **The card carries everything.** Each role reads the card, does its work and writes back. Nothing important lives only inside one session.

## The Board

Lanes are the columns, and projects are the rows (swimlanes). The page can also show the board by project, with the lane written on each card (see The Page).

| Lane | Who | What happens | Moves on when |
| --- | --- | --- | --- |
| **Ideas** | you | You type an idea: a title, and a text of two sentences or so. Or you make it from a project chat (see Project chat). You can edit both until it starts. | You drag it to Refine, or press Start. |
| **Refine** | you ⇄ product owner | A chat until the idea is clear. The product owner has already read the repo and the rulebook, and opens with a draft brief: the problem, who it's for, what done looks like, and what's out of scope. | You say **Good**: on to Mockup, or skip to Spec when there's nothing to show. |
| **Mockup** | you ⇄ designer | A clickable mockup: plain HTML pages the designer makes in the card's own folder, never inside the app, or a mockup you make yourself in Claude Design and paste as a link. You comment by pointing at the screen. A real choice can be built as versions to compare side by side. | You say **Good**, and choose whether to keep the mockup. |
| **Spec** | spec writer, then you | A full spec in the spec format, written in one go from the chats and the mockup. It includes the technical design, worked out by reading the code. A blind review reads it. Its decisions come to you, and its fixes are applied. | You **sign off**. An amendment signs off on its own unless you take over. |
| **Plan** | planner | The build plan the spec deliberately leaves out: the steps in order, which chunk each agent owns, the tests, and how each step is checked. | The plan is written. |
| **Build** | developer | Brings in the latest main first, then builds to the plan. One developer per card, which hands chunks to its own subagents when the spec's Implementation strategy calls for several agents. | It's built. |
| **Check** | reviewer, tester | Read-only. They review the whole branch against main and compare the code with the spec (missing, different, extra). They run the spec's How-to-verify checks and compare the screens with the approved mockup. | Everything passes. |
| **Try it** | you | You test by hand, with the app already running and a test guide ready. | You accept, or give feedback. |
| **Ship** | the hive | Lands the card on main as one commit. | It's on main. |
| **Done** | | The card's full story, kept so you can look back. | |

## Where You Come In

**Refine and Mockup** are back-and-forth chats that go on until you say Good. The agent may say it thinks the card is ready, but only you move it on.

**Spec** is mostly reading. You press **Review** when you think the spec is ready. **Sign off** stays greyed out until a review has run, while it runs, and again if the spec has changed since the review read it. An amendment from Try it is the exception: it signs off on its own unless you write in its chat (see Amendment).

**Try it** is prepared so your testing is quick:

- the app is running on its own port, with test data, started by the hive from the commands the worktree's setup worked out;
- a short test guide, written from the spec's How-to-verify bullets;
- what the automated checks covered, so you don't retest it, and what they couldn't check, so you do;
- every decision made without you, so you can ask for any of them the other way in your feedback;
- any question about a spec change that waits for you, with the spec keeper's recommendation.

Answering a question never moves the card, so you can keep trying it. A **Keep it as built** answer goes to the spec keeper at once, and it changes the spec. A **Change the code** answer is held. When you press **Send back**, the held answers go along with your feedback, to the developer. An answer in your own words counts as Change the code, and the keeper also writes your decision into the spec. Accept waits until every question is answered and no Change the code answer is held.

You press **Send back** with your feedback. The spec keeper reads it, and the hive sends the card on without asking:

| You write | Goes to |
| --- | --- |
| "It crashes when there are no printers" (a bug) | **Build**: the same developer, and the spec stays as it is |
| "The limit should be 32, not 24", "I wanted this per printer", "The slider should be a dropdown" (anything that changes the spec) | **Spec**, as an amendment |

Feedback with both goes to Spec, and its bugs travel with the amendment to the developer. Feedback never goes back to Refine or Mockup: the spec writer already holds your Refine chat and the mockup comments. If the keeper can't read your feedback, the card waits in Try it, and you send it to Build or Spec yourself.

## Lane Actions

A **lane action** is something you can do to a card in a lane: a button that moves it on, sends it back, or gets it going again. Each lane has its own:

| Lane | Lane actions |
| --- | --- |
| **Ideas** | Start |
| **Refine** | Good, Retry, Stop, Park |
| **Mockup** | Good, Pick a version, Park |
| **Spec** | Review, Sign off, Retry, Stop, Park |
| **Plan** | Retry, Back to Spec, Stop, Park |
| **Build** | Retry, Back to Spec, Stop, Park |
| **Check** | Retry, Back to Build, Move on, Back to Spec, Stop, Park |
| **Try it** | Send back, Accept, Retry, Back to Build, Back to Spec, Park |
| **Ship** | Land on main, Discard them and land, Back to Try it, Retry, Back to Build, Stop |
| **Done** | none |

- **Retry, Back to Spec, Back to Build and Move on** come with an error line, when a turn failed or a card stopped, and only on the lane's newest line. **Stop** shows while a turn runs. Discard them and land shows when the card's worktree has uncommitted work.
- **A greyed action says why,** in the same words wherever it shows.
- **The card page and For you offer the same actions.** For you leaves out Try it's, since you test on the card page, and asks before Land on main.
- **Delete and Drop are card controls,** not lane actions: they end the card from any lane. Chatting, answering a question and the app's own controls in Try it aren't lane actions either.

## Hands Off: What Still Reaches You

Between your sign-off and Try it, the hive works without you. Only these reach you:

1. **Questions the manager can't settle** (see The Manager). They come with its recommendation.
2. **Spec issues that change what you signed off.** They come with the spec keeper's recommendation. The card goes on to Try it as built, and the question waits for you there.
3. **Severe issues.** The card stops.
4. **Loops:** an issue that comes back after the keeper settled it, a third round of code fixes from the keeper, or Check sending a card back to Build more times than the round limit.
5. **Approvals:** pushing to main.

Everything else is decided by the hive and written into the card's history as "decided for you". Try it lists these decisions. If you want one the other way, you say so in your feedback, like any other change.

## Key Concepts

### Project

A repository, added by its top folder; the Project path field completes folder names as you type. An empty or new folder, or a fresh `git init` with no commits, becomes a repo with an empty first commit on `main`, and the hive asks before it creates a folder. A folder with files that isn't a repo is refused, and so is a folder inside a repo or a worktree. Each project is a swimlane on the board and has its own rulebook.

### Project chat

A conversation with Claude about a project, before any idea exists. It has no card and no lane. Claude reads the project's code, docs and git history as your checkout holds them, and changes nothing. When the talk has turned into something, **Make it an idea** asks the chat for a draft title and text. You edit them and add the card to the project's Ideas cell, and the chat goes on and can make more ideas. A question the chat asks you puts a ● on the project's Chat button and never reaches For you. Chats are kept per project and can be deleted.

### Card

One feature, from idea to Done. It carries everything:

- the chat it came from, as a copy, when it began as a project chat;
- the brief;
- the mockup versions;
- the spec;
- the plan;
- issues and their verdicts;
- the decisions made for you;
- the check rounds, your feedback rounds and the amendments they started;
- every lane's history, reached from the lane strip on its page.

### Role

Each lane's instructions and model. Every session has the same full access, in Claude Code's auto mode. The instructions tell each session its role and whether it may change code, and for now nothing else enforces that:

- **Reviewer and tester** don't change files.
- **The spec writer** edits only the spec.
- **Refine** doesn't change the repo at all. The brief lives on the card.

### Sessions

- **A new session for each card in each lane,** started with the role's instructions and the card.
- **One session for each project chat,** resumed on every message.
- **Conversations continue the same session.** A card sent back to Spec resumes the spec writer that wrote its spec. A card sent back to Build resumes the developer that built it.
- **Nothing runs between turns.** A kept session costs nothing.

### Amendment

A change to a signed-off spec, made from your Try it feedback. It's a numbered round, Amendment 1, 2 and so on, that the card carries through Spec, Plan, Build, Check and Try it, and each role handles just that change:

- **Spec:** the spec writer changes only what the amendment needs, and adds a line to `## Amendments`. It decides whether the change needs the blind review, and a review it asks for runs by itself.
- **Sign-off:** the amendment signs off on its own once the spec writer's turns end. Answering its questions doesn't change that. Writing in the Spec chat yourself does: from then on Sign off is yours.
- **Plan:** the planner plans only what's left to build, from the spec's diff since the amendment started.
- **Build and Check:** the same developer builds it, together with any bugs from the same feedback. Check's reviewer and the spec keeper know what you asked for in Try it, so a change you asked for is written into the spec and never undone as a mismatch.

An amendment stays open until the card is back in Try it, and a Back to Spec on the way is part of it. Only Send back makes one: Back to Spec from a blocked plan or build outside an amendment is a full revision, with your sign-off.

### Rulebook

What the hive knows about how you want things. Each project has one, plus one shared by all projects.

- **Choices you make become rules,** in plain words: *"flux: printer settings live in Preferences"*.
- **You can write rules yourself, both ways:** rules that decide (*"use the existing button styles"*) and rules that make the hive ask (*"always ask before adding a library"*).
- **Every session reads its project's rulebook first.**

## Mockups

- **A mockup is plain HTML pages,** with their CSS and scripts, in the card's own folder, `docs/mockups/<card>/`. The designer makes them, copying the app's look, and edits them in place as you comment. It never builds the mockup inside the app, and changes no app code. The hive serves the pages itself, sandboxed, and the card links to them.
- **Or you use Claude Design** on claude.ai yourself. The designer writes a starting prompt when you ask, and you paste the link back. No session can open it, so the designer asks for exported files or a description of the screens, and sums up the look in the chat for the spec writer.
- **Good keeps the mockup, or doesn't.** Keep commits the folder on the card's branch, so the mockup lands on main with the card, at `docs/mockups/<card>/`. A Claude Design mockup is kept as a `README.md` with its link, beside any exported files. Don't keep leaves nothing on the branch: the pages stay in the worktree for the spec writer to read, and sign-off deletes them. Until then, **Keep it after all** in Spec still commits them.
- **The approved mockup is the visual reference.** The tester compares the finished screens with it. Where an amendment changes the look, the spec's words win over the mockup.

## Spec Issues During the Build

The builder, reviewer and tester find mismatches between spec and code:

- the spec is silent, unclear or contradicts itself;
- what the spec asks for doesn't fit the code as it really is;
- something is missing, done differently, or added without being asked for;
- a How-to-verify check fails, or can't be carried out as written.

**Only what would change something is an issue.** Report it only if the spec keeper would change the spec or the code after reading it. Wording and naming, a gap filled the obvious way, and anything that isn't about the spec (a lint error already on main, a test that fails only in the worktree, a local environment problem) go in the report's summary, not on the card.

Each becomes an issue on the card. **The build doesn't stop for them.** The builder notes the issue, makes its best guess and keeps going. Issues from Build and Check collect on the card and are judged together, in one batch once Check passes. Only a blocking issue is judged immediately.

**The spec keeper judges.** It is the spec writer's own session, which carries on after sign-off. It holds your Refine chat, your Mockup comments, the code research and the spec's reasoning. Each batch of issues is a new turn in it: it re-reads the current code, and it remembers its earlier verdicts, so its calls stay consistent. It can't ask questions during a turn: what needs you goes into its verdict.

Each issue gets a verdict:

- **The spec is wrong:** the spec is updated, and the code stays as it is.
- **The code is wrong:** the same developer fixes it, the way it fixes Check's bugs, and Check starts again.
- **Neither changes:** nothing is edited. An example is a lint error that was already on main.

Every change the keeper makes to the spec edits the body so it reads true, and adds a dated line to an `## Amendments` section at the end of the spec. The hive commits the spec file on its own.

Each issue also gets a level:

| Level | Example | What happens |
| --- | --- | --- |
| **Minor** | The spec was silent about the order of a list | The spec keeper decides on its own. |
| **Changes what you signed off** | It touches the Outcome, a Key decision tagged (new), (diverges) or (breaking), or something you'd see | A question to you, with the spec keeper's verdict as its recommendation: keep it as built, or change the code. The card goes on to Try it as built, and the question waits there. |
| **Severe** | The approach doesn't work in this codebase, the feature clashes with another part of the product, a security or data risk turns up, the work is far bigger than the spec assumed, or the idea itself looks flawed | **The card stops** and comes to you. It shows what was found, why it matters, the options (redesign → Spec, rethink → Refine, narrow the scope, drop it) and a recommendation. **Move on** takes the card to Try it as built, with the severe issue and the batch's code fixes as questions. |

**A batch with mixed results:** spec fixes are made at once. If any issue needs a code fix, the card goes to Build with all of them in one message, and Check starts again. Questions for you wait in Try it.

**Loop guard:** the keeper marks an issue that is the same problem as an earlier one. Any repeat comes to you as a question, whatever its verdict, since the first fix didn't take. Code fixes are also capped at two keeper fix rounds since sign-off. After that they come to you as questions.

**A blocked build:** the first time the developer reports it's blocked in a Build visit, the keeper judges the block at once. If it's about the spec, the keeper settles it and the developer carries on, or it comes to you right then, on the card in Build. A block that isn't about the spec, or a second block in the same visit, stops the card with Retry and Back to Spec.

**A keeper that fails:** a failed keeper turn offers Retry. In Check it also offers **Move on**, which takes the card to Try it with its issues marked "Not judged".

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

- **Ideas have no worktree,** and neither has a project chat. A chat runs in the project's own folder, the one session that does, and only its instructions keep it from changing anything.
- **Entering Refine creates a worktree,** at `<repo>/.claude/worktrees/<card>`, on a branch `hive/<card>` taken from the latest main.
- **Setup starts at once,** in the background while you chat. A setup session picks the local files the app needs from your checkout, such as `.env` files and local databases, and the hive copies them. It installs dependencies, and works out how to start the app and its tests on the card's own ports.
- **Refine reads the code from this clean copy,** never from your own checkout.
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
- **Plan:** the plan;
- **Build:** what was built, and where it departed from the plan and why;
- **Check:** each round's findings;
- **Try it:** your feedback rounds, and the amendments they started.

It also shows every judgment, manager action and "decided for you", the time spent in each lane, and the commit the card landed as.

**A lane has a history across all cards.** For example, the Plan lane shows every plan next to what actually happened: *"planned 3 chunks, built in 5 rounds, 2 departures"*. Over time this shows which role needs better instructions.

**Done cards can be searched,** by a word or from a commit through its `Hive-Card:` trailer.

**Sessions are archived when a card reaches Done,** because Claude Code deletes old session files after a while.

## The Page

One page, with several views:

- **Board,** in two layouts, one click apart:
  - **By lane:** lanes by projects. A **Compact** switch fits it to a smaller screen: the lanes share the window's width, the tiles get smaller, and Done becomes a count that opens the landed cards.
  - **By project:** a panel for each project, as many side by side as the screen fits, with no lane columns. Each card shows which lane it's in, and a project's cards stay in lane order, so a card only moves when it changes lane.

  In both, each card in progress shows a badge:
  - ● needs you
  - ▶ working
  - ◆ versions to compare
  - ■ stopped
- **For you:** everything waiting for you, across the whole board, oldest first. Each entry offers its lane's actions (see Lane Actions), except a card in Try it, which you test on the card page. A card you open from an entry takes you back to For you after any of its lane actions but Stop, so the next thing waiting is one glance away.
- **Card:** opens on the lane the card is in. The chat sits next to what that lane is producing (the brief, the mockup, the spec, or the developer's checklist), each half the width, with what sent the card back to the lane on top. The two halves scroll on their own, and the reply box stays in view. You comment by selecting text in the spec or clicking on the mockup. The lane strip at the top takes you back to any finished lane, read-only.
- **Lane:** the lane's history across all cards.
- **Project chat:** a Chat button on each project's heading opens the project's chats in a list, with the open chat beside it, a new chat, and Delete. **Make it an idea** fills a title and text for you to edit and add. A card made this way shows its chat in Ideas, with a link back, and the product owner reads it first in Refine.
- **Rulebooks:** read and edit them.
- **Role prompts,** behind the ☰ menu: what each lane's sessions are told. For each role, its instructions and what its sessions get on top of them: the report they end with, and the hive's own tools.

You start an idea with New idea in the header, or by typing its title into a project's Ideas cell or panel, which opens New idea for that project. Closing the page loses nothing: sessions keep running on your machine, and anything waiting for you stays there until you're back. If the hive itself restarts, cut-off work picks up again, and your answers still reach the session that asked.

## A Card's Journey

1. **Ideas.** In flux you type: *"The printer font is too small for some users. Make it adjustable."*
2. **Refine.** The product owner opens with a draft brief and asks: per printer, or for all printers? You answer per printer. After three rounds you say Good.
3. **Mockup.** Two versions: a slider in the print dialog, and a field in the printer settings. You click B's field and write *"max 24"*, then say Good.
4. **Spec.** The spec is written in one go. The review flags one decision: what should existing printers get? You pick 12, then sign off.
5. **Plan, Build and Check** run on their own.
   - Build finds that the settings table has no per-printer column. The spec keeper judges it minor, updates the spec and adds a line to its Amendments.
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

Tested on 2026-11-28, same versions:

- **An SDK session has no task-list tools by default.** Neither `TodoWrite` nor `TaskCreate` was there, and the `todoFeatureEnabled` setting didn't change that. `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` in the session's environment adds `TaskCreate`, `TaskUpdate`, `TaskList` and `TaskGet` and keeps the default tools. Naming them in `tools` works too, but replaces the default set. `TodoWrite` isn't in this version at all.

Seen in the SDK's type definitions, not yet tested:

- **Your plan's usage** for the 5-hour and 7-day windows.
- **Subagent messages tagged with the agent that started them** (`--forward-subagent-text`).

The spec format is read from `~/.claude/skills/spec-format/` (`format.md` and `review.md`).
