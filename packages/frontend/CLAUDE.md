# Claude Hive — frontend

The React page (Vite): the board, For you, and the card pages. The look comes from `docs/mockups/`.

## Required tools

- **`LSP`** — the TypeScript language server (`typescript-lsp` plugin). Use it for definitions, references and hover instead of grepping for symbols.
- **Playwright MCP** (`mcp__playwright__*`, headless) — drive the page in a real browser to verify every UI change (see the verification workflow below).

## Styling

- **The look is the mockup.** Before building a screen, read its `.dc.html` in `docs/mockups/` and the token table in `docs/mockups/README.md`.
- **`src/styles/rules.test.ts` enforces the token rules** in `docs/ARCHITECTURE.md` (Frontend): `npm test` fails on an inline style, or on a raw color, pixel font size or font name outside `tokens.css`.

## Testing

Vitest, with React Testing Library for components. Tests sit next to the code they test, as `*.test.tsx`. Run `npm test` and `npm run typecheck` here before you report a change complete. Do not introduce a different test framework without updating the architecture doc.

## Verification workflow

For every UI change:

1. Start the app with `npm run dev` at the repo root, which runs the backend and the frontend.
2. Drive the changed feature via Playwright MCP — headless, so rely on the page snapshot, not a visible window.
3. Check console messages and network requests for errors.
4. Only then report the change as complete.
