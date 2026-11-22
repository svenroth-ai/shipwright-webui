import type { ReminderItem, ReminderProjectDue } from "../../../lib/remindersApi";

export function makeReminderItem(over: Partial<ReminderItem> = {}): ReminderItem {
  return {
    kind: "reminder",
    id: "rem-a41c09",
    title: "Renew the code-signing certificate",
    due: "2026-11-22",
    why: "The certificate expires on 2026-12-01.",
    decided: null,
    open: null,
    command: null,
    links: [],
    severity: null,
    ...over,
  };
}

export function makeTriageItem(over: Partial<ReminderItem> = {}): ReminderItem {
  return makeReminderItem({
    kind: "triage",
    id: "trg-1a2b3c4d",
    title: "Revisit: flaky Windows runner",
    due: "2026-11-18",
    why: "Parked until the runner image update lands.",
    ...over,
  });
}

export function makeDue(over: Partial<ReminderProjectDue> & { projectId: string }): ReminderProjectDue {
  return {
    state: "ok",
    on: "2026-11-22",
    reminderCorruptLines: 0,
    triageError: null,
    items: [],
    ...over,
  };
}
