# Claude Hive — backend

The Node/Express backend: it runs every Claude session through the Claude Agent SDK, moves cards between lanes, and serves the page. `hive.ts` ties projects, cards, moves and sessions together; `app.ts` is the Express app and `server.ts` starts it.

## Required tools

- **`LSP`** — the TypeScript language server (`typescript-lsp` plugin). Use it for definitions, references and hover instead of grepping for symbols.
- **Agent SDK reference** — before writing or changing code that calls the Claude Agent SDK (`query()` options, `canUseTool`, `resume`, `outputFormat`, plan usage), check the option or callback in the SDK's own type definitions in the installed package, or ask the built-in `claude-code-guide` agent, which covers the Agent SDK. Its options change between releases, so don't write them from memory.

## Testing

Vitest. Tests sit next to the code they test, as `*.test.ts`. Run `npm test` and `npm run typecheck` here before you report a change complete. Do not introduce a different test framework without updating the architecture doc.

- **Tests never call the real Claude API.** The session runner sits behind an interface, and tests use the fake in `testing.ts`, which yields scripted SDK messages, questions and reports.
- **Tests never touch a real project repo.** Git service tests create a throwaway repo in a temporary folder, also from `testing.ts`.
- **Every row of the Card Moves table in `docs/ARCHITECTURE.md` has a test,** and so do the round limits and the loop guard.

## Rules

- **Card moves are decided in `board/moves.ts`,** from the fields of a role's report, never by reading prose or asking a model.
