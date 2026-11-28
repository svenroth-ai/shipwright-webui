# Mini-Plan: iterate-2026-11-28-decision-record-evidence

## 1. Files

| File | Change |
|---|---|
| `server/src/external/org/proposed-evidence-pointer.ts` + client mirror `client/src/lib/orgProposedEvidencePointer.ts` | edit: `rejected` / `decision` kinds (verbatim mirror) |
| `server/src/external/org/proposed-line.ts` | edit: `auditEvidence` for the two kinds |
| `server/src/external/org/decision-record-evidence.ts` | new: positional readers (port of leadwright) + fail-closed file read + `resolveRecordEvidence` |
| `server/src/routes/org-writes.ts` | edit: `GET /api/org/decisions/record-evidence` |
| `client/src/lib/orgProposedView.ts` | edit: `describeSource` for the two kinds; fence quotes / inherited record pointers -> unknown |
| `client/src/lib/orgRecordEvidenceApi.ts` | new: fetcher + response type |
| `client/src/lib/orgLearningLabel.ts` | new: port of leadwright `parseLearningLabel` + `isLearningKey` |
| `client/src/components/org/OperatorWordsEvidence.tsx` | new: resolves and renders the operator's words / fail-closed notice |
| `client/src/components/org/LearningLabelView.tsx` | new: label chips + warning |
| `client/src/components/org/DecisionEntryDetail.tsx`, `DecisionLineEditor.tsx`, `DecisionEntryRow.tsx` | edit: wire both |
| `server/src/external/org/__tests__/fixtures/decision-log-countersigned-sample.md` | new fixture |
| tests (server unit + route, client unit, e2e) | new |
| `docs/org-proposed-entry-contract.md` | new section + fixture hash |
| `.shipwright/planning/01-adopted/spec.md` | FR-01.71 ACs |

## 2. Work breakdown

1. Pointer grammar (both mirrors) + `auditEvidence` — tests: parse table (valid/invalid times, lead ids, ADR digits, length cap, excerpt-first), mirror-equality test passes.
2. `decision-record-evidence.ts` readers — tests: leadwright's own cases ported (positional, `Reason:` lead line, two ADR blocks, fenced heading, CRLF/BOM, note-less block), plus file states (missing, symlink, dir, oversized).
3. Route — tests: 400 malformed pointer / quote too long, 200 per status, host gate inherited.
4. Fixture test: real `handleCountersignRequest` on a learning proposal with edited label + note, then a plain decision with a note; bytes == fixture; `decisionNote` reads both notes back; line block shape holds the edited label verbatim.
5. Client: view + `orgLearningLabel` tests (leadwright `parseLearningLabel` cases), component tests for `OperatorWordsEvidence` (each status) and `LearningLabelView`, editor live reading.
6. e2e spec on the org page (fixture leadsRoot), contract doc, spec.md.

## 3. Component hierarchy

`OrgDecisionsProposedModal` > `DecisionEntryRow` > `DecisionEntryDetail` > (`LearningLabelView` | line) + `OperatorWordsEvidence`; editor slot `DecisionLineEditor` > `LearningLabelView` (live).

## 4. Data model

None (read-only). Audit `data.evidence` gains two additive shapes.

## 5. Test strategy

Vitest server + client units, one Playwright flow (org page with a temp leadsRoot like the existing evidence-forms spec).

## 6. Alternative approach

Resolve on the client by fetching `decision_log.md` (already readable through `/api/org/file`) and allowlisting
`decisions-rejected.md` for reads, then parsing in the browser. Rejected: the org file allowlist is shared by read and
PUT, so adding the rejected file would make it writable through the generic route (the contract says only reject writes
it); and the client would then need a third copy of the positional reader. The server route keeps one reader, reads
read-only, and returns only the words relevant to one pointer.
