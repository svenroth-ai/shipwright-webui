# Mini plan - W3 reject with a record

1. Server: `POST /api/org/decisions/reject` under the existing FR-04.28 decisions lock (decisions-lock.ts). Parse the entry by (timestamp, leadId); append ONE `decision_rejected` line to `<leadsRoot>/<lead>/audit.jsonl` (author, lead, entryTimestamp, decisionKey, optional operator reason; never quote text) BEFORE removing the entry from `decisions-proposed.md`; a retry finds the audit line and only finishes the removal (exactly once, crash safe).
2. Countersign also appends one `decision_countersigned` line (same exactly-once rule); old entries keep working; countersign checks the audit file is usable before it writes the log.
3. Cross-action guards: reject refuses an already-logged entry; countersign finishes (does not approve) an entry whose reject was recorded.
4. `GET /api/org/decisions/rejected-keys` -> per lead rejected keys; client badges a proposal whose key was rejected before ("Repeat of a rejected proposal").
5. Client: Reject button + confirm step (optional reason) in the existing entry row; in-flight guard against double click; audit-view labels for both kinds.
6. Tests with real files (server), component tests, real-browser E2E.
