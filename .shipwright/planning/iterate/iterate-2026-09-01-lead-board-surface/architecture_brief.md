# Architecture Brief: lead-board-surface

## The problem
A PO cannot currently tell, from the Task Board, which cards were created or
are being watched by an AI lead helper, or filter to just those — the board
already stores the relevant metadata but never displays or filters on it.

## What would newly, permanently exist
Nothing. This displays and filters on fields the board's data model already
persists (`tags`, `domain`, `priority`, `complexityHint`), using the board's
existing client-side filter mechanism (the same pattern `statusFilter`
already uses) and existing toolbar row — no new field, no new route, no new
service, no new stored file.
