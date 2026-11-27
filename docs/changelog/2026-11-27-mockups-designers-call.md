# Mockups are the designer's call, and the HIVE-MOCK marker is gone

The docs no longer say how a mockup is made, or that its code becomes the start of the build. With that, the
`HIVE-MOCK` fake-data marker is gone: Check doesn't search for it, Ship's re-run of the checks is only the project's
test command, and the developer isn't told about it.

## Detail
- **Why:** the marker existed only because the docs had the mockup built in the real app, with made-up values, on
  the card's branch. A mockup made as a page of its own leaves nothing in the branch to mark, and the hive shouldn't
  depend on which kind the designer picks.
- **What catches a made-up value now:** Check's reviewer, as a bug against the spec (`2026-11-27-check-lane-reviewer`).
- **Revises** `CONCEPT.md`'s "The Mockup Becomes the Build", now a short "Mockups" section, and the marker search in
  `2026-11-26-ship-squash-then-push`'s re-run of the checks.
- **Left for the Mockup spec:** versions, their worktrees, the ◆ badge, picking a version, and commenting by
  clicking on the mockup. Only what told the designer how to build a mockup went.
- **Changed:**
  - `CONCEPT.md`: the Mockup, Build and Check rows, the Mockups section, and Ship's step 2;
  - `ARCHITECTURE.md`: the git service, the project tree, the designer's row in Roles, and the Check and Ship rows of
    the Git table;
  - `roles/developer.md`;
  - the mockup pages `CardTryIt`, `CardMockup` and `CardDone` in `docs/mockups/`.
