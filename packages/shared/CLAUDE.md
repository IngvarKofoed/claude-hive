# Claude Hive — shared

The types the backend and frontend both use: API bodies, SSE events and role reports, plus the generated `src/version.ts`.

## Required tools

- **`LSP`** — the TypeScript language server (`typescript-lsp` plugin). Use it to find every reference to a type in `packages/backend` and `packages/frontend` before you change it.

## Testing

The package holds types, so the check is a type check: run `npm run typecheck` at the repo root, which checks all three packages. The scripts generate `src/version.ts` first; a bare `tsc` on a fresh checkout fails on the missing file. Runtime code added here, such as a type guard, gets a Vitest test next to it as `*.test.ts`, run with `npm test`.

## Rules

- **A type change lands in all three packages at once.** A change to an API body, SSE event or role report type here is followed through in both backend and frontend in the same change.
- **Only what both sides use.** A type that only the backend or only the frontend needs lives in that package.
- **Never edit or commit `src/version.ts`.** It's generated and git-ignored.
