// The developer's own task list, read from its tool calls (docs/specs/2026-11-28-build-lane-checklist.md). Claude Code
// keeps a session's list through `TodoWrite`, which sends the whole list on every call, or `TaskCreate` and
// `TaskUpdate`, which change one item per call. Both are read, since which one a session uses isn't fixed.
import type { ChecklistItem, ChecklistStatus } from "@hive/shared";
import type { ChecklistChange } from "./types";

const STATUSES: readonly ChecklistStatus[] = ["pending", "in_progress", "completed"];
const isStatus = (value: unknown): value is ChecklistStatus => STATUSES.includes(value as ChecklistStatus);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
/** A task id as a tool call or result gives it: Claude Code's are strings, but a number is read too. */
const taskId = (value: unknown): string | null =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : text(value);

/** The tools that change a session's task list. */
export const CHECKLIST_TOOLS = ["TodoWrite", "TaskCreate", "TaskUpdate"];

/**
 * Turns one session's tool calls into checklist changes. A `TaskCreate` call is held until its result, since the new
 * task's id is only there, and a `TaskUpdate` too, so an update Claude Code refused doesn't reach the list.
 */
export class ChecklistReader {
  private creating = new Map<string, string>(); // tool_use_id → the subject being created
  private updating = new Map<string, ChecklistChange>(); // tool_use_id → the update it makes once it succeeds

  /** A tool call from the session itself: the change it makes at once, if any. */
  toolUse(name: string, toolUseId: string, input: Record<string, unknown>): ChecklistChange | null {
    if (name === "TodoWrite") {
      if (!Array.isArray(input.todos)) return null;
      const items: ChecklistItem[] = [];
      for (const todo of input.todos as Record<string, unknown>[]) {
        const content = text(todo?.content);
        if (content && isStatus(todo.status)) items.push({ id: null, text: content, status: todo.status });
      }
      return { kind: "replace", items };
    }
    if (name === "TaskCreate") {
      const subject = text(input.subject);
      if (subject) this.creating.set(toolUseId, subject);
      return null;
    }
    if (name === "TaskUpdate") {
      const id = taskId(input.taskId);
      if (!id) return null;
      const subject = text(input.subject);
      const status = input.status === "deleted" || isStatus(input.status) ? input.status : undefined;
      if (!subject && !status) return null;
      this.updating.set(toolUseId, { kind: "update", id, ...(subject ? { text: subject } : {}), ...(status ? { status } : {}) });
      return null;
    }
    return null;
  }

  /**
   * A tool's result. Only a held call makes a change: a `TaskUpdate`'s update, or a `TaskCreate`'s `add`, with the id
   * and saved subject from the structured result. Without a structured result, the id is read from the result's text
   * ("Task #3 created…"). A failed call, or a `TaskCreate` result without an id, is dropped.
   */
  toolResult(toolUseId: string, result: unknown, failed: boolean, resultText = ""): ChecklistChange | null {
    const update = this.updating.get(toolUseId);
    if (update) {
      this.updating.delete(toolUseId);
      return failed ? null : update;
    }
    const subject = this.creating.get(toolUseId);
    if (subject === undefined) return null;
    this.creating.delete(toolUseId);
    if (failed) return null;
    const task = (result as { task?: { id?: unknown; subject?: unknown } } | null | undefined)?.task;
    const id = taskId(task?.id) ?? /\bTask #(\w+)/.exec(resultText)?.[1] ?? null;
    if (!id) return null;
    return { kind: "add", id, text: text(task?.subject) ?? subject };
  }
}

/** The list after one change, or null when the change leaves it as it was. */
export function applyChecklistChange(list: ChecklistItem[] | null, change: ChecklistChange): ChecklistItem[] | null {
  const items = list ?? [];
  switch (change.kind) {
    case "replace":
      return change.items;
    case "add":
      if (items.some((item) => item.id === change.id)) return null;
      return [...items, { id: change.id, text: change.text, status: "pending" }];
    case "update": {
      const at = items.findIndex((item) => item.id === change.id);
      if (at === -1) return null;
      if (change.status === "deleted") return items.filter((_, i) => i !== at);
      const before = items[at]!;
      const after: ChecklistItem = {
        ...before,
        ...(change.text !== undefined ? { text: change.text } : {}),
        ...(change.status !== undefined ? { status: change.status } : {}),
      };
      if (after.text === before.text && after.status === before.status) return null;
      return items.map((item, i) => (i === at ? after : item));
    }
  }
}
