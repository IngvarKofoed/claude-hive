# Package CLAUDE.md files carry only what ARCHITECTURE.md doesn't

Each package CLAUDE.md now holds its tools, its commands as npm scripts, its test conventions
and its checks. Rules ARCHITECTURE.md already states are gone from them, since every session
loads that doc and a second copy drifts.

## Detail
- **Commands are the npm scripts** (`npm test`, `npm run typecheck`), never a bare `tsc`: the scripts generate
  `packages/shared/src/version.ts` first, and a bare `tsc` on a fresh checkout or worktree fails without it.
- **Dropped as restating ARCHITECTURE.md:** backend's safety bullets (127.0.0.1 only, uncommitted work, preview
  processes) and its `APP_VERSION` rule; frontend's token, CSS Modules, inline-style and `components/ui/` rules;
  shared's role report `status` rule. Narrows `2026-11-26-shared-package-claude-md`.
- **Kept because code comments cite them:** backend *Rules* (`hive.ts`), backend *Testing* (`sessions/types.ts`) and
  shared's type-change rule (`shared/src/index.ts`). Backend *Rules* now names `board/moves.ts` as where moves are decided.
- **Backend's folder list is gone:** it named `questions/`, `preview/` and `history/`, which don't exist yet, and
  missed `hive.ts`. The scope line names the entry points instead.
- **Dropped `frontend-design` from the frontend:** the skill picks a visual direction, and this page's look is
  fixed by the mockups and tokens.
- **Shared drops the test-framework line:** it has no test runner of its own and borrows its siblings' Vitest.
- The Agent SDK rule stays as `2026-11-26-agent-sdk-reference-rule` set it.
