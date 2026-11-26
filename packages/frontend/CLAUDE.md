# Claude Hive — frontend

The React page (Vite): the board, For you, and the card pages. See `docs/ARCHITECTURE.md` for the broader context, and `docs/mockups/` for the look.

Contents: `src/styles/` (`tokens.css`), `pages/`, `components/ui/`, `components/`, `api/`.

## Required tools

- **`LSP`** — the TypeScript language server (`typescript-lsp` plugin). Use it for definitions, references and hover instead of grepping for symbols. It is a deferred tool: load it with `ToolSearch` `select:LSP` before the first call.
- **Playwright MCP** (`mcp__playwright__*`, headless) — drive the page in a real browser to verify every UI change (see the verification workflow below). The tools are deferred: load the ones you need with `ToolSearch`, e.g. `select:mcp__playwright__browser_navigate,mcp__playwright__browser_snapshot,mcp__playwright__browser_click,mcp__playwright__browser_console_messages`.
- **`frontend-design`** skill — invoke it when building a new screen or component, within the look the mockup already sets.

## Styling

The CSS must stay easy to restyle. These rules are not optional:

- **The look is the mockup.** Before building a screen, read its `.dc.html` in `docs/mockups/` and the token table in `docs/mockups/README.md`.
- **Raw values live only in `src/styles/tokens.css`:** colors, fonts, font sizes, spacing, radii and shadows, as CSS custom properties named by role (`--color-needs-you-bg`, not `--orange-100`).
- **Components use CSS Modules,** one `.module.css` next to each component, with `var(--…)` tokens only.
- **No inline styles** and no style objects in TSX. A state that changes the look is a class or a `data-` attribute the CSS selects on.
- **Build pages from `components/ui/`** (button, badge, panel, chip, chat bubble) rather than restyling plain elements.
- **Check before you report a UI change complete:** search your diff for `style=` and for hex colors or `px` font sizes outside `tokens.css`. Any hit is a bug to fix first.

## Testing

Vitest, with React Testing Library for components. Tests sit next to the code they test, as `*.test.tsx`. Do not introduce a different test framework without updating the architecture doc.

## Verification workflow

For every UI change:

1. Start the dev server.
2. Drive the changed feature via Playwright MCP — headless by default, so rely on the page snapshot, not a visible window.
3. Check console messages and network requests for errors.
4. Only then report the change as complete.
