# Spec issues are judged in one batch once Check passes

Issues from Build and Check now collect on the card and go to the spec keeper together, in one batch once Check
passes, instead of one batch at the end of Build and another after Check. A blocking issue is still judged at once.
Any `code-wrong` verdict sends the card to Plan for one amendment. Otherwise it goes on to Try it as built, where a
`changes-signoff` question waits for you, with the keeper's verdict as the recommendation.
This is what makes "about one batch per card" in `2026-11-26-no-session-copies` hold.

## Detail
- Rejected two batches (after Build and after Check): at least two spec keeper turns per card, and Check's
  reviewer often re-reports what Build already noted.
- Accepted cost: when Build finds an issue where the code is wrong, Check still runs a full round, reviewer and
  tester, on code that will change before the card moves on.
- A Check round that fails sends the card back to Build without a batch. Its spec issues wait on the card for the
  round that passes.
- Removed "the build carries on with 'keep as built' until you answer": with judging after Check there is no
  build left to carry on. A `changes-signoff` question now offers "keep it as built" or "change the code", and
  "change the code" sends the card to Plan.
- More than one batch still happens: a "code is wrong" verdict loops the card through Plan, Build and Check,
  and that round's new issues form another batch.
