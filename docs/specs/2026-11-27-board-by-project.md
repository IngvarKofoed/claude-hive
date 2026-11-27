# Board by project, a summary line, New idea and phase bands

The Board gets a second layout beside today's lanes-by-projects grid. **By project** shows a panel for each project,
as many side by side as the window fits, with no lane columns: each card says which lane it's in. On a 13" MacBook
Air the by-lane board is about 2,370px wide and shows only Ideas through half of Build, so Try it is off-screen; By
project fits three projects across with no sideways scroll. One click switches between the two, and the page remembers
your choice.

Three smaller pieces from the board mockups come with it: a summary line under the Board title, a **New idea** button
in the header on every page, and bands over By lane's lane headers saying which lanes are yours and which run hands
off. It's all frontend: the same board data and the same routes, drawn another way.

## Outcome

**What you get:**

- **A "By lane | By project" switch** on the Board. The page opens on the layout you used last in this browser.
- **By project:** a panel per project, three across on a 13" Air with no sideways scroll, one on a narrow window.
  Each card in progress shows its lane by name and on a strip of the 10 lanes. Ideas sit below the cards in progress,
  and landed cards fold into a count.
- **A Start button on every idea,** in both layouts, which moves it to Refine. Dragging still works in By lane.
- **From the board mockups:** a summary line under the title (projects, cards in progress, cards waiting for you), a
  New idea button in the header on every page, and phase bands over By lane's lane headers.

**How to verify:**

- **It fits, and it's remembered:** in a 1440px-wide window, switch to By project. The projects sit three across, the
  page doesn't scroll sideways, and every card in progress names its lane. Reload: it opens By project again.
- **Start:** press Start on an idea in By project. It moves to Refine, and its tile moves up into the cards in
  progress with "Refine" on it.
- **Cards stay put:** a card whose state flips between ▶ working and ● needs you keeps its place in the panel. It moves
  only when it changes lane.
- **The count matches:** the summary's "waiting for you" equals the number of ● needs you badges on the board, and
  changes as soon as one appears or goes.
- **New idea from anywhere:** on a card page, press New idea, pick a project and add an idea. On the board it's in
  that project's Ideas, without a reload.

## Key decisions

- **A second view of the same data** (reuses). `Board` keeps loading `GET /api/board` and applying the `card.updated`,
  `project.updated` and `card.deleted` events; only what it renders depends on the layout. No backend, API or shared
  type changes.
- **One card tile for both layouts** (extends). `CardTile` gains `showLane` (a line with the lane's name and the strip)
  and `onStart` (Start on an idea). The strip is a compact variant of `LaneSteps`, the card page's lane bar.
- **One badge rule** (extends). Which badge a tile shows moves out of `CardTile` into `cardBadge(card)`, which the tile
  and the summary line both use, so "waiting for you" is always the number of ● needs you badges. Ideas get no badge:
  they're created as `needs-you` (`createCard` in `hive.ts`), but they wait for Start, not for an answer.
- **Start beside the drag** (extends). Start makes the same move as dropping an idea on Refine, through Board's
  existing move handler, so the move rules and the tile's move error are unchanged. Both docs that say "drag" change
  with it: CONCEPT's Ideas row becomes "You drag it to Refine, or press Start.", and the Ideas row of ARCHITECTURE's
  Card Moves table becomes "You drag the card, or press Start".
- **Lane order, never state** (new). A panel's cards sort by their lane's place in `LANES`, then oldest first. In the
  chat lanes a card flips to ● needs you at the end of every turn, so sorting by state would make tiles jump.
- **Panels fill the width** (new). A grid that fits as many panels as `--board-panel-min-width` (400px) allows: three
  at the Air's 1,392px of usable width, two from 816px, one below. Panels keep their own height, so a short project
  leaves space under it.
- **The layout is remembered in `localStorage`** (new). Under one key, read and written inside try/catch, with By
  lane when nothing is stored. It's a view preference for the one person at this browser: the database would need an
  API for it, and a URL parameter would be lost when you open the page from its plain address.
- **The project heading and the idea field are shared** (extends). The name, path and trust warning (with Check
  again), and the add-idea field, move out of `ProjectRow` into components both layouts use.
- **New idea lives in the header** (extends). `Header` gains a button on every page. Its form loads the projects from
  `GET /api/board` when it opens and adds through `POST /api/cards`, as the Ideas field does; the board shows the new
  card through the `card.updated` event `createCard` already sends. CONCEPT's line on starting an idea gains "or with
  New idea in the header".
- **Phase bands are the board's wording** (new). A short list in `Board`, not fields on `LANES`: the lanes'
  `withYou` flag can't tell Ideas' "you" from Refine to Spec's "with you", and the words are the board's, not lane
  data.

## Goals

- No sideways scroll on a 13" screen, with every card in progress in view and its lane named. Landed cards fold
  into a count, and a long panel or a fourth project still scrolls down.
- Where each card stands in the flow, readable from the card itself.
- How much is in progress and waiting for you, at a glance on the Board.
- An idea can be written down from any page.
- In By lane, which lanes are yours and which run hands off, readable over the lane headers.

## Non-goals

- **Work-in-progress limits in the panels.** Nothing enforces them yet, and By lane's headers still show them.
- **Changing By lane's look,** beyond Start on ideas and the phase bands. Bringing it back to the mockup's widths (a
  150px project column, nine lanes at `minmax(128px, 1fr)`, an 84px Done) is a change of its own: an 84px Done has
  room for the count but not for opening landed tiles the way a panel does, so where they open is its own question.
- **Dragging in By project.** There's no lane to drop onto; Start is the way in. A tile is draggable only when it's
  given `onDragStart`, and By project doesn't give it, so ideas there show no grab cursor.
- **Sorting, filtering, folding or reordering projects.** Panels come in the board's project order.
- **The rest of the mockups' header:** the link to For you and its count (the For you spec, written in another
  session) and the plan usage bars (they need `GET /api/usage`, which doesn't exist).
- **A badge legend.** Each badge already spells out its meaning, and ◆ and ■ don't occur yet.
- **A board map** with text-less cards (rejected in `2026-11-27-board-by-project`).

## Design

The look is `docs/mockups/BoardByProject.dc.html`, on the mockup canvas next to For you, and, for the phase bands,
`docs/mockups/Main.dc.html`.

### The switch

Two buttons, **By lane** and **By project**, in the Board toolbar next to the title, built from `ui/Button` with
`aria-pressed` on the one in use. Choosing one re-renders the board at once and stores the choice. Reading or writing
the stored value can fail (a private window, blocked site data); the page then opens By lane and the switch still
works for the visit.

### The summary line

Under the Board title, in both layouts, counted from the board's own cards and kept live with them:
"4 projects · 10 cards in progress · 7 waiting for you".

- **Projects:** every project on the board.
- **In progress:** cards from Refine through Ship, the cards a panel shows as in progress.
- **Waiting for you:** cards whose `cardBadge` is ● needs you.

Counts of one read "1 project" and "1 card in progress", and none waiting reads "nothing waiting for you". With no
projects there's no summary line: the board's empty message says what to do.

### Badges

`cardBadge(card)` decides a tile's badge: none in Ideas and Done, "Not implemented yet" in a lane that isn't built,
and otherwise ▶ working or ● needs you from the card's state. `CardTile` draws it, and the summary line counts it.
Today every idea shows ● needs you; after this change ideas show no badge, in both layouts. CONCEPT's "In both, each
card shows a badge" becomes "In both, each card in progress shows a badge". The For you spec should
count waiting cards the same way.

### A project's panel

A new `ProjectPanel`, the by-project counterpart of `ProjectRow`, drawn in a `ui/Panel`. Top to bottom:

1. **The project heading:** name, path and, when the folder isn't trusted, the warning with Check again.
2. **Cards in progress:** every card from Refine through Ship, in two columns, in lane order. Within a lane they keep
   the order `/api/board` returns them in, oldest first. Each tile shows its lane line.
3. **Ideas:** a small "Ideas" heading, the add-idea field, and the idea tiles in the same two columns. Idea tiles skip
   the lane line, since the heading says it, and carry Start.
4. **Landed:** a "12 landed" button, shown when the project has Done cards. It opens the Done tiles in the panel, in
   the same two columns, and closes them again. It starts closed on every visit.

A project with nothing yet shows its heading and the add-idea field.

### The card tile

`CardTile` keeps its title, badge (now from `cardBadge`), Delete and move error. Two additions, both off unless the
layout asks:

- **The lane line** (`showLane`): the lane's name, then the strip. The strip is `LaneSteps` in a compact variant: the
  same ten steps, drawn as small segments without names. Lanes already passed are mid grey, the card's own lane is
  dark and taller, and lanes still to come are light grey, as in `docs/mockups/BoardByProject.dc.html`. The card
  page's pill colors were too faint for a segment this thin. The strip is hidden from screen readers, since the name
  beside it says the same.
- **Start** (`onStart`, ideas only): a compact button at the left of the tile's bottom row, with Delete kept at the
  far right, so aiming for one doesn't hit the other. It's one click, as the drag is one gesture: neither has an undo
  short of Delete until Park exists. It's disabled while its move runs. A failed Start shows exactly as a failed drag
  does today: in the board's error line, plus the tile's move error when the backend stored one.

By lane passes `onStart` and not `showLane`: the column already names the lane.

### New idea

A primary **New idea** button at the right of `Header`, on every page. It opens a small form under it:

- **Project:** a list of every project by name. With one project it's already chosen; with several, none is, and
  Add stays disabled until you pick one.
- **Idea:** a text box. Two sentences is enough, as in the Ideas field.
- **Add** and **Cancel.**

The projects load from `GET /api/board` when the form opens; a failed load shows its error in the form. With no
projects the form says to add one on the Board first. Add posts `POST /api/cards`: on success the form closes and
empties; on failure it stays open with the error and your text. Escape or Cancel closes it with nothing added, and
the focus goes back to the button. The idea appears in that project's Ideas through the board's live updates; on any
other page nothing else changes.

### Phase bands

A row above By lane's lane headers, part of the same grid, so it scrolls with it. Each band spans its lanes:

| Over | Band |
| --- | --- |
| Ideas | you |
| Refine, Mockup, Spec | with you |
| Plan, Build, Check | hands off |
| Try it | you |
| Ship | hands off |
| Done | none |

The look is the Board mockup's: the "you" bands in the ● needs you colors, "hands off" in the muted surface, and
Ideas' "you" as plain text. The mockup says "with you · chat until Good" over Refine to Spec; this says only "with
you", since Spec moves on when you sign off, not on Good.

### What stays the same

- By lane's grid, widths, drag and drop, and lane headers. It gains only Start on ideas and the phase bands.
- The board's data, live updates and error messages, which sit above both layouts.
- The card page, apart from the header's New idea.

### Depends on

- The tile's Delete comes from `2026-11-27-delete-a-card`, which isn't on main yet. The build starts after that change
  lands, from the latest main.
- The For you spec, written in another session, also adds to `Header`. Whichever lands second fits around the other.

## Alternatives considered

- **Only bring By lane back to the mockup's widths,** with no second layout. Rejected: you want both layouts. The
  mockup's grid only just fits 1,392px, its 128px lanes are tight for a title, badge, Delete and Start, and it still
  scrolls sideways below 1,380px. By project works at any width.
- **Ideas first, in strict lane order.** Rejected: a long list of ideas would push the work under way down the panel.
- **Landed cards always shown.** Rejected: the panels would grow with every card that lands.
- **Sort by state,** cards that need you first. Rejected: chat-lane cards flip state every turn, so tiles would jump.
- **Ask before Start** ("Start refining?" with Start and Cancel), or Start only in By project. Rejected: two clicks
  every time, or a button in one layout only; keeping Start apart from Delete covers the likely mis-click.
- **Group the panel by lane,** with a small heading per lane. Rejected: with one or two cards per lane it's mostly
  headings, and the lane line already says it per card.
- **The layout in the URL** (`/?layout=project`). Rejected: opening the hive from its plain address would forget it.
- **New idea in the Board toolbar** only. Rejected: an idea often comes while you're on a card page.
- **Ideas keep ● needs you,** counted as waiting or not. Rejected: counted, "waiting for you" would be mostly ideas;
  not counted, the count would disagree with the badges. An idea waits for Start, which its column or section says.
- **New idea starts on the last project used.** Rejected: one click less, but an old choice would put ideas in the
  wrong project.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Multi-agent: the lead plus 1 chunk, in parallel.** The lead builds the board side: `Board`, `ProjectPanel`, the
  shared heading and idea field split out of `ProjectRow`, `CardTile`'s props, `cardBadge` and the summary line, and
  the phase bands; it owns `tokens.css`. A subagent builds New idea: `Header` and a new `NewIdea` component with its
  stylesheet and test, using existing tokens and touching no board file.
- **Sonnet 5.5 for both.** Every decision is settled here, so neither part needs a design call from Opus.
