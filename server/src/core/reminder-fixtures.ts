/* Test-support: a verbatim `reminder_cli.py due --json` answer (contract v1). Not a test file. */

export const GOOD_ANSWER = {
  contractVersion: 1,
  on: "2026-11-22",
  sourceRoot: "C:/proj",
  reminderStore: "C:/proj/.shipwright/reminders.jsonl",
  reminderCorruptLines: 0,
  triageError: null as string | null,
  items: [
    {
      kind: "reminder", id: "rem-aabbccdd", title: "Renew cert", due: "2026-11-20",
      why: "It expires", decided: null, open: "Who renews?", command: null,
      links: [{ label: "Docs", kind: "url", ref: "https://example.com" }], severity: null,
    },
    {
      kind: "triage", id: "trg-11223344", title: "Parked finding", due: "2026-11-21",
      why: "Parked until the API ships", decided: null, open: "detail", command: null,
      links: [{ label: "Triage trg-11223344", kind: "triage", ref: "trg-11223344" }], severity: "high",
    },
  ],
};
