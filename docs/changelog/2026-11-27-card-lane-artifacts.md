# Look back at a card's finished lanes, and ideas with a title

The lane strip on the card page now links each finished lane. A link shows that lane's chat, read-only, next to what
it produced: the idea, the brief, the spec, the plan, the build report, the Check round or the landed commit. So the
brief can be reached from any lane after Refine. An idea is typed as a title and a text, and can be edited on its
page until Start. The spec starts folded. Spec: `docs/specs/2026-11-27-card-lane-artifacts.md`.

## Detail
- **"Finished" means before the current lane in board order** (`lanesBefore` in `packages/shared`), because there are
  no lane-visit records. A card that Check sent back to Build doesn't count Check as finished.
- **Unbuilt lanes are treated as skipped.** Mockup shows as "– Mockup" and isn't a link. When the Mockup lane is built,
  its spec decides how a real skip shows. That spec also stores the Mockup artifact: the picked version's screenshot
  and label.
- **Read-only because nothing is there to press.** `PastLaneView` is built only from display components. It never
  renders Good, Review, Try it, Ship or a reply box. Rejected: disabling the live view's buttons, since one missed
  button could act on a finished lane.
- **Past views show the card's current data, not snapshots.** For example, the spec as it is now and the last plan.
  Snapshots, Try it's feedback rounds and the later lanes' proper artifacts are left for the next spec.
- **A landed card's spec isn't shown.** The worktree is gone, and the hive reads the spec only from there, so ✓ Spec
  on a Done card shows the spec's path on main. Reading it from the landed commit was deferred.
- **The board's Ideas field no longer adds a card.** Enter opens New idea with that project and the typed title,
  so every idea gets its text up front. Rejected: the field as the title alone, with the text left empty.
- **The brief's title still renames the card** in Refine. The title you typed is kept as `ideaTitle` and shown when
  looking back at Ideas. Cards from before this change get one from `titleFromIdea(ideaText)` when the hive starts.
- **A typed title has no length limit.** `titleFromIdea` used to cut a new card's title at 60 characters; now the
  title is what you type. Branch names are still cut at 40.
- **New idea takes the board field's title only for the form open at the time.** Every page has its own header and
  its own form, and the next page's form mounts before the old one's close has rendered. So a form ignores any preset
  made before it mounted, and leaving a page closes the form, as before the provider held it open.
- **The idea sits in the right-hand column,** both on a card in Ideas and looking back at Ideas, because the right
  is where every lane's artifact is. Looking back, the left says "No chat in this lane." In Ideas, the left stays
  empty. Rejected: the idea alone in the left column, as first built, which left the right half empty and didn't read
  as the lane's artifact.
- **The spec starts folded under its path, and the brief is no longer folded above it.** This revisits
  `2026-11-26-spec-and-plan-lanes`, which put the brief there. With ✓ Refine showing the brief, the fold only repeated
  it. Folded, the spec takes a click to read on every visit, even in Spec, where reading it is the job. That cost was
  weighed and accepted, to keep the review bar and the path in view. The fold is the same everywhere `SpecView`
  shows, not only in Spec.
- **An idea's tile opens its card now.** `CardTile` used to leave ideas unopenable, since their page showed only an
  empty chat and an empty brief. The card page's title row hides the badge in Ideas, as the board does.
- **Verified in a browser** on a scratch database, served from the built page on its own ports (4401/4402), clear of a
  running hive. Checked:
  - the board's field opening New idea;
  - adding an idea, and its tile;
  - editing and saving it;
  - looking back at Ideas and Refine from a Spec card, and Back to Spec;
  - ✓ Spec, Try it, Plan and Ship on a landed card;
  - links that aren't a finished lane falling through to the current lane;
  - 608/608px columns at 1440px wide;
  - PATCH refused outside Ideas, and on an empty title.
- **Not exercised for real: Start,** which would have started a product owner session. The tests cover it, saving
  first included.
- **Opening a card by its URL fails when the hive runs from a worktree under `.claude/`.** Express's `sendFile`
  refuses dot-folders, so `/cards/<id>` gives a 500 and only `/` loads. This is older than this change, so reload
  was checked by navigating inside the page instead.
- **Supersedes the history tab row** sketched in `docs/mockups/CardDone.dc.html`. The mockup is left as it is.
- **The even split the spec asks for landed on its own first,** as `2026-11-27-card-page-even-columns`. This change
  builds on it and doesn't change it.
