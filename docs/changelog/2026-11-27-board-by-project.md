# The board can be shown by project

The Board has two layouts, one click apart and remembered in the browser: By lane (lanes by projects, as before) and
By project, a panel per project with each card's lane written on it, which fits a 13" screen with no sideways scroll.
Ideas start with a Start button as well as the drag, New idea in the header adds one from any page, a summary line
counts what's waiting for you, and By lane has bands saying which lanes are yours. Spec:
`docs/specs/2026-11-27-board-by-project.md`; look: `docs/mockups/BoardByProject.dc.html`.

## Detail
- **Ideas show no badge any more.** They're still created as `needs-you` in the backend, but `cardBadge` gives Ideas
  and Done none, and "waiting for you" counts only ● needs you badges. For you (`2026-11-27-for-you`) counts by the
  same rule (`waitsForYou`), so the header's count and the board's summary agree. Change one, change both.
- **`Header` carries For you's links and New idea.** This landed after `2026-11-27-for-you` and took its
  `--tracking-label` token in place of a duplicate of its own.
- **The by-lane board still doesn't match the mockup's widths.** The code uses a 220px project column and 10 lanes of
  210px, about 2,370px; `docs/mockups/Main.dc.html` has 150px, nine lanes at `minmax(128px, 1fr)` and an 84px Done.
  No entry records why. Left as its own change: an 84px Done has room for a count but not for landed tiles.
- **Rejected:** a board map with text-less cards (you'd hover to tell cards apart); replacing By lane; only narrowing
  By lane; sorting a panel by state (chat-lane cards flip every turn, so tiles would jump); asking before Start;
  landed cards always shown; the layout in the URL; New idea in the Board toolbar only; New idea starting on the
  last project used.
- **The lane strip's colors aren't the card page's:** its pill colors were too faint for a 4px segment, so the strip
  has its own `--color-lane-*` tokens.
- **Verified in a browser** at 1440px on a throwaway database: both layouts, three panels across with no sideways
  scroll, two at 1000px and one at 700px, the layout surviving a reload, the landed count, and New idea from the
  board and from a card page. **Not exercised for real: Start,** which would have started Claude sessions; its move
  is the drag's, and the tests cover the button and the refusal.
- **Changed:** `CONCEPT.md` (The Board's opening line, the Ideas row, The Page's Board bullet and its badge line, the
  line on starting an idea) and `ARCHITECTURE.md` (the Ideas row of Card Moves).
