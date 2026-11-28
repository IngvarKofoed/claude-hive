# Card page's top packed into one band, with the header trimmed to 53px

The breadcrumb and the branch and path chips are gone from the card page. The title, badge, lane strip and Delete card
share one band, which wraps only when the title would fall below 320px (`--card-title-min-width`). The project, branch
and path show in a hover card on the title, and clicking the title copies the path. The header is 53px.
Spec: `docs/specs/2026-11-28-more-room-for-the-card-page-s-columns.md`.

## Detail
- Extends `2026-11-28-card-columns-scroll` (more room for the columns it scrolls) and builds on
  `2026-11-27-header-items-centred` (the header's items stay centred with the smaller padding).
- Diverges from `docs/mockups/CardRefine.dc.html`: no breadcrumb, and a 53px header instead of the mockup's 64px.
- Rejected: the native `title` attribute (shows late, unstyled, never on keyboard focus, nowhere to say "Copied"); a
  grid that always keeps the strip on the title's row (squeezes the title to about 80px on a 1000px window and would
  need a breakpoint); a toggle or scroll-collapse (ruled out in Refine).
- Behaviour: the hover card shows after a 0.3s delay on pointer hover, at once on keyboard focus, and while "Copied" or
  "Couldn't copy the path" shows (2 seconds). It is `visibility: hidden` when closed, so `aria-describedby` still
  reads the project, branch and path. It stays open while the pointer crosses onto it, because the gap is padding,
  not margin.
- Measured in Chromium at 1440×820 on a Spec card titled "More room for the card page's columns":
  - header 69px to 53px; the columns' top 244px to 147px; the chat log 307px to 404px;
  - a one-line title (up to about 28 characters) puts the columns' top at 119px;
  - header targets (Board, For you, New idea, ☰) stay 44px;
  - at 1100px wide the strip and Delete card share a second row, with Delete card at the right edge;
  - Delete card's confirm row takes its own line below the strip.
- Not checked: Safari and Firefox (Chromium through Playwright only), a real screen reader, and the clipboard refusal
  path ("Couldn't copy the path"), which only the unit test covers.
