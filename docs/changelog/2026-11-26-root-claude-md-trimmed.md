# Root CLAUDE.md states only its rules: the two docs, the changelog, commits

The root CLAUDE.md is now CONCEPT and ARCHITECTURE as the source of truth,
the changelog rules with their example, and two commit rules. The reasons and defenses behind
each rule are gone: a session needs the rule, not the argument for it.

## Detail
- **The source-of-truth rule separates "not built yet" from "built differently".** The docs run ahead of the
  code for most of a new project's life, so building to them is the work; only existing code that does something
  differently is a mismatch to ask about. Replaced "flag it rather than guessing", which didn't say whether to
  stop, carry on, or fix one side. Drop the "run ahead of the code" sentence once the code has caught up.
- **Dropped the project paragraph:** it repeated the opening of CONCEPT.md, which loads right after it,
  and named lanes that would have to be kept in step with CONCEPT by hand.
- **Dropped the changelog reading ritual:** reading the newest 10 entries or the last 7 days, and a Haiku
  digest of the rest. `ls` plus a grep before touching an area replaces it, and decisions are also written
  back into CONCEPT and ARCHITECTURE, which every session loads.
- **Dropped as already covered:** the nested-guidance list, because Claude Code loads a package's CLAUDE.md
  when it reads files there and the shared-type rule is in `packages/shared/CLAUDE.md`. Also "commit and
  push only when asked", which is Claude Code's default.
- **Dropped as not about this repo:** multi-agent model tiering. If it's wanted, it belongs in `~/.claude/CLAUDE.md`.
- **Dropped the `TODO.md`-is-the-user's section:** the repo has no `TODO.md`.
- **`docs/CLAUDE_TODO.md` stays but is no longer mentioned in CLAUDE.md,** so nothing tells a session to read
  it or add to it. Rejected: retiring it and moving its three design gaps into CONCEPT.md's Open Questions.
  Its header still points at an *Owed follow-ups* section that no longer exists.
- **Kept "commit straight to `main`" on purpose:** without it, Claude Code creates a branch before committing on `main`.
- **Kept "no `CHANGELOG.md`, no entry numbers, no digest file"** for the reason in `2026-11-26-claude-md-current-rules-only`.
- **Reverses that entry's "matches the scaffold skill's current template":** the scaffold skill's audit will
  report this file as outdated until its template gets the same cut.
