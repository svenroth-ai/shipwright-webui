# Architecture brief: org-proposals-hardening

Question: should these eight hardening changes be built at all, and is each the smallest thing that does the job?

Context: the operator decides lead-written proposals (`decisions-proposed.md`) in a WebUI window: countersign (moves a line into `decision_log.md`, writes an audit record into the lead's `audit.jsonl`) or reject (audit record, entry removed). Both run under one file lock. The lead is a semi-trusted writer of the proposals file and of its own audit file.

Changes and the reason for each:
- A: cross-site guard on `/api/org/*` writes (header check + JSON content-type), same as the reminder routes. Reason: a drive-by browser POST could decide a proposal.
- B: `409 audit_unwritable` instead of a generic 500. Reason: the operator cannot act on a 500.
- C: a decision writes its OWN audit record unless an identical one by this webui exists. Reason: a lead-written matching line made Reject write nothing and Countersign answer 409 forever.
- D: shared helper modules (pure move + one common module). Reason: two request handlers duplicated the same rules.
- E: stricter text rules on the logged line (blank-rendering code points, Unicode spaces), emoji presentation kept. Reason: the log is read by agents as authority.
- F: the client sends a digest of the entry block it displayed; the server compares under the lock (`409 entry_changed`). Reason: a lead can rewrite quotes/evidence between view and click.
- G: the window shows "N entries could not be read and were skipped (lead: ...)", count and lead ids only. Reason: fail-closed parsing hid damaged entries silently.
- H: small client leftovers.

Alternatives already weighed: send the whole block instead of a digest; `crypto.subtle` for the client hash (unavailable on plain http); a server endpoint for the skipped signal; ignoring a lead-written reject line in countersign.

Files: `server/src/external/org/*`, `server/src/routes/org*.ts`, `client/src/lib/orgProposedGrammar.ts` (verbatim mirror), `client/src/lib/orgBlockDigest.ts`, `client/src/components/org/*`, `docs/org-proposed-entry-contract.md`, spec `.shipwright/planning/iterate/2026-11-24-org-proposals-hardening.md`.
