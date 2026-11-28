# Chat with a project, then make it an idea

Each project gets a chat. It's a Claude session with no card behind it, running in the project's own folder and
reading its code, docs and git history as your checkout holds them, so you can explore before an idea exists. When
the talk has turned into something, **Make it an idea** asks the chat's own session for a draft title and text.
You edit them and add the card to the project's Ideas cell. The card carries a copy of the chat so far, and the
product owner reads it first when the card enters Refine. Chats are their own small part of the backend, with their
own tables, turn loop and page, because everything about cards is keyed on a card and its lane.

## Outcome

**What you get:**

- **A Chat button on every project heading,** in both board layouts. It opens the project's chat page: the
  project's chats in a list, the open chat beside it, a new chat, and Delete for each chat.
- **A chat reads the project and changes nothing.** It runs in the project's own folder and reads your checkout as
  it is, whatever branch and edits it holds. A chat that asks you something puts a ● on the project's Chat button
  and stays out of For you.
- **Make it an idea:** Claude drafts a title and text from the talk so far. You edit them and press Add, and the
  card lands in the project's Ideas cell. The chat goes on, and can make more ideas.
- **Refine starts informed.** The card shows the chat it came from, with a link back. A new product owner reads
  that chat before it opens with its draft brief.

**How to verify:**

- **Explore:** press Chat on a project and ask "How does a card move from Build to Check?". The reply names real
  files, and `git status` in your own checkout shows nothing new. Restart the hive, reopen the chat from the list,
  and carry on: the next reply knows the earlier talk.
- **The ●:** ask the chat to ask you which part you want explained. The project's Chat button shows ●, and the For
  you count doesn't change. Answering clears the ●.
- **Make it an idea:** press it. The form fills with a drafted title and text. Edit the title and press Add. The
  card is in the project's Ideas cell, and its page shows the chat on the left with a link back to it. The chat's
  "Made an idea" line links to the card, and once that card is deleted, the line shows as plain text. Press Make
  it an idea again after more talk: the new draft is a different idea, and the chat still answers.
- **Into Refine:** start that card. The product owner's opening refers to what the chat settled and doesn't ask it
  again. Delete the chat: the card still shows its copy.

## Key decisions

- **A chat is not a card** (new). It has its own tables, `chats` and `chat_events`, and its own module,
  `packages/backend/src/chats/`. Nothing in the board engine, lanes, lane actions or For you knows about it. Every
  card table (`sessions`, `events`, `pending_items`) has `card_id NOT NULL`, and `Hive.startTurn` is built around
  lanes, the keeper, setup timers and delete marks. Hiding chats in a lane would drag all of that along.
- **Its own small turn loop** (new; mirrors `Hive.startTurn` and `deliver`). `ProjectChats` drives the existing
  `SessionRunner` directly:
  - one session per chat, resumed on every message;
  - a message sent mid-turn joins the turn;
  - `AskUserQuestion` goes to the chat page;
  - Stop interrupts the turn.

  Rejected: generalizing `Hive.startTurn` to an owner that isn't a card. Nearly every line of it is about cards.
- **A chat runs in the project's own folder** (diverges from the brief's "never your own checkout", and from every
  other session, which works in a card's worktree). Its `cwd` is `Project.path`, so it reads your checkout exactly
  as it is: the branch it's on and any uncommitted edits. You chose this over a copy of main: it has no copy, no
  fetch and nothing to go stale.
  - The accepted risk: the session sits in your real files with full access. Only its instructions keep it
    read-only, and a permission request is denied (below).
  - The chat may describe code that isn't on main yet. The Refine worktree is still made from main.
- **The draft is a fixed-format turn in the chat's own session** (reuses the spec keeper pattern). The instructions
  live in `roles/idea-draft.md` and ride at the top of each draft message. `ROLE_TURNS["idea-draft"]` holds the
  report, `IDEA_DRAFT_SCHEMA`, so the Role prompts page shows it. The turn is quiet: nothing it writes goes into
  the chat. The draft is stored on the chat's row, so a reload or a closed page keeps it.
  - A later fixed-format turn in a conversation session works; this was tested for the spec keeper (CONCEPT.md,
    Feasibility Notes).
- **The card carries a copy of the chat** (extends the lane chats). On Add, the chat's messages so far are copied
  into the card's history as `chat` rows with `lane: "ideas"`, and `cards.chat_id` links back to the chat.
  - The card page then shows the copy through what exists already: `detail.chat` in Ideas, `pastChats.ideas` in
    the look-back, and `PastChat`.
  - Refine's first message includes the copy, the way the spec writer's first message includes the Refine chat.
  - Deleting the chat leaves the copy, as CONCEPT's "the card carries everything" asks.
- **The ● comes from chat summaries on the board** (extends `BoardResponse` and the SSE stream).
  `BoardResponse.chats` lists each chat's summary, and the `projectChat.updated` and `projectChat.deleted` events
  keep the list current. A project's Chat button shows ● when one of its chats is `asking`. For you and the
  header's count never read chats.
- **The chat page reuses the card chat's parts** (extends). The log goes from `Chat.tsx` into a `ChatLog` component
  that both use: the bubbles, the streaming text, the activity and thinking line, follow-the-bottom scrolling, and
  `PendingCard`. `PendingCard` gets an `answer` function prop, with today's `api.answer` as the default.
- **Two new roles, `project-chat` and `idea-draft`** (new). The chat is Opus, of kind conversation. It's read-only
  by its instructions alone, like every role (`docs/CLAUDE_TODO.md`, "Roles are enforced only by their
  instructions"). A permission request that auto mode passes on is denied, not shown, since a chat never needs to
  change anything.

## Goals

- **Explore before you commit:** ask the project questions and let an idea take shape, without leaving the hive.
- **Keep the talk:** the chat stays reopenable, and the card that comes out of it carries it into Refine.

## Non-goals

- Chats that change code, run commands or run the app.
- The chat session carrying on as the card's product owner. Refine still starts a fresh session.
- Chats in For you, or one chat spanning several projects.
- The chat proposing ideas on its own. It drafts only when you press Make it an idea.
- Renaming a chat, or searching chats.

## Design

### Data

New tables, created in `SCHEMA` in `packages/backend/src/db/index.ts`:

| Table | Fields |
| --- | --- |
| `chats` | id, project_id, title, session_id (chosen by the hive, as for cards), exists_yet, turn_running, last_message, pending (the open question as a `PendingItem`, or null), draft (an `IdeaDraft`, or null), created_at, updated_at |
| `chat_events` | id, chat_id, at, type (`chat` or `error`), data: the same shape as a card's chat rows, minus the lane |

- **Card:** one added column, `cards.chat_id`. It's null for a typed idea, and set to null when the chat is deleted.
- **A chat's session lives on its row,** because a chat has one session for its whole life.
- **The title** is the first message's first sentence, from `titleFromIdea`. It's fixed.
- **`updated_at`** moves with every message, and the list sorts on it, newest first.

Shared types in `packages/shared/src/index.ts`:

- `ProjectChatSummary` { id, projectId, title, state: `idle` | `working` | `asking`, updatedAt };
- `ProjectChatDetail`: the summary, plus projectName, chat (`ChatItem[]`), pending, turnRunning and draft;
- a `message` `ChatItem` gains an optional `cardId`, set only on a "Made an idea" note, which the page shows as a
  link to that card. The id stays in the note's row for good, but `ProjectChatDetail` leaves `cardId` off a note
  whose card no longer exists, because a deleted card is gone. That line then shows as plain text, not a dead link;
- `IdeaDraft` { status: `drafting` | `ready` | `failed`, title, text, reason };
- `ChatAuthor` gains `"project-chat"`, labelled "Claude";
- `NewCardBody` gains an optional `chatId`;
- `CardDetail` gains `fromChat: { id, title } | null`.

### Where the chat runs

- **`cwd` is `Project.path`,** the folder you added. Nothing happens in git before a turn: there's no fetch and no
  copy, and nothing to set up or clean up.
- **`roles/project-chat.md` tells the session where it is:** in the person's own checkout, which may be on any
  branch and hold uncommitted edits.
  - It says so when an answer depends on that, for example code that isn't on main.
  - It never changes a file, and never runs anything that does, git included.
- **Claude Code files each session under the folder it ran in.** So the hive's chats also show up in Claude Code's
  own resume list when you run `claude` in the project folder. That's harmless, and noted here so it isn't a
  surprise.

### Turns

`ProjectChats` (`packages/backend/src/chats/index.ts`) is built in `server.ts` next to `Hive`, from the same `db`,
`hub`, `runner` and `role`. Each turn calls `runner.start` with these settings:

- the project's folder as `cwd`;
- the `project-chat` role;
- `resume` from `exists_yet`;
- no hive tools;
- no `outputFormat`, except on draft turns.

The handlers do what a chat lane's do:

- text deltas go out as `projectChat.delta`;
- finished text blocks become `chat_events` rows and `projectChat.message`;
- tool lines go out as `projectChat.activity`;
- an error ends in an error line with no actions.

- **First message:** `POST /api/projects/:id/chats { text }` creates the row, stores your message and starts the
  first turn: "A chat about the project `<name>`. The person's message: …". The response is the new chat's
  summary, and the page moves to the new chat's URL.
- **Later messages:**
  - a message joins the running turn, waits as a follow-up if that turn is already ending, or starts a new turn;
  - a message sent while a question waits answers the question instead, as on a card.
- **Questions:** `canUseTool` catches them.
  - `AskUserQuestion` stores the question on the row's `pending`, sets the state to `asking` and waits.
  - The answer goes to `POST /api/chats/:id/answer`. If the turn that asked is gone, the answer goes to the session
    as a message, through the existing `answerAsMessage`.
  - A draft turn denies `AskUserQuestion` ("Draft from what you have; leave open points in the text"), and so does
    any permission request ("A project chat doesn't change anything").
- **One turn at a time per chat.** Chats of the same project run in parallel.

### Make it an idea

- **Where it is:** the button sits at the end of the Send row, where Refine has Good.
- **When it's on:** the chat has at least one reply, no turn runs, no question waits, and no draft form is open.
  Otherwise it's greyed out, with one of these reasons: "Say something first", "Wait for Claude to finish",
  "Answer the question first", "Add or cancel the idea first".
- **`POST /api/chats/:id/draft`** sets `draft = { status: "drafting" }` and starts a quiet draft turn. Its message
  holds:
  - the instructions from `roles/idea-draft.md`;
  - the titles of ideas already made from this chat;
  - the ask.

  `IDEA_DRAFT_SCHEMA` is `{ status: "done" | "blocked", reason, title, text }`.
- **`roles/idea-draft.md`** asks for:
  - a short card title;
  - a few sentences of text: the problem and what to do, in the person's words where it can;
  - not a brief and not a spec;
  - an idea other than the ones already made, unless the talk asks for one of them again;
  - `blocked`, with the reason, when the chat holds no idea yet.
- **When the turn ends:**
  - `done` gives `{ status: "ready", title, text }`;
  - `blocked`, a missing report or an error gives `{ status: "failed", reason }`, and the form opens empty with the
    reason above it, so you can still write the idea yourself;
  - Stop clears the draft.

  Each change goes out as `projectChat.updated`, and the page refetches the chat.
- **Add** sends `POST /api/cards { projectId, title, text, chatId }`. **Cancel** sends `DELETE
  /api/chats/:id/draft`. Both close the form.
- **The reply box** is closed while a draft turn runs, with "Claude is drafting the idea". Once the draft is ready,
  you can chat while the form stays open.
- **The server guards both, not only the page.** A second tab or a race with the button mustn't reach a quiet,
  fixed-format turn.
  - `POST /api/chats/:id/messages` returns 409 while the draft is `drafting`: "Claude is drafting the idea".
  - `POST /api/chats/:id/draft` returns 409 with the same reasons the greyed button shows: no reply yet, a turn
    runs, a question waits, or a draft is open.

### Into the card, and into Refine

`Hive.createCard` takes the optional `chatId`. The chat must exist and belong to the project: otherwise 404 or
409. In one transaction it:

1. inserts the card with `chat_id`;
2. copies the chat's messages from you and from Claude, never notes or error lines, as card `chat` rows with
   `lane: "ideas"`. Each copy keeps its original `at` and gets a new id;
3. clears the chat's draft.

After the transaction, the chat gets a note, "Made an idea: <title>.", and `projectChat.updated` goes out. The
note's row stores the new card's id, and the chat page links the note to that card.

- **Refine's first message:** `refineFirstMessage` gets the Ideas chat. When it has any, the message adds "Before
  it was a card, this idea came out of a chat with the project. Read it first, and don't ask again what it already
  settles. The chat may cover other ideas too: this card is only the title and idea above, and the rest is
  background.", then the copy as `you:` and `claude:` lines. That's the same shape `specFirstMessage` gives the
  Refine chat.
- **The card page:**
  - **In Ideas,** the empty left column shows a "Project chat" panel with `PastChat` of the copy, and "Open the
    chat" when `fromChat` is set.
  - **In the look-back,** `PAST_CHAT_TITLE.ideas` is "Project chat".
  - A typed idea shows no left panel, as today.

### The page

- **Routes:** `/projects/:projectId/chat` for a new chat, and `/projects/:projectId/chat/:chatId` for an existing
  one.
- **Chat button:** `ProjectHeading` gets it, so both board layouts have it.
  - It opens the chat that's asking you, if there is one. Otherwise it opens a new chat.
  - It shows ● when any of the project's chats is `asking`, with the label "Chat, a question waits".
  - `Board` keeps `chats` from `BoardResponse` and applies `projectChat.*` events to it.
- **Layout:** the shared header and a top band with the project's name, then two columns.
  - **The top band** holds only the project's name, as the page's title, the same size as the Board and For you
    titles. There's no breadcrumb, Board link or "Project chat" label: the header already leads back to the board.
  - **Chats:** the left column, about 300px wide (`--chat-list-width`, up from 240px). Its title line holds "Chats"
    on the left and a small New chat button aligned right, on the same line.
    - Each chat is one compact line: its title cut short with an ellipsis (the full title on hover), how long ago
      it was last active, ● when it's asking, and a small Delete control at the end of the line.
    - Delete asks inline, under the line: "Delete this chat? Ideas made from it keep their copy."
  - **Chat:** the rest of the width. It holds `ChatLog`, the reply box, Stop while a turn runs, and Make it an idea.
    In a new chat, the empty log says "Ask about the project's code, docs or history."
    - **The draft form** opens in this column, between the log and the reply box: Title, Idea, Add, Cancel, and
      "Drafting…" while the turn runs. The log gets shorter while it's open, and Add or Cancel closes it. The form
      takes at most about half the column's height, and the Idea field scrolls inside it. So the log always keeps
      room for the latest reply, even with a long draft or a short window.
    - **There's no list of ideas.** Each idea made from the chat leaves its "Made an idea: <title>." line in the
      chat, and that line links to the card.
- **Live updates:** `useProjectChatLive(chatId)` follows `useCardLive`. It subscribes, then fetches, buffers in
  between, and refetches when the stream opens.
- **Styling:** CSS Modules on tokens only, with no inline styles, per `docs/ARCHITECTURE.md`, Frontend.

### API and events

```
GET    /api/projects/:id/chats        The project's chats, newest first
POST   /api/projects/:id/chats        New chat with its first message { text }
GET    /api/chats/:id                 ProjectChatDetail
POST   /api/chats/:id/messages        { text }
POST   /api/chats/:id/answer          { itemId, answers }
POST   /api/chats/:id/stop
POST   /api/chats/:id/draft           Start a draft turn
DELETE /api/chats/:id/draft           Close the draft
DELETE /api/chats/:id                 Delete the chat
POST   /api/cards                     gains chatId
```

The events are `projectChat.updated { chat }`, `projectChat.deleted { chatId }`, `projectChat.delta`,
`projectChat.message`, `projectChat.activity` and `projectChat.pending`. The last four mirror the `chat.*` events,
keyed on `chatId`.

### Restart, Stop and delete

- **Restart:** a chat marked `turn_running` is cleared and gets an error line: "The last reply was cut off when the
  hive stopped. Send a message to carry on." It isn't resumed, the same as a chat lane.
  - A draft left `drafting` becomes `failed`: "The hive stopped while drafting. Press Make it an idea again."
  - A waiting question stays, and its answer goes as a message.
- **Delete:**
  1. The running turn is interrupted, and the delete doesn't wait for it.
  2. The waiter is dropped.
  3. One transaction deletes the chat's events and its row, and sets `cards.chat_id` to null.
  4. `projectChat.deleted` goes out.

  The late end of an interrupted turn finds no row and stands down. Claude Code's own transcript is left for Claude
  Code to clean up.

### Docs updated in the same change

- **CONCEPT.md:**
  - Ideas: an idea can also come from a project chat.
  - Key Concepts gets a "Project chat" entry.
  - Card: it carries the chat it came from.
  - Sessions: one for each project chat.
  - Worktrees: a project chat has none. It runs in the project's own folder, the one session that does.
  - The Page gets a "Project chat" view.
- **ARCHITECTURE.md:**
  - The page list and parts table get Project chats.
  - Project Structure gets `chats/`.
  - Roles get `project-chat` and `idea-draft`.
  - Sessions: chats are conversations, run in the project's folder.
  - Questions and Permissions: chat questions go to their page, and permission requests are denied.
  - Restarts: a chat's cut-off turn isn't resumed.
  - Data Model gets Chat, ChatEvent and `Card.chatId`. The ChatEvent row says a "Made an idea" note's data holds
    the card's id.
  - API gets the new endpoints. The line for `GET /api/chats/:id` no longer says "and the ideas made from it".
- **Changelog:** an entry, `docs/changelog/2026-11-28-project-chat.md`.

## Open questions

- **Q:** What does the Chat button open when no chat is asking: a new chat, or the most recent one?
  **Default:** a new chat. The list beside it reopens the last one in one click, and a fresh question shouldn't
  land in an old thread.
- **Q:** Should a long chat be cut short before it goes into Refine's first message? **Default:** no. Send it
  whole, as the spec writer gets the whole Refine chat. Revisit if a chat ever pushes the first turn near the
  context limit.

## Alternatives considered

- **A chat as a hidden kind of card.** It would get a branch, a lane and For you entries it must then be kept out
  of, and every card query would need a filter. Rejected for a separate table.
- **A read-only copy of the latest main,** either shared per project or one per chat. The review's options for a
  shared copy were: a waiting turn doesn't hold it, a note when it's held, or ending the turn on a question. You
  chose the project folder as is: no copy, no fetch, and nothing to go stale.
- **A link only, no copy on the card.** Deleting the chat would erase where the card came from, which breaks "the
  card carries everything".
- **Drafting through a hive tool (`draft_idea`).** The session would choose whether to call it. A fixed-format turn
  always yields a draft or a reason.
- **The chat session carrying on as the product owner.** It's out of scope in the brief. Refine starts fresh.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: the lead plus 2 chunks.** The lead (Opus 5.5) first settles the shared types and events in
  `packages/shared/src/index.ts`. Then it builds the backend: the tables in `db/`, the `chats/` module with its turns and draft turn, `Hive.createCard`'s copy, `refineFirstMessage`, the
  routes, both role files and the backend tests.
- **Once the types are settled, in parallel:**
  - **Frontend (Sonnet 5.5):** `ChatLog` out of `Chat.tsx`, the `PendingCard` answer prop, the chat page and
    `useProjectChatLive`, the Chat button with ● in `ProjectHeading` and `Board`, the Ideas-lane chat panel on
    `pages/Card.tsx`, the client calls, and their tests.
  - **Docs (Sonnet 5.5):** the CONCEPT.md and ARCHITECTURE.md edits listed above, and the changelog entry.
- The lead runs the integration pass and the How-to-verify checks at the end.

## Amendments

- 2026-11-28: The chat page has two columns, not three: the Ideas column and its list of ideas are gone, the draft form opens in the chat column above the reply box, each "Made an idea" line links to its card (a note's optional `cardId`; `ProjectChatDetail.ideas` dropped), and the chats list is wider with one compact line per chat. The person found the right column mostly empty space and the chat entries too tall. After review, three follow-ons: a note whose card was deleted gets no `cardId` and shows as plain text; the draft form takes at most about half the column's height; and ARCHITECTURE.md's `GET /api/chats/:id` line and ChatEvent row get matching updates.
- 2026-11-28: The chat page's top band holds only the project's name, the size of the Board and For you titles, with no breadcrumb, Board link or "Project chat" label. The person asked for it in Try it, and the spec now records it so the breadcrumb doesn't come back.
- 2026-11-28: The chats column's title line holds "Chats" and a small New chat button aligned right, on one line. The person asked for it in Try it, and "New chat at the top" didn't say so.
