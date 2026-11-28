# Mockup lane and designer role

Refine's Good now offers "on to Mockup" or "skip to Spec". In Mockup a designer session makes the mockup as plain HTML
pages in `docs/mockups/<card>/`, or you paste a Claude Design link, and it names the current one with the new
`set_mockup` hive tool. The hive serves the folder itself, sandboxed. Good either commits the folder on the card's
branch or leaves nothing there, and the spec writer is told the Mockup chat and where the mockup is. The `implemented`
lane flag is gone: every lane now exists.

## Detail
- **Revisits `2026-11-27-mockups-designers-call`:** a mockup is no longer "in the app, or a page of its own". It's
  always pages in the card's folder, never inside the app, or a link to a mockup made elsewhere.
- **Settles `2026-11-27-card-lane-artifacts`'s skip:** a skip is `Card.mockup` null. There are still no lane-visit
  records, and every card that predates this change shows "– Mockup".
- **`Origin: null` is let through the local-only guard** for `GET` and `HEAD` of `/api/cards/<id>/mockup/…` only. A
  sandboxed page's module scripts, fonts and `fetch()` send `Origin: null`, which `localOnly` refused, so the spec's
  `Access-Control-Allow-Origin: *` alone didn't make them work. The Host check still applies, and any other foreign
  Origin is still refused. The page's scripts still can't read the hive's API: an opaque origin gets no CORS header
  anywhere else.
- **An unkept mockup is deleted at sign-off, after the spec commit.** Build's checkpoint (`git add -A`) would otherwise
  commit it. A failed delete refuses sign-off, and the spec commit simply finds nothing staged on the next try. Keep it
  after all, in Spec, commits the folder alone and starts no turn, so the review isn't touched.
- **The served files are confined twice:** a dot segment is refused before any disk read, and the file's real path
  must lie inside the folder's real path. `sendFile` gets that real folder as `root`, since every worktree sits under
  `.claude/` and `sendFile` refuses an absolute path through a dot-folder.
- **`set_mockup` stores the page as its real path in the folder,** so a `..` in what the designer sent never reaches
  the card. A symlinked file or folder in the mockup is neither listed in `files` nor followed when listing.
- **`enterSpec` now loads the spec writer's role before the move,** like the spec format, so Keep can't commit and
  then fail to start Spec.
- **Mockup's lane actions** (`2026-11-28-lane-actions`, which left Mockup's list empty for this card): Refine has
  `good` ("Good · on to Mockup") and `skip-mockup` ("Good · skip to Spec"); Mockup has `keep` ("Good · keep in
  docs/mockups"), `dont-keep` ("Good · don't keep"), Retry and Stop. Keep is greyed with the server's own refusals,
  so For you and the card page offer the same two choices. GoodBar and MockupBar render from the shared definition.
- **Still future work:** versions and their worktrees, the ◆ badge, pinned comments, the mockup framed in the card
  page, the screenshot at Good, look feedback from Try it going back to Mockup, and the tester comparing screens.
- **Verified:** 30 new backend tests in `mockup.test.ts` and 4 route tests in `app.test.ts`, with real git for Keep's
  commit and sign-off's delete. In a browser on a scratch database beside the running hive: the Mockup panel's link
  opened the page in a new tab with its module script and CSS loaded in an opaque origin; `fetch('/api/board')` from it
  was blocked; an edit showed after a reload; Keep was disabled before a mockup was named; the link hint showed;
  Keep it after all committed only the folder and added its note; a skipped card's "– Mockup" wasn't a link.
- **Not covered:** a real designer session on Opus (every turn ran on the fake runner), a real Claude Design link and
  its exports, and pressing Good in the browser, since it starts real sessions.
