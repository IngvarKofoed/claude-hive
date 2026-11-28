# The spec's Outcome and Key decisions show open above the folded spec

Wherever the card page shows a spec, its Outcome and Key decisions chapters are now open on top, and the whole file
stays folded under its path below them, as it is on disk. In Spec they appear as soon as the spec writer writes the
file, so what you get and the load-bearing choices can be read without opening the full spec. This revisits
`2026-11-27-card-lane-artifacts`, which folded the whole spec and accepted a click to read it even in Spec.

## Detail
- **Everywhere `SpecView` shows:** the Spec lane, looking back at ✓ Spec, the Done page, and a lane that isn't built
  yet. The Done page's right column is longer for it.
- **Chapters are found by their `##` heading,** "Outcome" and "Key decisions" from the spec format, without regard to
  case and in the spec's own order. A heading inside a fenced code block doesn't count. A spec without either chapter
  shows only the fold, as before.
- **Known gap: reference links and footnotes** in the two chapters show as literal brackets in the open view, since
  their definitions usually sit at the end of the file. The fold renders them. The spec format doesn't use them.
- **Read from the spec text the page already has.** No backend change and no new live event: the spec's watcher
  already sends `spec.updated` when the file changes, and the chapters follow it.
- **Rejected: the spec writer's closing summary** in the chat as the artifact. It isn't stored apart from the chat,
  and it's the writer's own account, not the spec.
- `Markdown` now drops the top margin of its first element, so a chapter heading sits flush under the review bar.
  That applies to every rendered Markdown.
