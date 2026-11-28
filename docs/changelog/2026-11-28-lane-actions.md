# Lane actions: one definition the card page and For you both read

What you can do to a card in a lane is now one definition, `laneActions` in `packages/shared`: each lane's actions,
when each is offered, whether it's enabled and why not. The card page and For you both read it, so they can't
disagree. For you entries now have their lane's buttons, except Try it's, and Land on main there asks first.
Spec: `docs/specs/2026-11-28-for-you-actions.md`.

## Detail
- **Revisits `2026-11-27-for-you`:** answering no longer stays with the card page. Good, Review, Sign off, an error
  line's Retry, Back to Spec, Back to Build and Move on, and Ship's Land on main and Back to Try it are pressed on the
  list. Question and permission entries, and every card in Try it, still have no buttons.
- **An older error line loses its buttons** on the card page. Only the lane's last chat line offers its actions,
  which is the rule the server already applied. Spec's "Review again" on an error line now reads "Review", the
  action's one label. Error-line buttons are now greyed while a turn runs; before, they were always enabled and the
  server refused.
- **Ship's Retry is left off For you.** It starts the landing over without asking, while Land on main in the same
  entry confirms first. It stays on the card page's error line.
- **The list never reads a Ship card's plan:** that needs git on every reload of the header count, and git changes
  send no event. So Land on main is always enabled on the list, and the confirm row reads `GET /api/cards/:id/ship`
  and greys it there.
- **`LANE_ACTION_CALLS` moved to the lead's chunk** (`components/laneActions.ts`), out of the For you chunk the spec
  named, because Chat's error lines need it too and the two chunks ran in parallel.
- **`addError` is typed by lane** (`LaneErrorAction<L>`), so a literal lane rejects an action its lane doesn't list.
  Calls whose lane is a variable (`session.lane`, `keeperFailed`) aren't checked by the type;
  `errorActions.test.ts` checks those lanes at runtime. A new error action must go into its lane's `LANE_ACTIONS`.
- **Review's reason while the blind reviewer runs** reads "Wait for the spec writer to finish", because the spec's
  table checks a running turn first. It only shows as the button's title on the card page; a reviewing card isn't on
  For you.
- **Verified in the browser on a fake session runner,** with the real Hive and API seeded with a Refine, Spec,
  blocked Build and Ship card. No real Claude session ran. After Back to Spec, the developer's reason goes to the
  spec writer as its turn's message, as before this change, so the page shows it only once the spec writer replies.
