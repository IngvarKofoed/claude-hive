# packages/shared has its own CLAUDE.md

`packages/shared` has a CLAUDE.md like the other packages. A type change lands in all three packages
at once, only types both sides use live there, every role report type keeps its `done` / `blocked`
status, and the generated `src/version.ts` is never edited or committed.

## Detail
- Reverses the root file's "`packages/shared` … has no file of its own". The root keeps its
  cross-package rule and now points at the shared file.
- The test setup is inferred: the package has no manifest yet, so Vitest comes from the backend and
  frontend files, and the type check (`tsc --noEmit`) is the main test for a package of types.
- No required skills. Considered the Agent SDK reference rule, since role report types become
  `outputFormat` schemas, and left it with the backend, which writes the `query()` calls.
- The `version.ts` rule restates `2026-11-26-git-describe-version`.
