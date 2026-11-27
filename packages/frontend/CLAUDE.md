# Claude Hive — frontend

## Styling

- **The look is the mockup.** Before building a screen, read its `.dc.html` in `docs/mockups/` and the token table in `docs/mockups/README.md`.

## Testing

`npm test` doesn't type-check: also run `npm run typecheck` here, not a bare `tsc`, which skips generating `packages/shared/src/version.ts`.

- **Tests never reach a running backend.** They replace `api/client.ts` and `api/events.ts` with `vi.spyOn(api, …)` or `vi.mock`, as `components/useCardLive.test.tsx` does.

## Verification workflow

For a change to what the page shows or does, before you report it complete:

1. Start the app at the repo root on a scratch database: `HIVE_DB=$(mktemp -d)/hive.db npm run dev`. Without `HIVE_DB` it opens the real board in `~/.claude-hive/hive.db`. It needs ports 4317 and 5173 free: if `lsof -nP -iTCP:4317 -iTCP:5173 -sTCP:LISTEN` shows anything, the page would reach that hive instead, so ask the user before going on.
2. Drive the changed feature in a browser via Playwright MCP, relying on the page snapshot.
3. Check console messages and network requests for errors.
