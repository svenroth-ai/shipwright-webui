# Iterate Spec: org-proposals-hardening

- **Run ID:** iterate-2026-11-24-org-proposals-hardening
- **Type:** change
- **Complexity:** medium (touches the org decision write routes, the audit trail, the mirrored grammar; cross_component not hit)
- **Status:** built, in review

## Goal
Close every relevant review follow-up of the shadow-proposals-webui campaign (PRs 624-627) in one iterate: a cross-site guard on the
org writes, an actionable `audit_unwritable` answer, the operator's own audit record next to a lead-written line, shared helpers, stricter
text rules on the logged line, a stale-entry check and a skipped-entries signal, plus the small leftovers.

## Acceptance Criteria
- [x] A (guard): a `Sec-Fetch-Site: cross-site` or `same-site` request or a non-JSON POST to an org write is refused (403 / 415), nothing changes.
- [x] B: an unusable lead audit file gives `409 audit_unwritable` (countersign + reject), nothing changes (unless the file fails only after the pre-check: then `logged:true`, the entry stays listed and a retry finishes it), the window shows a blocked message.
- [x] C: Reject writes its own record unless an identical one (author, action, reason) already exists; the response carries `recorded`; the window never claims a record that was not written. Limit: a same-user lead that reproduces author+reason exactly can pre-empt the record.
- [x] D: `ISO_TIMESTAMP_RE` + default author + identity parsing live in `decision-request-common.ts`; the audit append lives in `audit-append.ts` (pure move, own commit).
- [x] E: braille blank, private use and lone surrogates are removed, Unicode spaces become a plain space, VS16 after an emoji base survives, ZWJ stays stripped; the quote fold agrees; an unedited `Ship 🚀 Prüfung 日本` logs exactly, `edited:false`.
- [x] F: countersign and reject take a block digest; a rewrite between view and click is `409 entry_changed`; crash retry still heals.
- [x] G: the window shows one `role=status` line "N entries could not be read and were skipped (lead: ...)", no content.
- [x] H: Rejected notice cleared when another action starts; reject result status built once and pinned like countersign; `loggedLineDiffers` documented as W4-line-blocks-only.

## Spec Impact
- **Classification:** modify
- **MODIFY:** FR-01.71 - six acceptance criteria appended (stale entry, unusable audit file, own audit record, skipped entries, cross-site guard, text rules).
- **ADD / REMOVE:** none

## Out of Scope
- The leadwright side (daemon renderer, dedup/tombstone) - upstream issues stay as documented in the contract.
- Authenticating the browser caller (the guard closes the drive-by browser path only).
- A server endpoint for the skipped signal (the client parser reports it from the raw file it already reads).

## Design Notes
- The stale-entry digest is SHA-256 (first 32 hex) of `blockForDigest(block)`; the client has its own synchronous SHA-256 because
  `crypto.subtle` is missing on a plain-http LAN address. Parity is pinned on the shared daemon sample.
- "Own record" matching replaced "any line naming the entry": kind + entry timestamp + decisionKey + author + action + (reason | ADR).
  Countersign of an entry with a reject line (forged or residue) stays `409 reject_pending`; Reject is the way out.
- The VS16 exception is `Extended_Pictographic + U+FE0F` and `[0-9#*] + U+FE0F + U+20E3`; everything else in
  Default_Ignorable (incl. other variation selectors) is stripped. The fold strips the selector too.

## Affected Boundaries
| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `decisions-audit.ts ensureDecisionAudit` | lead `audit.jsonl` readers, `rejectedKeys` | JSONL (unchanged shape) |
| client `orgBlockDigest.ts` | server `proposed-line.ts blockDigest` | 32 hex digest of the block text |
| `proposed-grammar.ts` GRAMMAR section | client `orgProposedGrammar.ts` | verbatim mirror (drift test) |

## Confidence Calibration
- **Boundaries touched:** audit.jsonl (append), decisions-proposed.md / decision_log.md (unchanged format), client-server digest, grammar mirror.
- **Empirical probes run:** real Hono router requests with text/plain and cross-site headers; audit.jsonl as a directory (real EISDIR/EPERM path); a forged lead line then reject then retry (exactly once); digest parity against node crypto and pinned values; real-browser E2E (chromium, isolated stack) for the skipped line, entry_changed and audit_unwritable.
- **Test Completeness Ledger:** see the F5 block; every behavior of A-H is `tested`.
- **Confidence-pattern check:** depth - the first probe round found no defect after the CRLF-sensitive ones were fixed; breadth - 0 untested-testable.

## Verification
- **Surface:** web
- **Runner command:** `node e2e/isolated-stack.mjs --project=chromium e2e/flows/org-page.decisions-proposed` (from `client/`)
- **Evidence path:** Playwright report of the isolated stack run (11 tests, 3 new)
