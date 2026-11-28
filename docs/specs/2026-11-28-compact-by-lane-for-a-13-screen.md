# Compact By lane for a 13" screen

The By lane board is about 2,370px wide (a 220px project column and ten lanes of 210px), so on a 13" MacBook Air,
which leaves about 1,390px for it, you scroll sideways to see the right half of the hive. This adds a **Compact**
switch to By lane. With Compact on, the nine working lanes share the window's width down to 120px each, the project
column narrows to 150px, Done becomes a slim column with a "N landed" count that opens the landed cards under the
project's row, and tiles keep every part at a smaller size. You turn it on by hand, and the browser remembers it the
way it remembers the layout. With Compact off, By lane is exactly what it is today. It's all frontend: the same board
data, the same moves, drawn narrower.

## Outcome

**What you get:**

- **A Compact switch** next to By lane | By project, shown only in By lane, remembered in this browser.
- **The whole hive on a 13" screen:** with Compact on, every lane from Ideas to Done and every project fit a 1440px
  window with no sideways scroll. Below about 1,364px the board scrolls sideways as it does today.
- **Small tiles that still do everything:** a title of up to two lines, the badge as its symbol (● ▶) with the label
  on hover, Start and drag on ideas, Delete on hover, and the move error.
- **A slim Done** showing "N landed", which opens that project's landed cards under its row and closes them again.

**How to verify:**

- In a 1440px-wide window, By lane, press Compact: Ideas through Done and every project are in view and the board
  doesn't scroll sideways. Reload: it's still Compact. Narrow the window to 1,200px: the board scrolls sideways and
  the lanes stay about 120px wide.
- On a Compact tile, hover the ● badge: "needs you" shows. A title longer than two lines ends in "…" and shows in full
  on hover. Drag an idea onto Refine, or press its Start: it moves to Refine.
- Press "N landed" in a project's Done column: its landed cards open under that row. Press it again: they close.
- Press Compact again, or switch to By project: each looks exactly as it does today, and By project shows no Compact
  switch.

## Key decisions

- **A switch beside the layout, remembered like it** (extends). A `ui/Button` labelled Compact with `aria-pressed`,
  after the By lane | By project group, rendered only while the layout is By lane. It's stored under its own
  `localStorage` key, `hive.boardCompact`, read and written in try/catch exactly as `LAYOUT_KEY` is, so a trip to By
  project and back keeps it. Nothing reads the window's width.
- **One column template for the whole grid** (new). `Board.module.css` sets a `--board-columns` custom property on
  `.grid`, one value for the normal board and one under `[data-compact]`; the band row, the head row and
  `ProjectRow`'s `.row` all read it instead of repeating the template three times. A Compact `.grid` gets a definite
  width, because `fr` tracks inside today's `width: max-content` are sized per row from their content, and the
  separately gridded rows would stop lining up.
- **Compact widths are tokens** (extends). `--project-col-width-compact: 150px`, `--lane-min-width-compact: 120px`,
  `--done-col-width-compact: 84px` and `--tile-title-lines-compact: 2` join the Layout block of `tokens.css`. The
  template is close to `docs/mockups/Main.dc.html` (150px, `minmax(128px, 1fr)`, 84px), with 120px in place of 128px
  for headroom on the Air.
- **A `compact` prop, styled through `data-compact`** (extends). It goes from `Board` to `ProjectRow`, and from there
  to `CardTile`, `ProjectHeading` and `ui/Badge`. Each sets `data-compact` on its own root and selects on it in its
  own module, as `data-draggable` and `data-hands-off` do today. It defaults to off, which is how Compact off stays
  byte-for-byte today's look.
- **The badge's symbol comes from `cardBadge`** (extends). `CardBadge` gains `symbol` ("●", "▶", and "◆", "■" once
  those states exist; null for "Not implemented yet") and `text` ("needs you"). `label` stays "● needs you", so the
  summary line and full tiles are untouched. A Compact tile shows the symbol alone; a badge without one keeps its
  words.
- **Landed cards fold out under the project's row** (new). The Compact Done cell holds a "N landed" toggle; opening
  it adds a strip under that row, across the lane columns, holding the landed tiles. Each row opens on its own, and
  every visit starts closed, as `ProjectPanel`'s fold does. This settles where landed tiles open, the question
  `2026-11-27-board-by-project` left open ("an 84px Done has room for a count but not for landed tiles").
- **Compact lane headers drop the who line** (diverges). Today's headers show the name and who. Compact shows the
  name alone, with who as the header's hover text: the phase bands above already say whose lanes they are, and
  "you ⇄ product owner" would wrap to two lines at 128px.

## Goals

- Every lane and every project of By lane in view on a 13" Air at default scaling, with no sideways scroll.
- Nothing lost on a tile for being small: every action a full tile offers, a Compact tile offers.
- A full By lane that's untouched for wide screens, and a choice that sticks once you've made it.

## Non-goals

- **Compact for By project,** or any change to it. It already fits.
- **The slim Done and the narrow project column outside Compact.**
- **Switching Compact on by window width.** You turn it on by hand.
- **Lanes narrower than 120px,** and phone-sized layouts. Below 1,364px the board scrolls sideways.
- **Folding empty lanes.**
- **Work-in-progress limits.** They left the board while this was built (`2026-11-28-no-lane-limits`), and Compact
  doesn't bring them back.
- **The card page and other pages.**

## Design

### The switch

`Board` keeps a second piece of state beside `layout`: `compact`, read from `hive.boardCompact` ("on" means on;
anything else, a missing key or a refusing storage means off) and written on every press. Like `LAYOUT_KEY`, the key
is exported for the tests. The Compact button sits after the layout group, with a small gap, and only renders when
`layout === "lane"`. The summary line, the add-project form and the error lines are the same in both modes.

### The grid

The board stays one `.scroll` box holding `.grid`, which holds the band row, the head row and a `ProjectRow` per
project, each its own CSS grid. What changes is where their columns come from:

```css
.grid { width: max-content; --board-columns: var(--project-col-width) repeat(10, var(--lane-width)); }
.grid[data-compact] {
  width: 100%;
  min-width: calc(var(--project-col-width-compact) + 9 * var(--lane-min-width-compact) + var(--done-col-width-compact));
  --board-columns: var(--project-col-width-compact) repeat(9, minmax(var(--lane-min-width-compact), 1fr))
    var(--done-col-width-compact);
}
```

`.bandRow`, `.headRow` and `ProjectRow`'s `.row` use `grid-template-columns: var(--board-columns)`. For Compact off,
the computed template is today's, character for character.

The numbers on a 1440px window: the page's padding (24px a side) and the scroll box's border leave 1,390px; the
project column and Done take 234px, so each of the nine lanes gets about 128px. The board's minimum is 1,314px, so it
scrolls sideways below a window of about 1,364px, at which point every lane is 120px. On a wide window Compact lanes
grow past today's 210px; they share the width, as the brief asks.

Every row has the same definite width and the same template, so the columns line up without a shared grid. Each
track's minimum is a fixed 120px, so a long word in a tile can't widen its column: Compact titles break anywhere
instead (`overflow-wrap: anywhere`).

### Headers and bands

In Compact, a lane header shows the lane's name alone, with `title` set to the lane's `who` when it has one.
Header cells use smaller padding (`--space-3`). The phase bands are unchanged: they sit in the same template, so
"with you" still spans Refine to Spec and "hands off" Plan to Check. Done's header says "Done" in its 84px.

### The project column

`ProjectHeading` gets `compact`. The project cell's padding drops to `--space-3`. The name stays and wraps if it must.
The path sits on one line, cut short with "…" at the end (`text-overflow: ellipsis`), and carries the full path as
its `title`. The trust warning keeps its full text and its Check again button: it's rare, and it should be loud.

### The Compact tile

`CardTile` gets `compact`, which sets `data-compact` on the `<article>`. Every part stays; each gets smaller:

- **Padding and gaps** drop to `--space-3` and `--space-2`, and the cell around the tile to `--space-2`.
- **The title** is `--text-md`, clamped to `--tile-title-lines-compact` lines with an ellipsis, and carries the full
  title as its `title`. The clamp goes on a `<span>` inside the title button: buttons don't take
  `display: -webkit-box` reliably.
- **The badge** shows only `badge.symbol`. `ui/Badge` gains `compact` (smaller side padding) and passes through
  `title` and `aria-label`; the symbol-only badge is `role="img"` with `badge.text` as both its `aria-label` and its
  `title`, so hover and screen readers both get "needs you". A badge with no symbol ("Not implemented yet") keeps its
  words and may wrap.
- **Start** (ideas) and **Delete** (on hover and focus, as today) use `--text-xs` with tighter padding, so they share
  one row at 120px. The row wraps rather than overflows if they don't.
- **The delete question** and its Delete and Cancel buttons wrap to the narrow tile.
- **The move error** shows as today, at `--text-xs`.
- **Dragging** an idea onto Refine is `ProjectRow`'s and doesn't change.

### Done and the landed fold

In Compact, `ProjectRow` renders no tiles in the Done cell. With landed cards, the cell holds one button: the count
in `--text-lg` bold and the done color, with "landed ▸" (▾ when open) under it in `--text-xs`. Its accessible name is
"N landed", and it has `aria-expanded` and `aria-controls`. With none, the cell is empty, as By project hides its
toggle.

Open, the row gains a strip as its last grid child, at `grid-column: 2 / -1`, so it sits under the lanes and not
under the project column. While the fold is open, the project cell spans both grid rows (`grid-row: 1 / span 2`), so
its right border and background run the full height of the row instead of stopping above the strip. The strip is a `role="group"` labelled "<project>, landed", with a top border, holding the landed
tiles as Compact tiles in board order (oldest first), in a grid of `repeat(auto-fill, minmax(var(--lane-min-width-compact), 1fr))`.
The fold is `ProjectRow` state: per row, closed on every visit. A card that lands while it's open appears in it; when
the last one is deleted, the button and the strip go.

### What stays the same

- By lane with Compact off: widths, tiles, Done tiles in the Done column, headers with the who line.
- By project, the summary line, the add-project form, the board's data and live updates, and every move.

### Docs

CONCEPT's The Page, By lane bullet, gains: "A **Compact** switch fits it to a smaller screen: the lanes share the
window's width, the tiles get smaller, and Done becomes a count that opens the landed cards."

## Open questions

- **Q:** Should a long path be cut at its start ("…/work/claude-hive") so the folder's own name stays visible?
  **Default:** cut at the end. The project's name sits right above it, and a start-ellipsis needs a right-to-left
  trick that moves a leading `~` or `/` to the wrong end.
- **Q:** Should Compact lanes stop growing at some width on a wide window? **Default:** no cap. The brief says they
  share the window's width, and with that much room you'd switch Compact off.
- **Q:** Should Compact headers keep the who line, wrapped, rather than move it to hover? **Default:** move it to
  hover, as decided above: the bands carry the gist, and the line costs a row of height on a 900px-tall screen.

## Alternatives considered

- **Compact by window width** (a media or container query). Rejected in Refine: you turn it on by hand, so the board
  never changes under you when a window is resized.
- **Landed cards in a popover from the Done cell,** like New idea's form. Rejected: the brief asks for By project's
  fold, and a popover at the board's right edge needs positioning and focus handling that a fold doesn't.
- **Widening Done while it's open.** Rejected: the template is shared, so every row would jump.
- **One grid with the rows as `subgrid`.** It would line the columns up by construction, but it restructures every
  row's markup; the shared `--board-columns` gets the same result in today's structure.
- **A × in place of the word Delete** to save width. Rejected: the word fits at `--text-xs`, and the tile keeps its
  look.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Sonnet 5.5.** About ten frontend files on one view (`Board`, `ProjectRow`, `CardTile`,
  `ProjectHeading`, `ui/Badge`, `cardBadge`, their stylesheets, `tokens.css`), with the `compact` prop threading
  through them. The grid's alignment and the tile's fit have to be checked together in a browser at 1440px and
  1,200px, so a second agent would only re-verify the same screen. Every decision is settled here, so it needs no
  Opus-level judgment.

## Amendments

- 2026-11-28: Compact lane headers show the lane's name alone, not the name and "limit N", and the Non-goals no longer
  say the headers show limits. Lane limits left main while this was built (`2026-11-28-no-lane-limits`).
