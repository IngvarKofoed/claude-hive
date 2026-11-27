# Claude Hive — shared

## Testing

After a change here, run `npm run typecheck` at the repo root, which checks all three packages. A bare `tsc` skips generating `src/version.ts` and fails on a fresh checkout. Runtime code added here, such as a type guard, gets a test.

## Rules

- **A type change lands in all three packages at once.** A change to an API body, SSE event or role report type here is followed through in both backend and frontend in the same change.
- **Only what both sides use.** A type that only the backend or only the frontend needs lives in that package.
