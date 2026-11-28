# Mini-Plan: decision-reject-reason

- **Run ID:** iterate-2026-11-28-decision-reject-reason
- **Spec:** `.shipwright/planning/iterate/2026-11-28-decision-reject-reason.md`

## 1. Files

| File | Change |
|---|---|
| `server/src/external/org/decisions-rejected.ts` | new: block writer (`toRejectedBlock`), parser (`parseRejectedBlocks`), header, append-if-absent, writability pre-check |
| `server/src/external/org/decisions-lock.ts` | edit: lock context gains `rejectedPath` + `readRejected()`; the path is resolved by `pathGuard` (NOT added to the generic `/file` allowlist, so the browser cannot write it) and symlink-checked before and after taking the lock, like `decision_log.md` |
| `server/src/external/org/proposed-line.ts` | edit: `checkEditedLine` takes a max length; new `checkNoteText` (reason / note: optional, one line, 600 max, quote guard); `toLoggedLineBlock` takes an optional note; `LOGGED_LINE_BLOCK_RE` accepts one trailing `- Note:` item |
| `server/src/external/org/proposed-entry-format.ts` | edit: export the body text of a block (for an unfenced entry's rejected text) and a whole-entry `withNote` |
| `server/src/external/org/decision-residue.ts` | edit: a whole-entry log block that ends in a `- Note:` item still matches its proposed entry |
| `server/src/external/org/reject-core.ts` | edit: validate reason under the lock (needs the entry's quotes), pre-check the rejected file, audit -> rejected block -> proposed removal |
| `server/src/external/org/reject-request.ts` | edit: `reason` must be a string or absent (400 `reason_invalid`); map `reason_too_long` / `reason_contains_quote` (400), `rejected_file_unwritable` (409) |
| `server/src/external/org/countersign-core.ts` / `countersign-request.ts` | edit: optional `note`, validated under the lock; 400 `note_invalid` / `note_too_long` / `note_contains_quote` |
| `server/src/external/org/decisions-audit.ts` | edit: `REASON_MAX` 280 -> 600 (read-back normalisation of an existing record's reason) |
| `client/src/lib/orgRejectApi.ts`, `client/src/lib/orgDecisionsApi.ts` | edit: map the new errors; countersign sends `note` |
| `client/src/components/org/DecisionRejectControl.tsx` | edit: reason field max 600, label says the reason goes into the shared list of rejected decisions |
| `client/src/components/org/DecisionEntryRow.tsx` | edit: "Add note" toggle + one single-line note input passed to countersign (inline, no new component - plan review) |
| `client/src/components/org/useDecisionActions.ts`, `decisionMessages.ts` | edit: pass note; messages for reason/note refusals |
| `docs/org-proposed-entry-contract.md` | new section "Rejected decisions file" (exact grammar), note item in the log block, reason rules |
| `server/src/external/org/__tests__/fixtures/decisions-rejected-sample.md` | new: pinned sample of the file (produced by the writer, pinned by a test) |
| tests | new `decisions-rejected.test.ts` (server), countersign-note tests, client unit tests, e2e flow |
| `.shipwright/planning/01-adopted/spec.md` | FR-01.71: three (F) acceptance criteria |

## 2. Work breakdown

1. `decisions-rejected.ts` + unit tests (block shape, header on create, idempotent append, parse round trip, pinned fixture). 
2. Lock context gains the rejected path; symlink test.
3. Reason/note validator in `proposed-line.ts` + tests (length, quote, empty -> null, control chars).
4. Reject core: order audit -> block -> removal; crash-retry tests (block present + entry listed -> no duplicate; audit present + block missing -> block written with the recorded reason); 400/409 mapping tests.
5. Countersign note: line block + whole-entry block; residue/crash-retry with a note; tests.
6. Client: API + UI + unit tests; e2e flow spec (reject with reason, countersign with note) against a temp leadsRoot.
7. Docs + spec ACs.

## 3. Component hierarchy (UI)

`OrgDecisionsProposedModal` -> `DecisionEntryRow` -> { `DecisionRejectControl` (reason input), `DecisionNoteField` (new, note input), `DecisionLineEditor` }.

## 4. Data model

New file `<leadsRoot>/decisions-rejected.md` (append-only Markdown, grammar in the contract doc). `decision_log.md` line block gains an optional trailing `- Note: <text>` item. Audit shape unchanged (`data.reason` already string|null).

## 5. Test strategy

Vitest server unit + route tests (temp leadsRoot), client component/API tests, one Playwright flow (`client/e2e/flows/org-page.decisions-rejected.spec.ts`) over the real dev stack with a temp leadsRoot, the same way the existing decisions-proposed flows run.

## 6. Alternative approach

Per-lead `<leadsRoot>/<lead>/decisions-rejected.md` (next to `audit.jsonl`) instead of one org-wide file.
Rejected because the leadwright contract fixes ONE org-wide file (a lead should also see what was rejected for another lead, since leads overlap in domain), and the org-wide file sits next to `decisions-proposed.md` / `decision_log.md`, the files already guarded by the one decisions lock.
