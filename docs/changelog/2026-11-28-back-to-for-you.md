# Back to For you after a lane action

When you open a card from a For you entry, any lane action but Stop takes you back to For you once the server
accepts it. The list you land on has already reloaded, so the card has dropped off it, or shows its new entry.
Opened from the board or a typed address, the card page behaves as before. This builds on the shared lane actions
of `2026-11-28-lane-actions`. Spec: `docs/specs/2026-11-28-back-to-for-you-after-a-lane-action.md`.

## Detail
- **"Opened from For you" is React Router location state** (`{ from: "for-you" }`, `components/fromForYou.ts`), set
  by the entry's link. It's the first use of location state in the page. Rejected a `?from=for-you` query parameter,
  which a copied link would carry, and which the lane strip's `?lane=` links would have to merge. Also rejected an
  in-memory flag in `ForYouProvider`, which is lost on reload and is cleared by StrictMode's double effect run at mount.
- **Only the card page's own links pass the state on:** the lane strip and "Back to *lane*". The header, the board and
  a typed address start a history entry without it. A reload of the card page, or browser Back to it, keeps it.
- **`LaneSteps` takes the state as a prop (`linkState`)** rather than calling `useLocation()`, because `CardTile`
  renders `LaneSteps compact` and `CardTile.test.tsx` renders it outside any router, where the hook would throw.
- **Components report, the Card page decides.** `useLaneActionDone()` in `components/laneActions.ts` is a context the
  Card page provides around `LaneView`. Each component calls it after a lane action's call succeeds, Stop included,
  and never after a refusal. The page holds the one rule: from For you, not Stop, and the page still shows the card
  the press was made on (a ref cleared on unmount). Outside the Card page it does nothing, so For you's own buttons
  and the components' own tests are unchanged. A lane action added later only has to report itself.
- **Mockup's Good · keep and Good · don't keep, and Refine's Good · skip to Spec, also report.** The spec's table of
  components predates the Mockup lane and doesn't list `MockupBar`.
- **`ForYouValue.reload()` now returns a promise** that resolves once the newest load has settled. A load overtaken
  by a newer one (the action's own `card.updated` usually starts one) settles with that newer load, not on its own
  stale response, so the list the card page waited for is the one For you shows. It never rejects: a failed reload
  still navigates, and For you shows its error. `ForYouEntry` still calls it without awaiting.
- **Going back is a push to `/for-you`,** not `navigate(-1)` or a replace. Browser Back from For you returns to the card
  you acted on, still remembering For you.
- **Verified in the browser** on a scratch database with the real Hive and API on the fake session runner from
  `packages/backend/src/testing.ts`. No real Claude session ran. All five How-to-verify bullets were driven. For
  bullet 1 it pressed Good · skip to Spec, so the spec writer starts. The cards in Try it and Ship were placed
  straight in their lanes in the scratch database. Error-line actions, Sign off, Send to Build, Discard them and land
  and Back to Try it were covered only by `pages/Card.test.tsx`, not in the browser.
