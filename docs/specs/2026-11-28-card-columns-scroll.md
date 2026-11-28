# Card page columns that scroll on their own

Today the card page is one long document. Both columns start at the top and grow with what's in them, so the
newest message and the reply box sit at the bottom of the chat while the brief or spec starts at the top of the
page: you scroll down to reply and up to read. On top of that, `Chat` calls `scrollIntoView` on every new message
and every streamed piece of text, which scrolls the whole window, so a reply being written keeps pulling you away
from the spec. This change makes the card page fit the window. The header, title and lane strip stay put, and the
two columns each scroll on their own. In the chat lanes the messages scroll between the panel's title and a footer
that holds the reply box, Good and Stop, and the chat only follows new text while you're at its bottom.

## Outcome

**What you get:**

- **No more down-then-up.** The newest message, the reply box and the top of the brief or spec are on screen at
  once, and the window itself never scrolls (unless it's too short or too narrow, below).
- **Reading isn't interrupted.** New chat text never moves the right column or the page. Scrolled up in the chat,
  you stay where you are and a "↓ New messages" button appears.
- **The way on is always in view:** the reply box and Good in Refine, the reply box in Spec, Stop in Plan, Build and
  Check, and Review and Sign off at the top of the spec.

**How to verify:**

- **Fits the window:** open a card in Spec whose chat and spec are each longer than the window. The page has no
  scrollbar. The chat shows its newest message just above the reply box, and the spec starts at its top.
- **Independent scroll:** scroll the spec halfway down and send a message. The spec doesn't move. Your message and
  the reply streaming in after it stay in view at the bottom of the chat.
- **Follow only at the bottom:** while a reply streams, scroll the chat up. It stays where you put it and
  "↓ New messages" appears. Click it: the chat jumps to the newest text and the button goes away.
- **Narrow window:** make the window narrower than 60rem. The columns stack and the page scrolls. The chat's
  messages still scroll in their own box, with the reply box right under them.

## Key decisions

- **The card page fits the window** (new). `Card` wraps `Header` and `main` in a frame the height of the window
  (`100dvh`). The top block (crumbs, title, branch chips, lane strip, the "Looking back" line, the "isn't implemented"
  notice) keeps its natural height, and the columns take the rest. A chat's messages are never shorter than
  `--chat-log-min-height` (a new token, 240px), and the columns never shorter than `--chat-min-height`. On a window
  too short for that, the page scrolls as a whole, as today. Board, For you and Role prompts still scroll as
  documents.
- **Each column is its own scroll area** (extends the shared `.columns` rule from
  `docs/changelog/2026-11-27-card-page-even-columns.md`). One rule for every lane and every look-back view: each
  column scrolls on its own, and the grid stretches both columns to the full height (`align-items: stretch` in place
  of `start`), so the two columns end level, as the mockup draws them.
- **In a chat lane the log scrolls, not the column** (reuses the chat panel shape in
  `docs/mockups/CardRefine.dc.html`). The mockup already draws the chat as a panel with a head, the messages, and a
  footer form holding Send and Good in one row. Here the chat panel fills its column. Its title stays at the top, the
  messages scroll in the middle, and the footer stays at the bottom: the error line, then the reply form or Stop. In
  Refine, Good moves into Send's row, as the mockup draws it, so the footer is one row shorter. This covers Refine,
  Spec, Plan, Build and Check.
- **The chat follows only from its bottom** (diverges from `Chat.tsx:85`). The `scrollIntoView` call goes, because it
  scrolls every scrolling ancestor, the window included. `Chat` sets the log's own `scrollTop` instead, and only when
  the log was at its bottom before the new content arrived. Opening the card and sending a message always go to the
  bottom.
- **"↓ New messages"** (new). A compact `Button` floats over the bottom edge of the log when something arrived while
  you were scrolled up. Clicking it scrolls to the bottom. It goes away then, or when you scroll down to the bottom
  yourself. A new question from the session works the same way: no jump.
- **The Spec panel keeps its head** (extends the chat panel shape). In Spec, the right-hand panel's title and
  `ReviewBar` stay at its top and only `SpecView` scrolls, so Review and Sign off are in view after reading to the
  end.
- **Narrow windows keep one way of following** (new token `--chat-log-max-height`). Below 60rem the columns stack and
  the page scrolls, as today. The log keeps its own scroll, capped at a share of the window height, with the footer
  right under it, so the follow rule above works unchanged.

## Goals

- Put the newest message, the reply box and the top of the lane's artifact on screen together.
- Stop new chat text from moving anything you're reading.

## Non-goals

- Folding older messages behind "Show N earlier messages". Left for later.
- Newest-first chat order.
- Making the top block (branch and worktree chips, lane strip) shorter to give the columns more height.
- Board, For you, Role prompts, or any page other than the card page.
- Remembering where you'd scrolled across a reload or a lane change.

## Design

### The frame

`Card` renders `<div class=page><Header/><main>…</main></div>`. `.page` is a flex column the height of the window.
`main` keeps its max width and padding, and becomes a flex column that takes the rest (`flex: 1; min-height: 0`).
Everything above the columns keeps its natural height, and `.columns` takes what's left
(`flex: 1; min-height: var(--chat-min-height)`). That floor is for the lanes without a chat. In a chat lane the chat
panel's own minimum is higher (its title, its footer, and the messages' floor, below), and the chat panel is never
squeezed below it. When the top block plus the higher of the two is taller than the window, the content overflows
the frame and the window scrolls, as it does today.

### The columns

`.columns` stretches its rows to the full height, and every direct child gets `min-height: 0; overflow-y: auto`,
whatever it is:

- **A panel** scrolls inside its own border: the Brief, and Try it's panel. Plan's right column wraps `PlanPanel` in
  a `div.sidePanel` today. That wrapper goes, so the Plan panel is the column and scrolls the same way.
- **A `.stack`** scrolls as a whole: Build's "Check found" and Plan, Check's Check and Build, both of Ship's columns,
  and the right-hand columns of Try it, Done and a lane that isn't built yet.
- **Ideas' `div.right`** (which keeps `grid-column: 2`) scrolls as a wrapper around the idea's panel.

A short panel inside a stack or a wrapper ends where its content does.

Card.tsx already tags the panels `chatPanel`, `sidePanel` and `briefPanel`, but `Card.module.css` has never had rules
for them. `chatPanel` gets its rules here; the other two stay unused.

### The chat panel

In Refine, Spec, Plan, Build and Check, the chat panel (`chatPanel`) is a flex column that doesn't scroll itself. Its
`h2` title keeps its height. `Chat` takes the rest and is a flex column in turn:

- **The log** (`role="log"`) takes all spare height and scrolls, and is never shorter than `--chat-log-min-height`.
  It's wrapped in a positioned box, so the "↓ New messages" button can float over its bottom edge.
- **The footer** keeps its height: the error line, then the reply form or Stop.

**Good in Send's row.** `Chat` takes an optional node for the end of its Send row, and Refine passes `GoodBar` there,
pushed to the row's right edge as in the mockup. The `.stack` that wraps `Chat` and `GoodBar` inside Refine's panel
today goes. `GoodBar` keeps its own hint and error line. Its error line takes a row of its own, as it does now.

`Chat`'s own `min-height: var(--chat-min-height)` goes. Its height now comes from the panel, and the messages' floor
is on the log.

**Framed or not.** `Chat` takes a `framed` prop, which only the five chat lanes pass, and which puts `data-framed` on
its root. The log's flex sizing, its own scroll and the narrow-window cap all select on `[data-framed]`. Ship's
Landing chat (a `Chat` without `framed`) and the look-back views' `PastChat` (which shares the `.log` class) aren't
framed. Their logs never get a fixed height, so they grow with their messages and the column scrolls instead.
Following does nothing there, because the log never overflows. A look-back chat opens at its top, as today.

### Following

`Chat` keeps one flag: was the log at its bottom? A scroll listener on the log sets it, counting a few pixels short
of the bottom as the bottom. After a render that changed what the log shows, a layout effect does one of two things.
What counts as a change is today's triggers (the number of messages, the streamed text, a new pending item) plus the
activity line, which today doesn't scroll.

- **At the bottom:** set the log's `scrollTop` to its `scrollHeight`.
- **Scrolled up, and something was added** (a message, more streamed text, a pending item): show "↓ New messages".
  The activity line changing, or the streamed text clearing as its message lands, doesn't show it by itself.

On the first render the log goes to its bottom. A successful send puts it at the bottom too, whatever the flag said.
Clicking the button scrolls to the bottom. The scroll event that follows sets the flag back to "at the bottom" and
hides the button, and so does scrolling down by hand.

**A new lane starts over.** Spec, Plan, Build and Check render `Chat` in the same place on the page, so React would
keep one `Chat` as the card moves between them. `Chat` is keyed by lane, so each lane's chat starts fresh: at its
bottom, with no button.

Not handled: resizing the window, or dragging the reply box taller, while at the bottom doesn't re-follow. The next
message does.

### The Spec panel

In Spec, the right-hand Spec panel takes the chat panel's shape: its title and `ReviewBar` keep their height at the
top, and a body holding `SpecView` (or "The spec writer is writing the spec…") scrolls under them.

### Narrow windows

Below 60rem the frame lets go: `.page` and `main` take their natural height, `.columns` stacks, and the columns stop
scrolling on their own. The page scrolls. The chat panel keeps its shape, but the framed log's height is capped at
`--chat-log-max-height` (a new token in `tokens.css`, `70vh` to start). The Spec panel's body doesn't scroll on its
own, and the spec runs at full length.

### Docs

`docs/CONCEPT.md`'s Card bullet under The Page gains one sentence: the two halves scroll on their own, and the reply
box stays in view.

## Alternatives considered

- **Newest-first chat.** It puts the reply box and the latest message at the top, but every exchange reads backwards,
  and a long spec still scrolls the chat away. Rejected in chat.
- **The column scrolls, with a sticky footer.** Less markup, but the chat's title scrolls away, and following would
  have to watch a column `Card` owns instead of the log `Chat` owns.
- **Only the right column stays put while the page scrolls.** Cheaper, but the reply box stays a long scroll away
  from the brief.
- **On narrow windows, the reply box held at the bottom of the screen** (`position: sticky`) while the page scrolls.
  It needs a second way of following, on the window, for a layout that's rare on a Mac.
- **A new question always jumps the chat down to it.** Rejected for the same reason the follow rule exists: it would
  pull you away from what you're reading, and the card's badge already says it needs you.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Sonnet 5.5.** About eight files on one thread (`Card.tsx` and `Card.module.css`, `Chat.tsx` and
  `Chat.module.css`, `GoodBar`'s two files, `tokens.css`, `CONCEPT.md`). Every rule hangs off the height set on the
  one above it, and the spec settles each choice, so nothing here needs Opus's judgment.
- **Verify in the browser, not only in jsdom,** which has no layout: a scratch-database card in Refine with a few long
  replies gives a chat taller than the window.
