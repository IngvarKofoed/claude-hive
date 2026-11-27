# Claude Hive — backend

## Testing

`npm test` doesn't type-check: also run `npm run typecheck` here, not a bare `tsc`, which skips generating `packages/shared/src/version.ts`.

- **Tests never call the real Claude API.** The session runner sits behind an interface, and tests use the fake in `testing.ts`, which yields scripted SDK messages, questions and reports.
- **Tests never touch a real project repo.** Git service tests create a throwaway repo in a temporary folder, also from `testing.ts`.
- **Tests never open the user's hive data.** The database is `new HiveDb(":memory:")` or a file in a temp folder, and the spec format comes from `makeSpecFormat()` in `testing.ts`, never `~/.claude-hive/` or `~/.claude/skills/spec-format/`.
- **Every row of the Card Moves table in `docs/ARCHITECTURE.md` has a test,** and so do the round limits and the loop guard.

## Rules

- **Card moves are decided in `board/moves.ts`,** from the fields of a role's report, never by reading prose or asking a model.
- **Check an Agent SDK option before you write a call to it.** Before writing or changing code that calls the Claude Agent SDK (`query()` options, `canUseTool`, `resume`, `outputFormat`, plan usage), look the option or callback up in the SDK's own type definitions in the installed package, or ask the built-in `claude-code-guide` agent. The options change between releases, so don't write them from memory.
