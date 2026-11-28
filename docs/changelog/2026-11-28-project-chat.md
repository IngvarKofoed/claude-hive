# Project chat: talk to a project, then make it an idea

Each project has a chat: a Claude session with no card, running in the project's own folder and reading it as your
checkout holds it. **Make it an idea** drafts a title and text from the talk, and the card you add carries a copy of
the chat, which the product owner reads first in Refine. Built to
`docs/specs/2026-11-28-chat-with-a-project-then-make-it-an-idea.md`.

## Detail
- **Accepted risk: full access in your own checkout.** The chat's `cwd` is `Project.path`, so its session sits in your
  real files with full access. Only its instructions keep it read-only, as for every role. A permission request that
  auto mode passes on is denied, never shown.
- **The chat may describe code that isn't on main:** it reads your branch and uncommitted edits, while the Refine
  worktree is still made from main.
- **Rejected alternatives:**
  - a chat as a hidden kind of card: it would get a branch, a lane and For you entries to filter out, and every card
    query would need a filter. A chat has its own tables, `chats` and `chat_events`.
  - a read-only copy of main, shared per project or one per chat: you chose your own folder as it is, with nothing to
    go stale.
  - a link only, with no copy on the card: deleting the chat would erase where the card came from.
  - drafting through a `draft_idea` hive tool: the session would choose whether to call it. A fixed-format turn
    (`IDEA_DRAFT_SCHEMA`) always gives a draft or a reason.
  - generalizing `Hive.startTurn` to an owner that isn't a card: nearly every line of it is about cards.
    `ProjectChats` drives the session runner itself.
- **A chat's question never reaches For you.** Its ● is on the project's Chat button, and the header's count never
  reads chats.
- **The hive's chats show in Claude Code's own resume list** for the project folder, since they are ordinary sessions
  started there.
- **A chat's cut-off turn isn't resumed:** it gets an error line, and a draft left drafting becomes failed.
- **`GET /api/projects/:id/chats` returns `ProjectChatList`,** the project's name with its chats, since the new-chat
  page has no chat detail to read the name from.
- **Verified with real sessions** on a scratch clone, beside the person's own hive: Explore and carrying on after a
  restart, the ● and its answer, two drafts (the second blocked until the talk held a new problem, then a different
  idea), the product owner's opening, and deleting the chat. Not seen live, only in tests: a restart that cuts off a
  running chat turn or a draft, Stop during a draft turn, and a permission request reaching `canUseTool` (auto mode
  passed none on).
- **A typed idea's look-back at Ideas shows the idea alone,** in the right-hand column, as the live Ideas view does.
  The "Project chat" panel shows only for a card that carries a copy of a chat, so no typed card suggests a chat that
  never existed.
- **The chat page has two columns:** the chat list (about 300px, one compact line per chat) and the chat. The draft
  form opens in the chat column above the reply box and takes at most about half its height. There is no list of
  ideas: each "Made an idea" line links to its card, and turns into plain text once that card is deleted. See the
  Amendments line in `docs/specs/2026-11-28-chat-with-a-project-then-make-it-an-idea.md`.
- **A chat log keeps its bottom when its box shrinks,** even when the browser sends a scroll event before the
  resize, as it did when the draft form opened under the log and hid the reply's last line. The log judges by where
  it was before the shrink. Card chats use the same `ChatLog`, so this holds there too.
- **A short window scrolls the page with a draft open:** at 1280×700 the log keeps its 240px floor at the bottom and
  the form takes about half the column, so the reply box sits below the fold; at 1280×900 everything fits.
