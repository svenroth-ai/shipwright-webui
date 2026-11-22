# Architecture Brief: Mail for due reminders

## The problem
The operator wants to be told, by e-mail, when a reminder is due or a parked triage item has reached its revisit day, even when no browser tab is open. The Inbox alert only works while the WebUI is open. Mail must be off until configured, must never repeat the same item on the same day (an expired park only once ever), and must keep that promise across server restarts.

## What already exists here
- The server bridge to the Shipwright reminder tool (one call per project answers what is due, with explicit error states).
- The Settings page with cards, and a per-user central data folder outside every repo for the WebUI's own files.
- A multi-writer file-lock helper used by other stores.
- No mail code, no scheduler for this, and no mail library in the dependencies.

## What would newly, permanently exist
A server-side check that runs at start and on an interval, a persisted "already mailed" ledger, a mail composer for escaped plain text, a Settings card, a failed-send banner in the Inbox, an SMTP secret stored in a file in the central user folder, and one new third-party dependency for SMTP.

## Options on the table
- **A:** A server timer in the WebUI process with a persisted ledger, a pinned SMTP library, the password in an env file in the central user folder.
- **B:** A separate scheduled job (OS scheduler) that calls the tool and mails, outside the WebUI.
- **C:** Browser-side notifications only (no mail).
- **D:** Do nothing; rely on the Inbox alert.
- **E:** A hand-written minimal SMTP client instead of a library.

## Constraints that are not negotiable
Mail is off by default; the SMTP password never lives in a repo, never in a log, never in an API answer; every text field is untrusted and the mail carries no local paths; the WebUI never writes the reminder file; at most 3 send tries per item and day; the approved mockups (pages 04, 05, 06, 07) are fixed.
