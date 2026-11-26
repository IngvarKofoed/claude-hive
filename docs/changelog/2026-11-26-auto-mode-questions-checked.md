# Questions work in auto mode; auto mode doesn't stop risky actions

Tested with every session in auto mode: `AskUserQuestion` still reaches `canUseTool`, and the answer reaches the
session. But auto mode passed nothing on and refused nothing, so the only Approve item left is the hive's own push
at Ship. Every role is now told to ask with `AskUserQuestion`, never in its reply.
Follows `2026-11-26-full-access-auto-mode`.

## Detail
- Tested on 2026-11-26 with Haiku, Agent SDK 0.3.332 and Claude Code 2.1.332, with and without your own settings,
  using throwaway scripts that were not kept.
- Asked for directly, three risky actions ran with no call to `canUseTool`: `rm -rf` of a folder outside the
  project, `git push --force origin main`, and a `curl` POST of `.env`. All targets were scratch or a closed
  localhost port.
- Taken from a `SETUP.md` in the repo, the same steps were held back by the model itself, not by auto mode: it
  skipped the delete and the upload and pushed without `--force`. It asked for confirmation in prose, which in a
  hands-off lane ends the turn with nobody to answer. That is why roles must ask through `AskUserQuestion`.
- The brakes on a session are now its instructions and the model's own judgment. Hive prompts arrive as your
  requests, so auto mode will let through whatever they ask for.
