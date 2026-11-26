# CLAUDE.md files state only current rules, and name tools without loading recipes

The CLAUDE.md files state each rule as the only one there has ever been. Sentences pointing at
things this repo never had are gone, because a session reads them as hints that those things exist.
Required tools are named with their reason, without instructions for loading them.

## Detail
- Removed from the root file: "There is no summary file to load in its place", "now that entries no
  longer share a file", and "there is no end-of-turn nudge to go run a review elsewhere".
- Kept on purpose: "There is no single changelog file and there are no entry numbers" and "There is no
  digest … deliberately, since …". They stop a session from creating a `CHANGELOG.md` or a digest file.
- Removed the `ToolSearch` loading recipes for `LSP` and Playwright MCP from the backend and frontend
  files: the harness tells every session how to load a deferred tool, and which tools are deferred
  changes between Claude Code versions.
- Matches the scaffold skill's current template and audit rubric, so its next audit has nothing to flag here.
