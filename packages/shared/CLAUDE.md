# Claude Hive — shared

The types the backend and frontend both use: API bodies, SSE events and role reports. See `docs/ARCHITECTURE.md` for the broader context.

Contents: `src/` with the shared types, and `src/version.ts`, generated at build time.

## Required tools

- **`LSP`** — the TypeScript language server (`typescript-lsp` plugin). Use it to find every reference to a type in `packages/backend` and `packages/frontend` before you change it.

## Testing

The package holds types, so the check is a type check: run `tsc --noEmit` here and in both packages that use the changed type. Runtime code added here, such as a type guard, gets a Vitest test next to it as `*.test.ts`, like the other packages. Do not introduce a different test framework without updating the architecture doc.

## Rules

- **A type change lands in all three packages at once.** A change to an API body, SSE event or role report type here must be followed through in both backend and frontend in the same change.
- **Only what both sides use.** A type that only the backend or only the frontend needs lives in that package.
- **Every role report type keeps its `status` (`done` or `blocked`) and reason.** A session that can't fill in a field otherwise makes up a value that passes the schema (`docs/ARCHITECTURE.md`, Role reports).
- **`src/version.ts` is generated and git-ignored.** `scripts/gen-version.mjs` writes `APP_VERSION` into it at build time, so never edit or commit it (`docs/ARCHITECTURE.md`, Versioning).
