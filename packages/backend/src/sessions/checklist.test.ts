import { describe, expect, it } from "vitest";
import { applyChecklistChange, ChecklistReader } from "./checklist";

describe("ChecklistReader", () => {
  it("reads TodoWrite's whole list, skipping items it can't show", () => {
    const reader = new ChecklistReader();
    expect(
      reader.toolUse("TodoWrite", "t1", {
        todos: [
          { content: "Add the setting", status: "completed", activeForm: "Adding the setting" },
          { content: "Write the tests", status: "in_progress", activeForm: "Writing the tests" },
          { content: "  ", status: "pending" },
          { content: "Odd status", status: "blocked" },
        ],
      }),
    ).toEqual({
      kind: "replace",
      items: [
        { id: null, text: "Add the setting", status: "completed" },
        { id: null, text: "Write the tests", status: "in_progress" },
      ],
    });
    expect(reader.toolUse("TodoWrite", "t2", { todos: "nope" })).toBeNull();
  });

  it("adds a TaskCreate item once its result gives the id", () => {
    const reader = new ChecklistReader();
    expect(reader.toolUse("TaskCreate", "c1", { subject: "Add the setting", description: "…" })).toBeNull();
    expect(reader.toolResult("c1", { task: { id: "3", subject: "Add the setting" } }, false)).toEqual({
      kind: "add", id: "3", text: "Add the setting",
    });
    // Each result is used once.
    expect(reader.toolResult("c1", { task: { id: "3" } }, false)).toBeNull();
  });

  it("drops a TaskCreate that failed or came back without an id, and ignores other tools' results", () => {
    const reader = new ChecklistReader();
    reader.toolUse("TaskCreate", "c1", { subject: "One" });
    reader.toolUse("TaskCreate", "c2", { subject: "Two" });
    expect(reader.toolResult("c1", { task: { id: "1" } }, true)).toBeNull();
    expect(reader.toolResult("c2", undefined, false)).toBeNull();
    expect(reader.toolResult("r1", { task: { id: "5" } }, false)).toBeNull();
  });

  it("takes the saved subject from the result, and the id from the result's text when there's no structured result", () => {
    const reader = new ChecklistReader();
    reader.toolUse("TaskCreate", "c1", { subject: "Add  setting" });
    expect(reader.toolResult("c1", { task: { id: 4, subject: "Add the setting" } }, false)).toEqual({
      kind: "add", id: "4", text: "Add the setting",
    });
    reader.toolUse("TaskCreate", "c2", { subject: "Tests" });
    expect(reader.toolResult("c2", undefined, false, "Task #5 created successfully: Tests")).toEqual({
      kind: "add", id: "5", text: "Tests",
    });
  });

  it("reads TaskUpdate's status, new subject and deletion once its result says it succeeded", () => {
    const reader = new ChecklistReader();
    expect(reader.toolUse("TaskUpdate", "u1", { taskId: "3", status: "in_progress" })).toBeNull();
    expect(reader.toolResult("u1", undefined, false)).toEqual({ kind: "update", id: "3", status: "in_progress" });
    reader.toolUse("TaskUpdate", "u2", { taskId: 3, subject: "Renamed" });
    expect(reader.toolResult("u2", undefined, false)).toEqual({ kind: "update", id: "3", text: "Renamed" });
    reader.toolUse("TaskUpdate", "u3", { taskId: "3", status: "deleted" });
    expect(reader.toolResult("u3", undefined, false)).toEqual({ kind: "update", id: "3", status: "deleted" });
    // A refused update never reaches the list.
    reader.toolUse("TaskUpdate", "u5", { taskId: "3", status: "completed" });
    expect(reader.toolResult("u5", undefined, true)).toBeNull();
    expect(reader.toolUse("TaskUpdate", "u4", { taskId: "3", owner: "someone" })).toBeNull();
    expect(reader.toolResult("u4", undefined, false)).toBeNull();
    expect(reader.toolUse("Read", "r1", { file_path: "x" })).toBeNull();
  });
});

describe("applyChecklistChange", () => {
  const a = { id: "1", text: "A", status: "pending" as const };
  const b = { id: "2", text: "B", status: "completed" as const };

  it("replaces, adds at the end, and ignores a second add of the same id", () => {
    expect(applyChecklistChange([a], { kind: "replace", items: [b] })).toEqual([b]);
    expect(applyChecklistChange(null, { kind: "add", id: "1", text: "A" })).toEqual([a]);
    expect(applyChecklistChange([a], { kind: "add", id: "2", text: "B" })).toEqual([a, { ...b, status: "pending" }]);
    expect(applyChecklistChange([a], { kind: "add", id: "1", text: "A again" })).toBeNull();
  });

  it("updates or removes by id, and changes nothing for an unknown id or the same values", () => {
    expect(applyChecklistChange([a, b], { kind: "update", id: "1", status: "in_progress" })).toEqual([
      { ...a, status: "in_progress" }, b,
    ]);
    expect(applyChecklistChange([a, b], { kind: "update", id: "1", text: "A2" })).toEqual([{ ...a, text: "A2" }, b]);
    expect(applyChecklistChange([a, b], { kind: "update", id: "2", status: "deleted" })).toEqual([a]);
    expect(applyChecklistChange([a], { kind: "update", id: "9", status: "completed" })).toBeNull();
    expect(applyChecklistChange(null, { kind: "update", id: "1", status: "completed" })).toBeNull();
    expect(applyChecklistChange([a], { kind: "update", id: "1", status: "pending" })).toBeNull();
  });
});
