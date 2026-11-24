# Mini-plan: org-proposals-hardening

Run: iterate-2026-11-24-org-proposals-hardening (change, medium). Written after the build (the work ran as one autonomous pass); the
external review below therefore reviews the plan AND the finished approach.

## Work breakdown
1. D1 (own commit): move `appendAuditLine`, `ensureAuditFile`, `endsMidLine`, `resolveParentLeadId` into `audit-append.ts`.
2. Server: `decision-request-common.ts` (ISO regex, `osAuthor`, `parseDecisionIdentity`, `FINGERPRINT_RE`, `auditUnwritableResult`);
   `AuditUnwritableError` + own-record matching in `decisions-audit.ts`; `performCountersign` / `performReject` take a block digest and
   return `entry_changed`; reject returns `recorded`; cross-site guard middleware on `/api/org/*`.
3. Grammar (server + byte-identical client mirror): strip braille blank, private use, lone surrogates; Unicode spaces to a plain space;
   keep U+FE0F after an emoji base; `blockForDigest`.
4. Client: synchronous SHA-256 digest, parser reports skipped entries, `SkippedEntriesNotice`, truthful reject notice, blocked statuses for
   `entry_changed` / `audit_unwritable`, notice cleared on a new action, one `settle()` for statuses.
5. Contract doc + ADR + spec ACs; tests (server hardening suite, client suites, three real-browser E2E).

## Alternative considered
- Fingerprint = the whole displayed block sent to the server (no hash): rejected - bigger requests and the server would compare text the
  client could have altered anyway; a digest is the smaller contract and also fine for the optional-for-gated-callers rule.
- `crypto.subtle` for the client hash: rejected - unavailable on a plain-http LAN origin; a 40-line SHA-256 is pinned against node crypto.
- Making countersign ignore a lead-written reject line: rejected - an audit line alone must not decide a proposal; Reject is the cure.
- Server endpoint for the skipped signal: rejected - the client already reads and parses the raw file; no new read surface.
