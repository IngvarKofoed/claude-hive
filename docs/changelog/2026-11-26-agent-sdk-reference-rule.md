# Backend sessions check the Agent SDK's own types, not the claude-api skill

Before changing code that calls the Claude Agent SDK, a backend session checks the option in the
SDK's type definitions or asks the built-in `claude-code-guide` agent. The `claude-api` skill
covers the Claude API and Managed Agents, and its own text says it doesn't cover the Agent SDK.

## Detail
- Rejected keeping `claude-api` for Agent SDK work. If the backend ever calls the Claude API directly
  (`@anthropic-ai/sdk`), `claude-api` comes back for that code only.
- Not verified: no package is installed yet, so the type definitions this rule points at aren't on disk.
- Found by a prompt audit against Claude Opus 5.5 and applied through the scaffold skill's audit,
  whose catalog now carries the same Agent SDK rule.
