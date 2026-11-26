# Claude Hive — backend

The Node/Express backend: it runs every Claude session through the Claude Agent SDK, moves cards between lanes, and serves the page. See `docs/ARCHITECTURE.md` for the broader context.

Contents: `src/server.ts`, `routes/`, `board/`, `sessions/`, `questions/`, `spec/`, `git/`, `preview/`, `history/`, `db/`.

## Required tools

- **`LSP`** — the TypeScript language server (`typescript-lsp` plugin). Use it for definitions, references and hover instead of grepping for symbols.
- **Agent SDK reference** — before writing or changing code that calls the Claude Agent SDK (`query()` options, `canUseTool`, `resume`, `outputFormat`, plan usage), check the option or callback in the SDK's own type definitions in the installed package, or ask the built-in `claude-code-guide` agent, which covers the Agent SDK. Its options change between releases, so don't write them from memory.

## Testing

Vitest. Tests sit next to the code they test, as `*.test.ts`. Do not introduce a different test framework without updating the architecture doc.

- **Tests never call the real Claude API.** The session runner sits behind an interface, and tests replace it with a fake that yields scripted SDK messages, questions and reports.
- **Tests never touch a real project repo.** Git service tests create a throwaway repo in a temporary folder.
- **The board engine is plain code and is fully unit tested.** Every row of the Card Moves table in `docs/ARCHITECTURE.md` has a test, and so do the round limits and the loop guard.

## Rules

- **Plain code routes; Claude sessions judge.** Card moves are decided in `board/` from the fields of a role's report, never by reading prose or asking a model.
- **Safety, from `docs/ARCHITECTURE.md`:**
  - the backend binds to `127.0.0.1` only;
  - it never edits files in a project's own checkout; at Ship it only fast-forwards main and pushes;
  - the preview service only ever stops processes it started itself.
- **The version is `APP_VERSION` from `packages/shared`,** baked in at build time by `scripts/gen-version.mjs`. Never call git at runtime to find it (`docs/ARCHITECTURE.md`, Versioning).
- **Verify every change** by running the package's tests and a type check (`tsc --noEmit`) before you report it complete.
