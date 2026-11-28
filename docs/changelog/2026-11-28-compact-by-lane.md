# By lane has a Compact switch for a 13" screen

A **Compact** switch on By lane, remembered per browser, fits the whole hive on a 13" screen: the lanes share the
window's width, tiles shrink (badge as its symbol, title in two lines), and Done becomes a count that opens the
landed cards under the project's row. Without it, By lane is as before. Spec:
`docs/specs/2026-11-28-compact-by-lane-for-a-13-screen.md`.

## Detail
- **Settles two gaps `2026-11-27-board-by-project` left open:** By lane not matching the mockup's widths, and where
  landed tiles would open in a narrow Done ("an 84px Done has room for a count but not for landed tiles").
- **Lanes are 120px minimum, the mockup has 128px:** headroom on the Air.
- **Compact lane headers show only the lane's name,** with who works in it as hover text. The spec also kept "limit
  N", but lane limits left the board while this was built (`2026-11-28-no-lane-limits`).
- **Rejected:** Compact by window width, a popover from Done, widening Done while it's open, subgrid rows, a × for
  Delete.
- **Not verified in a browser:**
  - Start and drag onto Refine were checked against an intercepted move request, never a real start, which would
    have run Claude sessions.
  - Badge and title hover text were checked as `title` attributes. Headless Chromium doesn't draw the tooltip itself.
  - A card landing, or the last landed card being deleted, while the fold is open is covered only by
    `ProjectRow.test.tsx`, not by a live update.
  - Checked only in Chromium. The two-line clamp (`-webkit-line-clamp`) in Safari and Firefox, and Delete showing on
    keyboard focus in a Compact tile, weren't tried.
