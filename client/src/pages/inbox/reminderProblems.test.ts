import { describe, expect, it } from "vitest";

import { countDueItems } from "../../hooks/useReminders";
import { makeDue, makeReminderItem } from "./__fixtures__/reminder-fixtures";
import { reminderProblems } from "./reminderProblems";

// @covers FR-01.76
describe("reminderProblems", () => {
  it("is quiet for clean answers", () => {
    expect(reminderProblems([makeDue({ projectId: "a" })], false).any).toBe(false);
  });

  it("names a project whose tool could not answer (never nothing due)", () => {
    const p = reminderProblems(
      [
        { projectId: "a", state: "unsupported-version" },
        { projectId: "b", state: "engine-unavailable", reason: "uv is not installed" },
      ],
      false,
    );
    expect(p.any).toBe(true);
    expect(p.unavailable.map((u) => u.projectId)).toEqual(["a", "b"]);
    expect(p.unavailable[1].reason).toBe("uv is not installed");
  });

  it("surfaces triageError next to the data that was read", () => {
    const p = reminderProblems(
      [makeDue({ projectId: "a", state: "degraded", triageError: "triage.jsonl: unreadable at line 12" })],
      false,
    );
    expect(p.triageErrors).toEqual([{ projectId: "a", detail: "triage.jsonl: unreadable at line 12" }]);
    expect(p.unavailable).toEqual([]);
  });

  it("counts damaged lines once per reminder store (a project sharing a store is skipped)", () => {
    const p = reminderProblems(
      [
        makeDue({ projectId: "a", state: "degraded", reminderCorruptLines: 2 }),
        makeDue({ projectId: "b", state: "degraded", reminderCorruptLines: 2, remindersSharedWithProjectId: "a" }),
      ],
      false,
    );
    expect(p.corruptLines).toBe(2);
  });

  it("a failed request is a problem too", () => {
    expect(reminderProblems(undefined, true)).toMatchObject({ requestFailed: true, any: true });
  });
});

// @covers FR-01.76
describe("countDueItems (the sidebar alert)", () => {
  it("counts due reminders and expired parks of every readable project, nothing from an unreadable one", () => {
    const n = countDueItems([
      makeDue({ projectId: "a", items: [makeReminderItem(), makeReminderItem({ id: "rem-2" })] }),
      makeDue({ projectId: "b", state: "degraded", triageError: "x", items: [makeReminderItem({ id: "rem-3" })] }),
      { projectId: "c", state: "failed", reason: "boom" },
    ]);
    expect(n).toBe(3);
    expect(countDueItems(undefined)).toBe(0);
  });
});
