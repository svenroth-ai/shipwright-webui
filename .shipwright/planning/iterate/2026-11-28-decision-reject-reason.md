# Iterate Spec: decision-reject-reason

- **Run ID:** iterate-2026-11-28-decision-reject-reason
- **Type:** feature
- **Complexity:** medium
- **Status:** draft

## Goal

A rejected lead decision is no longer lost. Today a reject removes the entry from
`<leadsRoot>/decisions-proposed.md` and leaves only a `decision_rejected` audit line with the
decisionKey (no text), so leads re-propose a reworded version of the same idea. After this change
the server keeps an org-wide, append-only `<leadsRoot>/decisions-rejected.md` with the rejected
text, the lead, the rejection time and the operator's reason, in a fixed grammar the leadwright
daemon (sibling iterate, reading side) parses. Countersign gains an optional operator note that is
written into the `decision_log.md` block.

## Contract (fixed with the leadwright side)

1. Reject takes an optional `reason` (one line, at most 600 characters, same line rules as an edited
   line: normalised to one line, refused when it repeats a quote of the entry). Countersign takes an
   optional `note` with the same rules, written into the `decision_log.md` block as `- Note: <text>`.
2. On reject the server appends one block to `<leadsRoot>/decisions-rejected.md`, atomically
   (temp file + rename) while holding the same `decisions-proposed.md` lock the reject path holds.
   Block: heading `## Rejected [<entry timestamp>] <leadId>`, the decisionKey marker under the same
   condition as the log, a blank line, `- <original proposed line>`, `- Rejected: <ISO time>`,
   `- Reason: <text>` when given. The file is created with a short header when missing.
3. The `decision_rejected` audit line carries `data.reason` (string or null) - already the case;
   readers keep working.
4. A retry of a reject whose block was already appended never appends it twice.
5. Client: reject keeps its optional reason field (limit raised to 600), countersign gets an
   optional note field.

## Acceptance Criteria

- [ ] AC1: Given a proposal in the proposals window, when the operator rejects it, then one block
  with the proposed line as the lead wrote it, the lead, the rejection time and the reason (when one
  was given) is added to the organization's shared list of rejected decisions, the list is created
  with a short heading when it does not exist yet, and a retry after an interruption never adds the
  same block twice.
- [ ] AC2: Given a rejection reason or a countersign note that is longer than 600 characters or
  repeats a quote of the lead, when the operator submits the decision, then it is refused with a plain
  explanation and nothing is changed.
- [ ] AC3: Given a proposal the operator countersigns with a note, when it is logged, then the
  decisions log holds the note as its own item below the logged line, and a countersign without a note
  logs exactly what it logged before.

Assertion shape (F0.5): `POST /api/org/decisions/reject {reason:"too vague"}` returns 200 and
`decisions-rejected.md` ends with the documented block; a second identical POST leaves the file
byte-identical; `POST .../countersign {note:"..."}` returns 200 and the ADR block contains
`- Note: ...`; a 601-character reason returns 400 `reason_too_long` with all three files unchanged.
Browser: the reject confirm step shows the reason field (max 600) and the countersign note field;
submitting both writes the files above.

**Pre-build AC record (Step 2a):** AC1-AC3 above, added under FR-01.71 (frozen in `ac-record.jsonl`).

## Spec Impact

- **Classification:** modify
- **ADD:** none
- **MODIFY:** FR-01.71 - three (F) acceptance criteria (rejected-decisions list, reason/note rules,
  countersign note). FOLD: it completes the existing reject/countersign capability of the proposals
  window; same reader, same tests.
- **REMOVE:** none

## Out of Scope

- Reading `decisions-rejected.md` in leadwright (sibling iterate) and showing it in the webui.
- Backfilling rejections made before this change (their text is gone).
- A note in the countersign audit record (contract does not ask for it).
- Changing leadwright.

## Design Notes

UI change is small and reuses existing patterns: the reject confirm step already has a one-line
reason input (limit 280 -> 600, label names the shared list); countersign gets an "Add note" toggle
like "Edit line" that opens one single-line input. No new design tokens.

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `server/src/external/org/decisions-rejected.ts:toRejectedBlock` (via `reject-core.ts:performReject`) | leadwright daemon (sibling iterate); `parseRejectedBlocks` here for idempotency | Markdown block grammar, `docs/org-proposed-entry-contract.md` "Rejected decisions file" |
| `proposed-line.ts:toLoggedLineBlock` / `withNote` (countersign) | `parseLoggedLineBlock` + `decision-residue.ts:residueKind` (crash retry); leadwright decision_log readers | `decision_log.md` block + optional `- Note:` item |
| `decisions-audit.ts:ensureDecisionAudit` | `rejectedKeys`, activity view, leadwright | `audit.jsonl` `decision_rejected.data.reason` (unchanged shape) |
| client `orgRejectApi.ts` / `orgDecisionsApi.ts` | `reject-request.ts` / `countersign-request.ts` | JSON request bodies (`reason`, `note`) |

## Confidence Calibration

- **Boundaries touched:** see table above.
- **Empirical probes run:** (1) round trip writer -> file -> parser for the pinned fixture (`__tests__/fixtures/decisions-rejected-sample.md`, regenerated from `toRejectedBlock`, read back by `parseRejectedBlocks`): no finding. (2) human-edited file: BOM + CRLF + no trailing newline, then a retry of the same reject: the dedupe still matches, no second block: no finding. (3) empty existing file: header is not re-written twice, block lands: no finding. (4) non-ASCII and whitespace-only reasons (`\u200b \t\n` -> no Reason item; umlauts kept): no finding. (5) overlong fenced line (cut at 2000) whose tail holds a quote: FOUND a leak in round 1 (the check ran before the cut); fixed by checking the cut text; re-probed: no finding. (6) unfenced body with `> ` quote lines: FOUND (code review) that quotes reached the shared file; fixed by dropping quote lines and the Evidence bullet; re-probed: no finding. (7) old whole-entry log body `- x` + `- Note: y`: FOUND residue returned unknown; fixed in parseLoggedLineBlock; re-probed: no finding. (8) short fence nonce (no fingerprint) + note + crash residue (doubt review): FOUND residue read as different, so reject could publish an approved decision; fixed in residueKind (fingerprint-less line block -> unknown unless body-identical); re-probed: no finding. (9) hand-edited trailing whitespace on heading and marker: FOUND the block was missed by the dedupe; fixed by trimming lines; re-probed: no finding. (10) write failure after the audit line (directory target at append): reported as auditWritten, no finding. (11) full server + client suites and the e2e specs after all fixes: no finding. Last two probes in a row without a finding: asymptote reached.
- **Test Completeness Ledger:** 3 ACs under FR-01.71, each covered: AC-a (block grammar + header + marker) by decisions-rejected.test.ts "reject appends one block" + fixture pin; AC-b (audit data.reason, retry dedupe, crash orders) by decisions-rejected.test.ts crash/identity tests; AC-c (countersign note + client fields) by decisions-countersign-note.test.ts, OrgDecisionsProposedModal.note.test.tsx, orgDecisionsApi.note-reason.test.ts and e2e org-page.decisions-rejected.spec.ts.
- **Confidence-pattern check:** every claim above is anchored to a probe that ran; edge cases not probed: concurrent rejects from two WebUI processes on different hosts sharing a leadsRoot (lock is process-file based, same as every other decisions write; accepted), and a lead hand-planting a matching block before the reject (dedupe would skip the write; documented residual risk).

## Verification (medium+)

- **Surface:** web
- **Runner command:** `cmd /c node_modules\.bin\playwright.cmd test e2e/flows/org-page.decisions-rejected.spec.ts` (from `client/`)
- **Evidence path:** `.shipwright/runs/iterate-2026-11-28-decision-reject-reason/`

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** high
- **Summary:** Order and lock fit the crash-safe pattern; quote text and lead-written reasons could reach the org-wide file, and request-side truncation would let AC2 pass silently.
- **Findings:**
  - security/high - quote copied by the proposed line reaches every lead: **fix** - a line that fails the unedited-line quote check is written as a fixed placeholder `(line withheld: ...)`; test `decisions-rejected.test.ts` "is withheld".
  - security/medium - reused audit reason (lead-writable) labelled as operator reason: **fix** - the block's Reason is always the current request's validated reason; test "crash after the audit line".
  - completeness/medium - `normalizeReason` truncation hides AC2: **fix** - request passes the raw string; 601 chars -> 400, test "600 characters pass".
  - security/medium - unfenced body multi-line/forging: **fix** - flattened by `normalizeLine`, capped 2000; test "flattened".
  - architecture/medium - dedupe key undefined: **fix** - (timestamp, lead, key or none, line); test "own block".
  - architecture/medium - residue with a note: **fix** - exact match first, then exactly one appended note; tests for both branches.
  - architecture/low - positional grammar: **fix** - documented; fixture block with a line starting `Reason:`.
  - completeness/low - refused requests creating files / post-check write errors: **fix** - pre-check never creates; header + first block in one write; EACCES etc. -> 409 `rejected_file_unwritable`.
  - architecture/low - lock-context coupling: **fix** - rejected path is resolved and checked in the reject path only.
  - completeness/low - validation order and heal time: **disclose** - reason validated after the entry is found (already_* answers win); heal retry uses the current time (documented).
  - performance/low - whole-file rewrite: **disclose** - linear scan, documented.
- **Known limitations:** validation order and heal-retry time (documented); file growth left to the reader.
- **Status:** 9 fixed, 2 disclosed, 0 declined

## Internal Architecture Review (architecture-internal-reviewer)
- **Ran:** yes
- **Severity:** medium
- **Summary:** Build option A (one org-wide file under the existing lock); state write order, dedupe key, trust level and growth in the contract.
- **Findings:**
  - necessity/low - build it, option A: accepted.
  - smallest-option/medium - countersign note is a separate feature: **decline** - it is part of the fixed contract the operator gave for this run; leadwright reads log keys from markers only, so the extra item is tolerated (checked in leadwright `lib/decided-keys.ts`).
  - security/medium - lead text fed to every lead (injection path): **fix** - contract says the reader presents it as quoted data; quote copies are withheld.
  - completeness/medium - write order and dedupe key: **fix** - audit -> block -> removal (text never gone before its block), identity documented and tested.
  - complexity-cost/medium - unbounded growth: **disclose** - the reader limits what a lead is fed (documented).
  - completeness/low - positional grammar: **fix** - documented, fixture pins it.
- **Known limitations:** file growth is the reader's to bound.
- **Status:** 3 fixed, 1 disclosed, 1 declined

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-11-28-decision-reject-reason/architecture_brief.md`
- **Verdicts:** glm=approve · openai=approve
- **Smallest thing that would do (per reviewers):** as proposed (option A).
- **Findings:** glm/low - say which source is authoritative for the repeat hint: **accepted** - the audit records stay authoritative for the webui repeat hint; the file is the leads' readable history (documented in the ADR). glm/low - confirm leadwright tolerates `- Note:`: **accepted-and-fixed** - checked, keys come from markers only.
- **Reconciliation:** the mini-plan rejected per-lead files because the contract fixes one org-wide file; both reviewers approved option A independently.

## External Plan Review
- **Verdicts:** glm=revise · openai=revise (both integrated)
- **Findings:** idempotency key (glm/medium, openai/high): accepted-and-fixed (identity documented + tested, new timestamp = new block). Note tolerance by leadwright (glm/medium): accepted-and-fixed (checked). Countersign after an audit-only crash (openai/high): accepted-and-fixed - countersign answers `reject_pending`, retry writes one block; tested. Residue with a lead `- Note:` (openai/medium): accepted-and-fixed. Rejected-file checks scoped to reject (openai/medium): accepted-and-fixed. Audience of the reason (openai/medium): accepted-and-fixed - label says leads read it. Separate note component (glm+openai/low): accepted - inlined in the row. Leading dash/hash in reason (glm/low): rejected-with-reason - items are positional and one line, a leading `-` cannot start an item. TOCTOU pre-check (glm/low): accepted - post-check write errors map to 409, removal is last.
