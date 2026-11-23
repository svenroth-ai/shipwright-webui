# Architecture brief - W3 reject with a record

Question: how does a local single-user web UI let the operator reject a lead's proposed learning and keep a record of who decided what?

Options:
- A. A reject route under the existing decisions lock that appends an audit line to the lead's existing `audit.jsonl` (the file the audit view already reads) and removes the entry.
- B. A new decisions-audit store owned by the WebUI (separate file next to `decision_log.md`), with the audit view reading both.
- C. Do nothing: the operator edits the proposed file by hand; no record of rejections, no repeat detection.
- D. Park/hide entries in the UI only (client state).

Constraints: the leadwright daemon also writes the proposed file and `audit.jsonl` under its own conventions; the WebUI must only change the proposed file through the locked countersign path; the record must never hold quoted chat text; old entries must keep working.
