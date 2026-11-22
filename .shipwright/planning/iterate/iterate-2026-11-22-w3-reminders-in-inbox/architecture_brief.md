# Architecture Brief: Due reminders and expired parks in the Inbox

## The problem
The operator asks Shipwright to remember things (reminders) and parks triage items until a revisit day. Nothing in the WebUI tells them when that day comes. The operator decided the alert is the Inbox itself (its sidebar count), with no extra page, banner or bell, and wants to act on an item (done, snooze, start a task) and to create reminders by hand.

## What already exists here
- Server bridge (W1, merged): routes that run the Shipwright reminder tool per project and across all projects, with explicit states (ok, degraded, tool missing, unknown version, unreadable).
- The Inbox in the Triage look (W2, merged): filter bar, per-project cards, compact rows, hover actions, light detail dialog.
- Triage "Fix now" flow: a pre-filled New Task dialog; the operator confirms and launches.
- The New Task dialog pieces (More options bar, project context strip, field labels) and the shared sidebar Inbox count.

## What would newly, permanently exist
Client-side presentation and a shared 2-minute poll of the existing due route: reminder and parked-triage rows, a detail dialog, a snooze panel, a "+ New reminder" dialog, error banners, and the reminder count added to the sidebar Inbox number. No new server data path and no new storage: all reminder data stays in the Shipwright tool.

## Options on the table
- **A:** Extend the existing Inbox (rows, dialog, actions) with the reminder entries and add the count to the sidebar number.
- **B:** A separate Reminders page with its own sidebar entry and badge.
- **C:** A banner or bell in the page header that opens a reminder list.
- **D:** Do nothing; rely on mail only.

## Constraints that are not negotiable
The WebUI never writes the reminder file (only the Shipwright tool does); every text field is untrusted and must render as plain text; the stored command is display text and is never executed; the approved mockups (pages 01, 02, 03, 06, 07) are fixed.
