# Session copies are made with forkSession(), from the last entry of the last kept turn

Every copy (spec keeper judgments, "Redo the other way") is now made with the SDK's `forkSession()` and then
resumed, because `resume` with `resumeSessionAt` can't reach a message from before a compaction.
The copy point is the last entry of the last turn kept: after a report, the final tool result.
This narrows `2026-11-26-sdk-fork-report-trust-checks`.

## Detail
- Tested on 2026-11-26 with Haiku, Agent SDK 0.3.332 and Claude Code 2.1.332, using throwaway scripts
  that were not kept.
- Rejected `resume` + `forkSession: true` + `resumeSessionAt`. From a message before a `/compact`, it failed
  with `error_during_execution`, "No message found with message.uuid of: …", because a resumed session only
  loads what comes after the compaction boundary. `forkSession({ upToMessageId })` from the same message
  worked, and the copy had the earlier messages verbatim. After a compaction, both methods gave the same copy.
- Don't copy from the compaction boundary itself: the copy runs, but knows nothing. A copy from the summary
  knows the earlier turns only as the summary.
- A turn that ends in a report is written in this order: report call, `structured_output` attachment, then the
  tool result. Copying from the report call or the attachment cuts off the tool result, and the copy
  believes its report failed. The SDK's `resumeDropsTurn` docs say to copy from the attachment; in this version
  that is wrong, and the guard itself refused it.
- When a next turn exists, the entry just before its prompt (the prompt's `parentUuid`) is a safe copy point.
  Resuming writes a "No response requested." assistant entry there, which copies cleanly.
- `forkSession()` has no `resumeDropsTurn` guard, so the hive must pick the copy point itself. Its new session id
  is returned before any model call, so the hive still knows the id up front.
- Not covered: `/compact` compacts between turns. An automatic compaction partway through a long turn
  wasn't tested.
