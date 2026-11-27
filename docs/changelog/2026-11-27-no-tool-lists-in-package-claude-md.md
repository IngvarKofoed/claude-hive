# Package CLAUDE.md files hold only what a session can't see for itself

The three package files have no description line and no *Required tools* section. Their Testing sections
name what tests must never touch and what stands in for it, plus the type check that `npm test` doesn't
run. The frontend's browser check starts the app on a scratch database and stops to ask when another
hive already holds its ports. Written by the scaffold skill's audit.

## Detail
- **Every line passes one test:** would a session that has read `ARCHITECTURE.md`, the manifest and the
  folder act differently without it. Dropped as failing it: the description lines, the framework names,
  "tests sit next to the code", "run `npm test`", "don't introduce a different test framework", the
  `rules.test.ts` bullet (the test enforces the rules by itself, `2026-11-26-frontend-style-rules-test`)
  and shared's `version.ts` rule (ARCHITECTURE already says it's generated and git-ignored).
- **New never-touch lines:** backend tests never open the user's hive data (`HiveDb(":memory:")` or a temp
  file, `makeSpecFormat()`); frontend tests never reach a running backend (they mock `api/client.ts` and
  `api/events.ts`).
- **Tools:** `LSP` is gone from all three, since a session has every installed tool; a preference for
  LSP over grep belongs in the user's own `~/.claude/CLAUDE.md`. Playwright MCP stays named in the
  browser check that uses it. Reverses the tool lists kept by `2026-11-26-claude-md-current-rules-only`.
- **The Agent SDK rule stays, as a rule** under backend's *Rules* (`2026-11-26-agent-sdk-reference-rule`).
- **Kept because code comments cite them:** backend *Rules* (`hive.ts`), backend *Testing* (`sessions/types.ts`)
  and shared's type-change rule (`shared/src/index.ts`).
- **The browser check** applies to a change to what the page shows or does, not to every UI change. It
  makes no claim that Playwright runs headless.
- **Known gap, ports:** Vite's `/api` proxy is fixed to 4317 in `vite.config.ts`. With another hive on
  4317, the dev backend can't bind and the page reaches that hive despite `HIVE_DB`, so the check asks
  the user first. Closing it needs the Vite config to read `HIVE_PORT` and `HIVE_DEV_PAGE_PORT`, which is
  app code. A project added to the scratch board still starts real Claude sessions.
- **Not verified:** the `HIVE_DB` start command was checked by reading `server.ts` and `db/index.ts`, not
  run. The `lsof` port check was run on this machine and lists the two listening processes.
- **Open mismatch, not touched:** ARCHITECTURE calls `server.ts` the Express app; in the code `app.ts` is,
  `server.ts` starts it, and `hive.ts` isn't in the doc's project structure.
- Narrows `2026-11-26-package-claude-md-own-rules`.
