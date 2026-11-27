# Role prompts: each role's instructions and what its sessions get, read-only in the page

A ☰ menu at the end of the header opens **Role prompts** (`/roles`, `/roles/<name>`). It lists every role file in
`roles/`, read on each request, and the roles the docs plan that have no file yet. Under each role's instructions it
shows what its sessions also get: the path of an appended spec-format file, the fields of its report, and its hive
tools. Spec: `docs/specs/2026-11-27-role-prompts-page.md`; look: `docs/mockups/HeaderMenu.dc.html` and
`docs/mockups/RolePrompts.dc.html`.

## Detail
- **`ROLE_TURNS` in `hive.ts`** is now the only place that says which roles get `format.md`, a report schema or hive
  tools. It replaced the `turnOptions()` switch, the role-name check in `startTurn()`, the inline `COMMIT_SCHEMA` in
  the committer's turn, and the hard-coded `format.md` in `good()`. Session behaviour is unchanged, and the existing
  tests that assert each role's schema, tools, `persist` and `format.md` still pass. `persist: false` (spec reviewer)
  and `background` (setup) stay in `turnOptions()`: no session is told about them, so the page doesn't show them.
- **Hive tool definitions moved** from `sdkRunner.ts` to the SDK-free `sessions/hiveTools.ts` (`HIVE_TOOLS`), so the
  roles endpoint describes them without loading the SDK. A tool's inputs reach the page through `z.toJSONSchema` of
  the same zod shape the SDK tool is built from.
- **`PLANNED_ROLES` in `sessions/roles.ts` is temporary**, like `implemented: false` in `LANES`. The slice that writes
  `designer.md`, `tester.md` or the manager's file removes its entry. A file of the same name already wins, and a test
  fails while a planned name has a file.
- **`parseRole` now keeps the front matter's `lane:`.** Only the page reads it. A role whose lane is missing or
  unknown is listed under "Across lanes", and so is a file that can't be parsed, since it has no lane to read.
- **`HiveDeps.listRoles` is optional.** Without it there are no role files, so existing tests that build a `Hive`
  needed no change. `server.ts` passes the real one.
- **Two departures from the spec, asked for after trying the page:** the list shows only each role's name, with no
  "model · kind · + extras" meta line (a planned role still says "Not written yet", and a broken one its error). And
  the note that the instructions are added to the end of Claude Code's own system prompt sits once under the page's
  subtitle, not at the top of every role's panel. The mockup was changed to match; the spec wasn't.
- **The page reads once when it opens.** There's no SSE event for a changed role file, so after an edit you reload.
- **Rejected:** showing `format.md`'s text (it belongs to the spec-format skill and is long), bundling `roles/*.md`
  into the frontend at build time (the built page would go stale after an edit), showing raw JSON schema, and a plain
  nav link instead of the menu.
- **Not checked:** a `☰` menu with more than one entry, and the page at phone width. The mockup's menu and list are
  sized for 1440px.
