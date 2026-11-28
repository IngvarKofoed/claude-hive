# Back to For you after a lane action

When you work down For you and open a card to deal with it, pressing a lane action on the card page now takes you
straight back to For you once the action succeeds, so the next thing waiting is one glance away. The card page
remembers that it was opened from a For you entry in the browser's history entry (React Router's location state),
and keeps that memory while you look back at finished lanes. Every card-page component that presses a lane action
reports it to the page, and the page alone decides: opened from For you, and anything but Stop, means back to For you.
It's a page-only change: no route, event or server guard moves.

## Outcome

**What you get:**

- On a card you opened from For you, every lane action but Stop takes you back to For you once the server accepts
  it: Refine's Good · on to Mockup and Good · skip to Spec, Mockup's Good · keep in docs/mockups and Good · don't
  keep, Review, Sign off, Retry, Back to Spec, Back to Build, Move on, Send to Build, Accept, Land on main, Discard
  them and land and Back to Try it.
- The list you land on is already fresh. The card has dropped off it, or is still on it with its new entry if it
  still needs you.
- Stop, a refused action, chatting, answering a question and Try it's app controls keep you on the card, as today.
- A card opened from the board or a typed address behaves exactly as today.

**How to verify:**

- With a Refine card waiting for your reply, open it from For you with **Open the chat** and press **Good · skip to
  Spec**. The page is For you, and the card isn't listed while the spec writer works.
- Open a Spec card from For you, look back at Refine through the lane strip, return with **Back to Spec**, and press
  **Review**. You land on For you, and the entry is gone while the review runs.
- Open a Try it card from For you with **Try it** and press **Accept**. You land on For you, with the card listed as
  "Ship · land on main".
- Open a Ship card from For you, then create an untracked file in its worktree and press **Land on main**. The
  server refuses ("uncommitted work"), the error shows on the card page, and you stay there.
- Open the same kind of Refine card from the board and press **Good · skip to Spec**. You stay on the card page, now
  in Spec.

## Key decisions

- **"Came from For you" lives in the history entry** (new). The For you entry's link passes React Router location
  state `{ from: "for-you" }`, and the card page reads it with `useLocation()`. It's the first use of location state
  in the page. It doesn't show in the URL, so a typed or pasted address never has it and the board never sets it,
  while a reload of the card page or browser Back to it keeps it.
- **The card page's own links carry it forward** (extends). The lane strip's links in `LaneSteps` and the "Back to
  *lane*" link in `pages/Card.tsx` pass the current location's state along. So looking back at a finished lane keeps
  the memory, and any other way of reaching the card drops it.
- **Components report every lane action, and the page decides** (new). A context in `components/laneActions.ts`
  gives each component a `laneActionDone(id)` to call after a lane action's call resolves, Stop included. The Card
  page provides it and holds the one rule: from For you, and not Stop. Outside the Card page it does nothing, the
  way `useForYou` is empty and quiet outside its provider. So For you's own buttons and component tests are
  unchanged.
- **The list is reloaded before you land on it** (extends). `ForYouValue.reload` returns a promise that resolves
  only once the newest load has settled, even when a later load supersedes the one it started. The card page
  awaits it, then navigates, so For you never shows the card's old entry for a moment. It's the same reload
  `ForYouEntry` already calls after a press, for the same reason: the response can arrive before the event does.
- **A plain push to `/for-you`** (reuses). The card page calls `navigate("/for-you")`, which adds a history entry. So
  browser Back returns to the card you just acted on, still remembering For you.
- **No server change** (reuses). Every action posts to the same route as today, and the server's guards still
  decide. A refused action never navigates, because navigation waits on the call's success.

## Goals

- Working down For you takes one click per card on the card page, not two.
- One place in the page decides when an action takes you back, so a lane action added later only has to report
  itself.

## Non-goals

- Doing the same for cards opened from the board.
- A "Back to For you" link, or any note on the card page or For you about what just happened.
- Changing which actions For you offers, or how its entries look.
- Delete: it's a card control, and keeps going to the board.
- Start: an idea is never on For you, so `IdeaPanel` isn't touched.
- Any change to the server, its routes, events or card moves.

## Design

### Remembering For you

`ForYouEntry`'s link (Open the chat, Try it, Open the card) gets `state={FROM_FOR_YOU}`. A small module,
`components/fromForYou.ts`, exports that constant and `cameFromForYou(state: unknown): boolean`, so the shape is
written once and an unknown state reads as false.

On the card page, the links that stay on the same card pass `state={location.state}`: the lane strip's links in
`LaneSteps` (only on the card page, where it's `navigable`) and "Back to *lane*" in the looking-back line.
Everything else (the header, the board, a typed address) starts a history entry without the state, which is the
"any other way" in the brief.

The memory belongs to the history entry, not to the card. Back on For you, opening the same card again from the
board gives it no memory. Browser Back to the card you acted on gives it the memory again, because that entry still
has it.

### Reporting a lane action

`components/laneActions.ts` gains a context and its hook:

```ts
const LaneActionDone = createContext<(id: LaneActionId) => void>(() => {});
export const LaneActionDoneProvider = LaneActionDone.Provider;
export function useLaneActionDone(): (id: LaneActionId) => void;
```

Each component calls it with the action's id after the call resolves, next to its existing success handling
(`onMoved()`, clearing the feedback box), and never on failure:

| Component | Reports |
| --- | --- |
| `GoodBar` | whichever Good was pressed: good (on to Mockup) or skip-mockup (skip to Spec) |
| `MockupBar` | whichever Good was pressed: keep or dont-keep |
| `ReviewBar` | review, signoff |
| `Chat` | whichever action the error line's button pressed (retry, review, back-to-spec, back-to-build, move-on), with that action's id; the footer's stop |
| `TryItPanel` | retry, send-to-build, accept |
| `ShipPanel` | land, discard-and-land, back-to-tryit |

`PendingCard` (answering), `Chat`'s Send, and `TryItPanel`'s app and setup buttons report nothing: they aren't lane
actions. `ForYouEntry` reports nothing either. It's already on For you, and it sits outside any provider.

### Going back

`Card` provides `LaneActionDoneProvider` around `LaneView` with a callback that does nothing unless all three hold:

- the location state says it came from For you;
- the action isn't Stop;
- the page still shows the card the press was made on.

Then it awaits `useForYou().reload()`, makes the third check again, and only then calls `navigate("/for-you")`. The
third check is a ref holding the card id the page shows, cleared on unmount. A press whose answer, or whose reload,
arrives after you've gone to another page or card does nothing, so a slow response never pulls you away from where
you went.

`reload()` resolves only once the newest load has settled. A load that a newer one supersedes returns early without
setting the items (`mine !== counter.current` in `ForYouProvider.load`), and the action's own `card.updated` event
usually starts such a newer load right around the response. So `load` keeps its in-flight promise, and a superseded
call awaits the latest one instead of resolving early. The list the card page waited for is then the one For you
shows.

`reload()` already catches its own errors, so a failed reload still navigates. For you then shows its own error, as
it does today. `ForYouEntry`'s call to `reload()` stays as it is, without awaiting.

### Docs this changes

- **`CONCEPT.md`, The Page:** the For you bullet adds that a card opened from an entry takes you back to For you
  after any of its lane actions but Stop.
- **`ARCHITECTURE.md`, Lane Actions:** one sentence that the card page's components report each lane action they
  press, and the Card page goes back to For you when its location state says it was opened from there.
- **A changelog entry,** `docs/changelog/2026-11-28-back-to-for-you.md`, citing `2026-11-28-lane-actions`.

## Open questions

- **Q:** Should a reload of the card page keep the memory? **Default:** yes. The browser keeps a history entry's
  state across a reload, and it's still the same visit from For you.
- **Q:** Should going back replace the card's history entry instead of pushing a new one? **Default:** push. With
  replace, browser Back from For you lands on For you again and seems to do nothing.
- **Q:** Should the card page hint that a lane action will take you back? **Default:** no. Refine settled on no
  note and no back link, and the page stays as it is.

## Alternatives considered

- **A query parameter, `?from=for-you`.** Rejected: it shows in the URL and is copied along with it, so a pasted
  link would behave differently from a typed one. The lane strip's `?lane=` links would also have to merge it.
- **An in-memory flag in `ForYouProvider`.** Rejected: it's lost on reload, needs clearing when you leave the card,
  and StrictMode's double run of effects in development clears it at mount.
- **A prop threaded through `LaneView`.** Rejected: `Chat` sits in six lane layouts and holds `GoodBar` in its send
  row, so the prop would pass through every one of them. The context keeps the rule in one place with fewer edits.
- **`navigate(-1)`.** Rejected: it's wrong after the lane strip has added entries, and when the card was opened in a
  new tab.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.5.** About nine small frontend edits on one path, all hanging off the new context and the
  location state, which have to be settled first. A delegated chunk would be a one-line call per component, cheaper
  to write than to brief.

## Amendments

- 2026-11-28: The component table now gives `GoodBar` both of Refine's Goods (good, skip-mockup) and adds `MockupBar` (keep, dont-keep), and the Outcome's list names those four buttons. The Mockup lane came in from main after the spec was written, and the brief's rule is every lane action but Stop.
- 2026-11-28: The first and last How-to-verify bullets press **Good · skip to Spec**, not **Good**. Since the Mockup lane, Refine has no button called just Good, and only skip to Spec starts the spec writer the first bullet checks for.
