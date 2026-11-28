# Card page fits the window, and its columns scroll on their own

The card page is now the height of the window: header, title and lane strip stay put, and the two columns scroll
separately. In the chat lanes the messages scroll between the panel's title and a footer holding the reply box, Good
and Stop, and the chat follows new text only while you're at its bottom (otherwise "↓ New messages" appears).
Extends the `.columns` rule from `2026-11-27-card-page-even-columns`. Spec: `docs/specs/2026-11-28-card-columns-scroll.md`.

## Detail
- Rejected: newest-first chat order; a column that scrolls with a sticky footer (the chat title scrolls away, and
  following would watch a column `Card` owns); only the right column staying put; a sticky reply box on narrow
  windows (needs a second way of following); jumping to every new question.
- The log's box changing size (the window, a taller reply box, or the footer growing when Stop, a hint or an error
  line appears) re-follows through a `ResizeObserver` on the log while at the bottom. The spec lists this as not
  handled; code review found the footer case hid the newest line, so it went in.
- Below 60rem the frame lets go and the page scrolls; the framed log is capped at `--chat-log-max-height` (70vh).
- The framed log is `position: absolute` over its box, which holds the `--chat-log-min-height` floor. In the flow, a
  long chat raised every automatic min-height above it (`.chat`, the chat panel, the grid row, `main`) to its full
  length, and the page grew to the chat's height again. Keep it out of the flow, and keep `main` at `min-height: 0`.
- The chat panel keeps `min-height: auto` and `overflow: visible`: its minimum (title, log floor, footer) holds the
  grid row, and on a window too short for it the row runs past the frame and the window scrolls.
- Checked in Chromium through Playwright, on a scratch database with seeded chats:
  - At 1440×900, a long Spec, Refine or Build chat fits the window, opens at its newest message, and the reply box
    stays in view. Sign off stays put while a 5,500px spec scrolls under it.
  - The chat follows streamed text at the bottom. Scrolled up, it stays put; the activity line doesn't show the
    button, and new text does. The button and scrolling down by hand both clear it. Live events were injected into
    the page's EventSource.
  - At 1440×600 the log holds 240px and the window scrolls. At 900 wide the columns stack and the log is capped at
    70vh. A look-back chat scrolls in its own column from the top.
- Not checked: Safari, a real session's turn, Ship's Landing chat, and Try it and Done with long content.
