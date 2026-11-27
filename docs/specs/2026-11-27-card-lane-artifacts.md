# Card page: look back at finished lanes, and ideas with a title

The lane strip at the top of the card page becomes the way back. Click a finished lane (✓ Ideas, ✓ Refine and so on)
and the page shows that lane as it ended: its chat on the left, read-only, and what it produced on the right. For
Ideas that's the idea, for Refine the brief, for Spec the spec. An idea is now typed as a title and a text, and the
text is the Ideas lane's artifact. The page's two columns become equal width in every lane. This slice defines the
artifacts of Ideas, Refine and Mockup properly. Every later lane can already be looked back at, but only lightly: its
chat, plus the panel the page already has for it.

## Outcome

**What you get:**

- **A title and a text for every idea.** New idea asks for both. The board's one-line field opens New idea with its
  project chosen and what you typed as the title. While the card is in Ideas, its page lets you edit both and press
  Start.
- **Finished lanes one click away.** On any card, each ✓ lane in the strip is a link. It shows that lane's chat with
  nothing to type into or press, next to what the lane produced. A line above says you're looking back, with a link to
  the current lane.
- **The brief from anywhere after Refine:** click ✓ Refine from Spec, Plan, Build, Check, Try it, Ship or Done.
- **Equal columns:** the chat and the panel beside it are the same width in every lane.

**How to verify:**

- **Title and text:** add an idea with New idea, giving a title and two sentences. The tile shows the title. Open the
  card: the title and the text are there to edit. Change the text, press Save, reload: the change is kept.
- **The board's field:** type "Bigger font" in a project's Ideas field and press Enter. New idea opens with that
  project and "Bigger font" as the title, with the cursor in the text. Add stays disabled until the text has something.
- **Start from the card:** press Start on the card page. The card moves to Refine, and the product owner's first reply
  shows it read both the title and the text.
- **Looking back:** on a card in Spec, click ✓ Refine. The left shows the product owner chat with no reply box, Stop or
  Retry. The right shows the brief. The URL ends in `?lane=refine`, and reloading keeps you there. "Back to Spec"
  returns to the spec writer chat.
- **What isn't clickable:** Mockup shows as skipped. The current lane and the lanes after it are not links, except
  that the current lane brings you back when you're looking back.

## Key decisions

- **The lane strip navigates** (extends `LaneSteps`). Past lanes become links to `/cards/:id?lane=<lane>`, and the
  current lane links to `/cards/:id`. The lane you're looking at is marked `data-viewing` in the CSS and
  `aria-current="page"` on its link. The current lane keeps `aria-current="step"`. Lanes after the current one stay
  plain text. Having the lane in the URL means Back, reload and a pasted link all work. The `compact` strip on board
  tiles doesn't change.
- **"Past" means before the current lane in `LANES` order** (new). There are no lane-visit records, so order is the
  only signal. A card that Check sent back to Build doesn't count Check as past, and Build's right column already shows
  what Check found. Mockup is the exception: no card can reach it yet, so a past Mockup is `data-status="skipped"`.
  It shows "– Mockup" in place of "✓ Mockup", in the colors of a lane not reached yet, and isn't a link.
- **A past view is its own component, never the live one disabled** (new). `PastLaneView` is built only from the
  display components: `Chat` read-only, `IdeaView`, `BriefPanel`, `SpecView`, `PlanView`, `BuildView`, `CheckView`
  and `DonePanel`. It never renders `GoodBar`, `ReviewBar`, `TryItPanel`, `ShipPanel` or a reply box. That's what keeps
  a past view read-only: the buttons aren't there to press.
- **Past chats come with the card** (extends `GET /api/cards/:id`). `CardDetail` gains
  `pastChats: Partial<Record<Lane, ChatItem[]>>`: the chat of every lane before the current one that has any. The
  existing `chat` field stays the current lane's, and live events still only touch it. `ARCHITECTURE.md` already
  describes this route as "the card with every lane's history". A card's chats are small, and the card is fetched
  again only when its lane changes or the stream reconnects.
- **An idea has its own title** (new: `Card.ideaTitle`). `POST /api/cards` takes `{ projectId, title, text }`, and
  both are required (400 otherwise). `card.title` starts as the idea's title, and the brief's title still replaces it
  in Refine, as today: the brief's title is written to be the sharper name. `ideaTitle` keeps what you typed, for the
  Ideas view. The column list in `db/` only adds columns, so a startup step in `HiveDb` fills every empty
  `idea_title` with `titleFromIdea(idea_text)`, and no card is left without one. `titleFromIdea` moves out of
  `hive.ts` to where `db/` can import it, and is used for nothing else.
- **Every idea goes through New idea** (extends `NewIdea`). The board's field no longer adds a card itself. Enter opens
  the header's New idea form with the field's project chosen and what you typed as the title. A small
  `NewIdeaProvider` at the app root holds whether the form is open and what it starts with. `NewIdea` reads it, and
  `AddIdea` calls its `openNewIdea({ projectId, title })`. So there's one form, one Add and one place where an idea
  can fail. If the form is already open, the project and title passed in replace the form's, and any text already
  typed is kept. The project passed in survives the form's loading of the project list: that load chooses the only
  project only when none was passed.
- **Ideas can be edited until Start** (new: `PATCH /api/cards/:id`, `{ title, text }`). It checks the way `POST` does:
  both fields trimmed and required, 400 if either is empty. It is refused with 409 outside Ideas, and while the card is
  moving, using the same `moving` set as moves: the product owner reads the idea in its first message, so a later
  edit would only mislead the history. The edit sets `ideaTitle`, `ideaText` and `title`, and emits `card.updated`.
- **Equal columns everywhere** (diverges from `docs/mockups/CardRefine.dc.html`, which is about 55/45). At today's
  60/40, the brief and the spec are too narrow to read comfortably next to the chat. The one `.columns` rule in
  `Card.module.css` becomes `minmax(0, 1fr) minmax(0, 1fr)`. Below 60rem it is still one column.

## Goals

- Reach any finished lane's chat and artifact from the card page, in every lane.
- Give an idea a title you choose, and a text that is the Ideas lane's artifact.
- Settle what the Ideas, Refine and Mockup artifacts are.
- Give the artifact beside the chat as much room as the chat.

## Non-goals

- **Artifacts as they were when the lane ended.** A past view shows the card's current data: the spec as it is now and
  the last plan. Snapshots per lane belong to the next spec, which does the later lanes properly.
- **The spec on a landed card.** A card's worktree is removed when it lands, and the hive reads the spec only from
  the worktree. So on a Done card, ✓ Spec shows the chat next to a one-line note, and Done's own view has no spec
  either, as today. The next spec can read it from the commit the card landed as.
- **Building the Mockup lane.** This spec says what its artifact is, so the Mockup spec has a slot to fill.
- **Brief versions, time per lane, round counts,** and the summary tiles from `CardDone.dc.html`.
- **Commenting on an artifact** by selecting text in it.
- **Editing an idea after Start,** or sending a card back to Ideas.

## Design

### What each lane shows when you look back

| Lane | Left, read-only | Right |
| --- | --- | --- |
| **Ideas** | "No chat in this lane" | The idea: your title and the text |
| **Refine** | Product owner chat | The brief (`BriefPanel`) |
| **Mockup** | Not a link: shown as skipped | Once the lane exists: the version you picked |
| **Spec** | Spec writer chat | The spec (`SpecView`, folded under its path). With no spec to read on a landed card: "The spec can't be shown here: it's on main at `<path>`." On any other card, only "The spec can't be shown here." |
| **Plan** | Planner chat | The plan |
| **Build** | Developer chat | The build report (`BuildView`: what was built, issues, decisions) |
| **Check** | Reviewer chat | The last Check round |
| **Try it** | Try it's chat: the hive's notes about the setup, the app and the ports | One line: Try it's artifact, your feedback rounds, comes with the next spec |
| **Ship** | Landing chat | Where it landed (`DonePanel`) |

Done is never a past lane. Its own view stays as it is. A lane with no chat (its session never wrote anything) shows
"No chat in this lane" on the left.

### The page while looking back

Above the columns, one muted line: *"Looking back at Refine. It's finished, so nothing here can be changed."*, then a
**Back to Spec** link, naming the current lane. The title row, the badge and Delete stay as they are, so a card that
starts waiting for you while you look back still shows ● needs you.

`Card.tsx` reads `lane` from the search params. If it names a past lane, the page renders `PastLaneView` for it.
Otherwise it renders `LaneView` as today. That covers the current lane, a later one, Mockup, Done, a value that
isn't a lane, and a lane that has stopped being past since the link was made. When
the card changes lane while you're looking back, you stay where you are, and the strip and the "Back to" link follow.

`Chat` gains a read-only form: it takes a list of items and renders only the messages and error lines, with no
actions on the error lines, no pending question, no activity line and no reply form.

### Ideas

- **New idea** (`NewIdea.tsx`) gets a **Title** field above the text, which keeps its label **Idea** and its
  placeholder "Two sentences is enough." Add needs a project, a title and a text. Opened from the board's field, the
  form starts with that project and title, and focus goes to the text.
- **The board's field** (`AddIdea.tsx`) stays one line, with the placeholder "Add an idea". Enter opens New idea and
  empties the field. Enter with nothing typed opens it too, with just the project chosen. `Board.tsx`'s `addIdea` goes.
- **An idea's tile opens its card,** like every other tile; before, an idea's tile couldn't be opened. Its page shows
  no badge, as on the board.
- **The card page in Ideas** shows the idea in the right-hand column, where every lane's artifact sits, and leaves the
  left empty, where Refine's chat will start. It holds the title in a text field, the text in a textarea, **Save** (enabled
  when something changed and both are filled in) and **Start**. With unsaved edits, Start saves them first. If that
  save fails, the card doesn't move and the error shows. Then Start makes the same move as the tile's Start, and
  fails the same way. The empty chat and empty brief that the page shows today are gone.
- **Refine's first message** (`refineFirstMessage`) and **the spec writer's first message** (`specFirstMessage`) give
  the title and the text as two labelled parts.
- **The Idea view** used looking back is `IdeaView`: the title as a heading and the text as paragraphs.

### The spec, folded

- **The spec starts folded.** `SpecView` shows the spec's path as the line of a fold, shut, and a click opens the
  rendered Markdown. It folds wherever it shows: in Spec, looking back at ✓ Spec, in Done, and in a lane that isn't
  built. While the spec writer is still writing, the path and "The spec writer is writing the spec…" show unfolded.
- **The brief is no longer folded above the spec,** as `docs/specs/2026-11-26-spec-lane-review-gate.md` had it.
  ✓ Refine shows it.

### The Mockup artifact

The Mockup lane's artifact is the version you picked: its screenshot, which the docs already take at Good, and its
label. The versions' worktrees are deleted, so the screenshot is the part that lasts. Your pinned comments stay in
Mockup's chat, which you can look back at like any other. This spec only names the artifact. The Mockup spec stores
it, on the `Version` row the docs plan, and adds the right-hand panel and the link in the strip.

### Docs and changelog

- `CONCEPT.md`: the Ideas row (a title and a text). The Page's Card bullet (the strip takes you back to a finished
  lane, read-only). History and Done's first line: a card keeps every lane's history, reached from the strip, not
  through a tab row.
- `ARCHITECTURE.md`: `POST /api/cards` `{ projectId, title, text }`, the new `PATCH /api/cards/:id`, and `ideaTitle` on
  Card in the Data Model.
- `CardDone.dc.html`'s tab row is superseded by the strip. The changelog entry says so, and the mockup is left as it is.
- Changelog: `docs/changelog/<date>-card-lane-artifacts.md`.

## Alternatives considered

- **Tabs at the top of the right column** (Idea · Brief · Mockup). This kept the current chat in view while reading an
  earlier artifact, but it gave the card a second lane navigation beside the strip, and showed the artifacts without
  the conversation that made them.
- **Folded sections under the current artifact,** like the brief Spec used to fold above the spec. No new UI, but by Build you would
  scroll past a whole spec to reach the brief.
- **A separate request per past lane** (`GET /api/cards/:id/lanes/:lane`). That meant a loading state on every click.
  The card is small, and the docs already put every lane's history on the card.
- **Disabling the live view's buttons** for a past lane. Every action component would need a read-only mode, and one
  missed button could act on a finished lane.
- **The board's field as the title only,** with the text added later on the card page. Quicker to capture, but it
  leaves ideas with no text. A title and text inline in the Ideas cell would crowd a 210px cell.
- **Your title stays the card's name** after Refine. Rejected: the brief's title is written to be the sharper name.
- **Every mockup version, or the picked one with your comments drawn on it,** as the Mockup artifact. The rejected
  versions are deleted at Good, and the comments are already in the chat.
- **Reading a landed card's spec from its commit** (`git show <commit>:<specPath>`), or showing only its path and
  commit. Left for the next spec, which does the later lanes' artifacts properly.
- **Start disabled while there are unsaved edits, or saving as you type.** Start saving first keeps it one press, and
  never loses an edit.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: the lead plus 1 chunk.** The lead settles the shared types first (`NewCardBody`, `ideaTitle`,
  `pastChats` in `packages/shared/src/index.ts`). It then builds looking back: `pastChats` in `hive.ts`'s `card()`,
  `LaneSteps` links, `PastLaneView`, read-only `Chat`, the line above the columns, and the 50/50 split.
- **Meanwhile, a subagent builds the idea's title and text:** the `idea_title` column and its backfill in `db/`,
  `createCard`, the `PATCH` route, both first messages, `NewIdeaProvider`, `NewIdea`, `AddIdea`, and `IdeaPanel` and
  `IdeaView` as components that the lead wires into `Card.tsx`.
- **Opus 5.5 lead, Sonnet 5.5 for the idea chunk.** Read-only safety and the past-lane rules need judgment. The idea
  slice transcribes settled shapes.
