# More room for the card page's columns

On a laptop window the card page spends almost a third of its height before the two columns begin. Measured on a
Spec card at 1440×820: the header is 69px, and the breadcrumb, the title row, the branch and worktree chips and the
lane strip take four rows below it, so the columns start at 244px and the chat's messages get 307px. This change
takes the breadcrumb and the chips away, moves the branch, the path and the project's name into a hover card on the
title (clicking the title copies the path), packs the title, badge, lane strip and Delete card into one band that
wraps only when it must, and trims the shared header's padding to 53px. On the same card the columns then start at
147px, and at about 119px for a title that fits on one line.

## Outcome

**What you get:**

- About 100px more height for the chat and the lane's artifact on a laptop window: no breadcrumb, no row of branch
  and path chips, and the title, badge, lane strip and Delete card side by side in one band.
- The project, the branch and the worktree path on hover over the card's title, and the path on your clipboard with
  one click on the title.
- A slimmer header (53px, from 69px) on every page, with the same 44px click targets.

**How to verify:**

- Open a card in Spec at 1440×820. There's no "Board › …" line and no chip row. The lane strip and Delete card sit to
  the right of the title, and the columns start about 100px higher than before. The chat's messages show about
  100px more.
- Hover the card's title: after a moment a small box shows the project, the branch, the worktree path and "Click to
  copy the path". Click the title: the box says "Copied", and pasting gives the worktree path. On a card in Ideas or
  Done, the box shows the project (and a kept branch) and offers no copy.
- Narrow the window to 1100px: the lane strip and Delete card move together onto a second row, and the title gets
  the first row to itself. Below 60rem the columns stack and the page scrolls, as today.
- On Board, For you, Role prompts and the card page, the header is 53px tall, and Board, For you, New idea and ☰
  are still 44px tall.

## Key decisions

- **The breadcrumb goes** (diverges from `docs/mockups/CardRefine.dc.html`, which draws "Board › project › title").
  The header's Board link already goes back to the board. The project's name, the only thing the breadcrumb showed
  that nothing else does, moves into the title's hover card.
- **One band for the title and the lane strip** (extends `.titleRow` in `pages/Card.module.css`). The band is a
  wrapping flex row of two groups: the title with its badge, and the lane strip with Delete card. The title group
  takes the spare width; when that would leave it narrower than `--card-title-min-width` (a new token, 320px), the
  strip and Delete card wrap together onto a second row. The title wraps inside its group and is never cut off.
- **Branch and path in a hover card on the title** (new). A new `CardTitle` component renders the title, and a small
  box (`role="tooltip"`, tied to the title by `aria-describedby`) that CSS shows on hover and on keyboard focus.
  Chosen over the native `title` attribute, which appears only after about a second, can't be styled, never shows
  on keyboard focus, and has nowhere to say "Copied".
- **Click the title to copy the worktree path** (new). When the card has a worktree, the title's text is a `<button>`
  inside the `h1` that calls `navigator.clipboard.writeText`. The box's last line turns into "Copied" for two
  seconds, announced through `role="status"`. The page runs on localhost, which counts as a secure context, so the
  clipboard API is there without a permission prompt.
- **The header's padding is trimmed** (diverges from the mockup's 64px header). `.header` in
  `components/Header.module.css` goes from `var(--space-5)` to `var(--space-1)` top and bottom: 4 + 44 + 4 + 1px of
  border = 53px. Its links, New idea and ☰ keep `--target-min`. `Header` is one shared component, so Board, For you
  and Role prompts get the same header with no change of their own.
- **The page's top padding follows the mockup** (reuses the 16px top padding of `main` in `CardRefine.dc.html`).
  `.main` in `Card.module.css` goes from 24px to `var(--space-6)` on top only.
- **The lane strip moves but doesn't change** (reuses `LaneSteps`). Same pills, the same look-back links, the same
  `aria-label="Lanes"`.

## Goals

- Give the chat and the lane's artifact the height that the rows above them use today.
- Keep everything those rows offered: the title, the badge, Delete card and its confirm row, the lane strip and its
  look-back links, the project, the branch and the path.

## Non-goals

- The chat's reply area, panel titles and padding inside the columns, and the Spec panel's review bar.
- A toggle, or a scroll behaviour, that collapses the top block.
- Smaller click targets in the header, or a smaller lane strip.
- What the columns show, and their even split.
- Any change to Board, For you or Role prompts beyond the shared header.

## Design

### The top band

`Card`'s `.top` block today holds four rows: `p.crumbs`, `div.titleRow` (h1, badge, `DeleteCard`), `p.where` (two
`Chip`s) and `LaneSteps`. After this change it holds one wrapping flex row (`flex-wrap: wrap`, the row gap
`var(--space-4)` as between today's rows):

- **The title group:** `CardTitle`, then the badge, exactly as today (none in Ideas and Done). It grows to take all
  spare width, with a flex basis of `--card-title-min-width` and `min-width: 0`. The `h1` wraps inside it, with
  `overflow-wrap: anywhere` for a very long word: no ellipsis, no line clamp.
- **The end group:** `LaneSteps` (with `navigable` and `viewing`, as today), then `DeleteCard`. It doesn't grow while
  it shares the row, and fills the row once it wraps onto its own, so Delete card's existing `margin-left: auto`
  keeps it at the right edge in both cases. A strip wider than the window still wraps its own pills, as today.

The two groups are centred on each other vertically. One row is as tall as Delete card's compact button (34px).

`p.crumbs` and `p.where` go, with their rules, and `Card.tsx` stops importing `Chip`.

**Delete card's confirm row and its "Left behind" panel** replace the button, as today. The end group wraps too,
and the panel takes a line of its own in it (`flex-basis: 100%` on `DeleteCard`'s panel). The group is then too
wide to share the title's row, so it fills the next one, with the strip above the question. The question is never
squeezed beside the strip.

**Below the band** nothing changes: the "Looking back at…" line, the "isn't implemented yet" notice, then the
columns, `var(--space-6)` apart as today.

What it gives at 1440×820, measured by laying the band out in the running page: this card's title ("More room for
the card page's columns", 435px wide in one line) wraps to two lines beside the strip, and the columns start at
147px instead of 244px. The chat's messages grow from 307px to 404px. A title up to about 360px wide (about 28
characters) stays on one line, and the columns start at about 119px. The page is at most 1280px wide, so an
external monitor packs the band the same way, and all the extra window height goes to the columns, as today.

### The hover card and the copy

`components/CardTitle.tsx` takes the card's `title`, `projectName`, `branch` and `worktreePath`, and renders the
`h1` and the box after it. The box is positioned under the title, over the top of the columns, and lists:

- the project's name;
- the branch, when the card has one (in mono, as the chip was);
- the worktree path, when the card has one (in mono, wrapping anywhere);
- with a worktree, a last line: "Click to copy the path".

**Showing it.** CSS shows the box after a short pause (about 0.3s, a `transition-delay` on `visibility`) while the
pointer is over the title, and at once while the title has keyboard focus (`:focus-visible`). It stays open while
the pointer moves onto the box itself, so the path can also be selected by hand. Hidden, it stays in the DOM, so
`aria-describedby` still gives screen readers the project, the branch and the path.

**With a worktree,** the title's text is a `<button>` that looks like the heading: no border or background, the
`h1`'s font, `cursor: copy`, and the global focus ring. Clicking it copies `worktreePath`. For two seconds the last
line says "Copied" (or "Couldn't copy the path" if the clipboard refuses), and the box stays shown meanwhile
(`data-copied` on it), so a keyboard user hears it and a mouse user sees it.

**Without a worktree** (Ideas, a parked card, Done once Ship has removed the worktree), the title is plain text. The
box shows on hover alone, with the project and any branch the card still carries, and no copy line.

Styling sits in `CardTitle.module.css` on existing tokens: `--color-surface`, `--color-border`, `--radius-md`,
`--shadow-tile`, `--text-sm`, `--font-mono`, and `--popover-width` as the box's maximum width. The `h1`'s own rule
(`--text-3xl`, bold, `--leading-tight`) moves there from `Card.module.css`.

### The header

Only `.header`'s padding changes, to `var(--space-1) var(--space-8)`. Every item in it is already centred
(`docs/changelog/2026-11-27-header-items-centred.md`), and nothing on any page depends on the header's height: the
card page's frame is a flex column, and the other pages scroll as documents. The ☰ menu and New idea's form open
from their own buttons, so they move up with them.

### Narrow windows and every lane

The band is the same in every lane, Ideas, Try it, Ship and Done included, and when looking back at a finished lane.
Below 60rem the page lets go of the frame as today (`docs/changelog/2026-11-28-card-columns-scroll.md`): the band
wraps as the width requires, the columns stack, and the page scrolls. The hover card works the same there.

## Open questions

- **Q:** Should the title shrink from 24px (`--text-3xl`) to 22px or 18px, so longer titles fit on one line beside
  the strip? **Default:** no. It stays the page's heading at the mockup's size, and a two-line title costs about
  28px.
- **Q:** Should the mockup files (`CardRefine.dc.html` and the other card mockups) be redrawn without the breadcrumb
  and the branch line? **Default:** no. The changelog entry records the divergence, as
  `2026-11-27-card-page-even-columns` did for the even split.

## Alternatives considered

- **The native `title` attribute for the hover.** No code, but it appears late, can't be styled, never shows on
  keyboard focus, and has nowhere to confirm a copy.
- **A grid that always keeps the strip on the title's row.** It saves the second row for every title, but on a
  1000px window it squeezes the title into about 80px. It would need a breakpoint to fall back, which the wrapping
  row with a minimum title width gets for free.
- **A toggle or scroll-collapse for the top block.** Ruled out in Refine.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Sonnet 5.5.** About seven files on one thread: `Card.tsx` and `Card.module.css`, the new
  `CardTitle` with its stylesheet and test, `Header.module.css`, and `tokens.css` for the new token. The band's
  layout, the hover card and the copy hang on each other, and the spec settles each choice.
- **Check the layout in a browser at 1440×820 and 1100px wide,** not only in jsdom, which has no layout.
