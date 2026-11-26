# App version comes from git describe, baked in at build time

The app's version is `git describe --tags --long --always --dirty`, worked out once at build time by
`scripts/gen-version.mjs` into the git-ignored `packages/shared/src/version.ts`. The running app only
imports `APP_VERSION` and never calls git. The first release tag is `v0.1.0`.

## Detail
- Rejected reading git at runtime: the running app must not depend on a `.git` folder or the git binary.
- `package.json` `version` stays plain semver (`0.1.0`) and is bumped to match release tags; the
  git-describe string is never written into it, because it isn't valid semver.
- Not wired yet: the packages don't exist, so no `predev` / `prebuild` hook calls the script. Until
  they do, a build reports nothing, or `0.0.0-unknown`.
