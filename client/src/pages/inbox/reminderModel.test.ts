import { describe, expect, it } from "vitest";

import { makeReminderItem, makeTriageItem, makeDue } from "./__fixtures__/reminder-fixtures";
import { daysPast, entriesForProject, reminderRowModel, sortEntries, type ReminderEntry } from "./reminderModel";

const entry = (item = makeReminderItem(), on = "2026-11-22"): ReminderEntry => ({
  projectId: "p1",
  on,
  item,
  key: `${item.kind}-p1-${item.id}`,
});

// @covers FR-01.76
describe("reminderRowModel", () => {
  it("a reminder due today is a green reminder with Done / Snooze but no Start task without a command", () => {
    const m = reminderRowModel(entry());
    expect(m).toMatchObject({
      filter: "reminders",
      chip: { label: "reminder", tone: "reminder" },
      dueText: "due today",
      canAct: true,
      canStart: false,
      idText: "rem-a41c09",
    });
  });

  it("offers Start task only when a command is stored (it is never run from it)", () => {
    expect(reminderRowModel(entry(makeReminderItem({ command: "/shipwright-iterate renew" }))).canStart).toBe(true);
    expect(reminderRowModel(entry(makeReminderItem({ command: "  " }))).canStart).toBe(false);
  });

  it("an expired park is grey, says how long ago and offers no Done / Snooze", () => {
    const m = reminderRowModel(entry(makeTriageItem()));
    expect(m).toMatchObject({
      filter: "parked",
      chip: { label: "parked triage", tone: "parked" },
      dueText: "park expired 4d ago",
      dayLabel: "Revisit day",
      canAct: false,
      canStart: false,
    });
    expect(m.dayValue).toBe("2026-11-18 (4 days ago)");
  });

  it("an item without an id cannot be acted on; a missing title is shown as untitled", () => {
    const m = reminderRowModel(entry(makeReminderItem({ id: null, title: null })));
    expect(m.canAct).toBe(false);
    expect(m.title).toBe("(untitled)");
  });

  it("keeps hostile text literal (no stripping, no markdown handling)", () => {
    const t = "<b>bold</b> <script>alert(1)</script> in title";
    expect(reminderRowModel(entry(makeReminderItem({ title: t }))).title).toBe(t);
  });

  it("daysPast is null for anything that is not a day", () => {
    expect(daysPast("2026-11-22", "2026-11-20")).toBe(2);
    expect(daysPast("2026-11-22", "soon")).toBeNull();
    expect(daysPast("2026-11-22", null)).toBeNull();
  });
});

// @covers FR-01.76
describe("entriesForProject / sortEntries", () => {
  it("yields entries for ok and degraded answers only; a problem state yields none", () => {
    const items = [makeReminderItem()];
    expect(entriesForProject(makeDue({ projectId: "p1", items }))).toHaveLength(1);
    expect(entriesForProject(makeDue({ projectId: "p1", state: "degraded", triageError: "x", items }))).toHaveLength(1);
    expect(entriesForProject({ projectId: "p1", state: "engine-unavailable", reason: "no uv" })).toEqual([]);
    expect(entriesForProject({ projectId: "p1", state: "unsupported-version" })).toEqual([]);
  });

  it("lists reminders before parked triage, oldest day first", () => {
    const a = entry(makeTriageItem());
    const b = entry(makeReminderItem({ id: "rem-2", due: "2026-11-22" }));
    const c = entry(makeReminderItem({ id: "rem-1", due: "2026-11-20" }));
    expect(sortEntries([a, b, c]).map((e) => e.item.id)).toEqual(["rem-1", "rem-2", "trg-1a2b3c4d"]);
  });
});
