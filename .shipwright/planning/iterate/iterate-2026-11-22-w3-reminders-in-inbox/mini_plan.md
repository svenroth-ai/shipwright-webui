# Mini-plan: W3 Reminders in the Inbox

Run: iterate-2026-11-22-w3-reminders-in-inbox. Complexity: medium (diff-driven re-check: medium, no upgrade).

## Goal
Implement mockup pages 01, 02, 03, 06 on top of the W1 routes and the W2 Inbox: green REMINDER and grey PARKED TRIAGE rows, filter chips, hover actions (Start task, Done, Snooze; Open in Triage for parks), detail dialog, "+ New reminder" dialog, error banners, damaged-line hint, sidebar count.

## Design
1. `lib/remindersApi.ts` + `hooks/useReminders.ts`: fetch wrappers + ONE shared `["reminders-due"]` query (120 s poll) read by the Inbox page and the sidebar; `countDueItems` counts only projects that were actually read.
2. Pure models: `reminderModel.ts` (row/dialog shape, due text, sort), `reminderProblems.ts` (unavailable / triageError / damaged lines; a shared store is counted once).
3. `useInboxReminders` merges entries into the existing project groups (`ProjectGroup.reminders?`); `countByFilter` / `filterGroups` gain `reminders` and `parked` buckets.
4. `ReminderRow` (same triage-row layout, wider action zone), `ReminderDetailDialog` (light sheet, plain text only, long text scrolls in its box, only http(s) url links are live), `ReminderCard` (row + sibling dialog), `ReminderBanners`.
5. `useReminderActions`: Done / Snooze through the W1 routes; Start task resolves the project's action catalog and opens the existing New Task dialog pre-filled from the reminder's kind/id (title, why/decided/open) - the stored command is never read or run; parks only Open in Triage.
6. `components/reminders/NewReminderDialog` + `ReminderSnoozePanel` (outside the Inbox no-write-path fence: they type into REST forms, not a pty); `MoreOptionsDisclosure` gets an optional `hint`.
7. Page: PageHead "+ New reminder" (`.btn-primary`), banners, created notice, "Your inbox is clear" is NOT shown while a reminder problem exists.
8. Spec: FR-01.76 minted in the adopted spec.

## Tests
Unit: models, problems, count, InboxPage reminders (rows, filters, Done/Snooze calls, Start task prefill and no command, hostile text, banners), New reminder dialog, layout count. Real-browser: mocked-tool E2E (create, snooze, done, start task, hostile text, unavailable, narrow) and a real-tool E2E (gated on the CLI path). Visual baselines regenerated through the Linux workflow.

## Risks
Persistent red banner when the reminder tool is missing (by design, page 06a); projects without a triage log show the orange triage banner (honest, noisy).

## Review dispositions
External plan review (glm/openai): mutation errors (no optimistic removal, per-entry error, dialog stays open), query invalidation after success, unsupported version as explicit problem state, and shared-store owner id are all already in the build (accepted, verified by tests); date-only snooze follows the W1 contract (server validates).
External architecture review: glm approve, openai approve. Internal architecture reviewer: approve. Open point recorded for the operator: the sidebar badge adds 0 for an unreadable project (the Inbox page shows the red banner) - no marker on the badge itself.
