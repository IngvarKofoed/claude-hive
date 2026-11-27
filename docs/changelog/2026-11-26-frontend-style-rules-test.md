# Frontend token rules are a test: npm test fails on inline styles and raw values

`src/styles/rules.test.ts` scans every stylesheet and component. An inline style, or a raw color,
pixel font size or font name outside `tokens.css`, fails `npm test`. It replaces a diff search the
frontend CLAUDE.md asked each session to do by hand, so the hive's own builders are held to it too.

## Detail
- **Checks only what `docs/ARCHITECTURE.md` names:** hex and functional colors (`rgb()`, `hsl()`, `oklch()`, …),
  `px` in `font-size` / `font`, and a `font-family` not set from a token. Known gap: raw spacing, radii and
  shadows aren't checked, though ARCHITECTURE puts them in `tokens.css` too.
- **Files are read with `import.meta.glob(…, { query: "?raw" })`,** because the frontend's TypeScript has no Node
  types. Vitest's `css` option now lets `?raw` reads through; every other stylesheet import stays empty in tests.
- **Rejected Stylelint:** a new dependency and config for four checks one test file does, and it would only run
  where someone wires it in, while `npm test` already runs everywhere.
- **Verified:** a planted `color: #ff0000` in a new module stylesheet failed the test with its path. The full
  frontend suite and the type check pass. Builds on `2026-11-26-css-design-tokens`.
