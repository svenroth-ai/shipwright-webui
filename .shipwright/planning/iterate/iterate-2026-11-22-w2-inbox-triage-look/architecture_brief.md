# Architecture Brief: Inbox entries as Triage-style rows

## The problem
Today the Inbox shows each "awaiting your reply" entry as a tall, chat-like card (question body, honesty line, button). The Triage page shows the same kind of work items as compact rows. The operator wants one look across both pages, so the Inbox can later carry reminders next to the existing entries without two row designs.

## What already exists here
- Triage lanes and rows: `components/triage/TriageLane.tsx`, `TriageItemRow.tsx`, `styles/triage-rows.css` (container-query row, hover/focus action zone), `TriageDetailModal.tsx` (light dialog sheet).
- Inbox: `pages/inbox/*` with four card variants sharing `InboxCardShell`, project groups with drag/fold (`InboxProjectSection`, `InboxGroupList`), `styles/inbox-cards.css`.

## What would newly, permanently exist
A compact row component and a detail dialog for the Inbox, plus a filter bar; the four card variants and their shared shell go away. All of it is client-side presentation over the existing Inbox data. No new data path, no server change.

## Options on the table
- **A:** Reuse the Triage row CSS and dialog pattern for a new Inbox row + dialog, replace the card variants.
- **B:** Keep the card variants and only re-skin them to be shorter.
- **C:** Make the Triage row component itself generic and render Inbox entries through it.
- **D:** Do nothing.

## Constraints that are not negotiable
Existing behaviour of awaiting-reply entries (Answer in the terminal navigates, writes nothing; the lead-question answer form still PATCHes poFeedback) and the approved mockups (pages 01 and 02) are fixed.
