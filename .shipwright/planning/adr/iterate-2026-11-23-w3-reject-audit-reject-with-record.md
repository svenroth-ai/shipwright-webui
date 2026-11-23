# Reject a proposed entry, with an audit record (W3, campaign shadow-proposals-webui)

Run: `iterate-2026-11-23-w3-reject-audit`. Spec: `.shipwright/planning/iterate/campaigns/shadow-proposals-webui/sub-iterates/W3-reject-audit.md`.

## Decision
- `POST /api/org/decisions/reject` removes one entry from `decisions-proposed.md` under the same FR-04.28 lock countersign uses, and appends one `decision_rejected` line to the proposing lead's `audit.jsonl`. Countersign now appends one `decision_countersigned` line.
- Record: `action`, `author`, `entryTimestamp`, `decisionKey`, plus the operator's optional `reason` (reject) or `adr` (countersign). Never the proposed text or a quote.
- Exactly once, crash-safe: audit line first, removal second. A retry finds the line (kind + entryTimestamp [+ key]) and only finishes the removal. Reject refuses an entry already logged; countersign finishes (not approves) an entry whose reject was recorded but not completed; countersign checks the audit file is readable before it writes the log.
- Repeat: `GET /api/org/decisions/rejected-keys` returns each lead's rejected keys; the window badges a proposal whose key was rejected for a different entry. Key-less (WebUI-form) entries record `decisionKey: null` and are never a repeat.

## Accepted limits
- Author is the OS account of the server process, not a verified identity (local single-user tool, same exposure as countersign).
- `audit.jsonl` is leadwright's per-lead file: the audited lead can also write it, so the record is a trail, not tamper-proof. No fsync (crash-safe against process death, not power loss).
- No CSRF/origin hardening beyond what the other `/api/org/*` writes have.
- Fix round (reviews of 09c23f05): a rejected row now leaves the window at once; a quote-free confirmation line replaces it (brief: a rejected entry disappears).
- Fix round: countersign never deletes an entry because an audit line says it was rejected (a lead-writable audit.jsonl could forge that line). It answers 409 `reject_pending` and changes nothing; the operator finishes with Reject, whose retry path completes the removal.
- Open (cross-repo follow-up): a reused (timestamp, decisionKey) identity can match an earlier rejected entry, so the daemon's timestamp meaning must be pinned; leadwright must read `decision_rejected` before proposing; a quote-less or duplicate proposal can re-appear.
- Fix round: a lead without a folder answers 404 `lead_unknown` (shown as "Can't reject: this lead has no folder", not "resolved elsewhere"); a symlinked lead folder is refused with 403 before any audit file is created; a torn last audit line no longer swallows the next record.
- The two new audit kinds are a cross-repo contract; leadwright's reader should pin a sample (follow-up).

## Internal plan-arm review findings (recorded verbatim in substance; fixes are in commit ace6cd909)

The reviewers ran before the final commit. spec, code and doubt are delegated to the orchestrator (3f-bis) for a re-review of the final commit.

### architecture-internal-reviewer (verdict: approve, with conditions)

- **medium** - W3 makes the WebUI a writer of <leadsRoot>/<lead>/audit.jsonl for the first time; leadwright's daemon can write the same file at the same moment under a different lock. Windows appends are not guaranteed atomic; BRIEF 6 lists who else writes audit.jsonl as not yet checked.
  - Disposition: accepted limit, recorded in the ADR (multi-writer file, single-write append like the existing beat_recovered writer, no fsync); leadwright-side check stays an open cross-repo item; write-surface map entry left to the doc owner
- **medium** - Audit record and repeat detection depend on a decisionKey, but only the daemon header carries one; WebUI-header entries have none. Fallback undefined.
  - Disposition: fixed in ace6cd909: key-less entries record decisionKey null, never count as a repeat, tested
- **medium** - The spec requires a reason in the audit record; the design left reason out, and it is the one free-text field that could carry quote text.
  - Disposition: fixed in ace6cd909: optional reason, one line, 280 chars, operator-authored, hint not to paste quotes
- **low** - Crash between audit line and removal leaves the entry listed with its key in rejected-keys, so it is badged as a repeat of itself; countersign on it would leave both a rejected and a countersigned record.
  - Disposition: fixed in ace6cd909: badge excludes the same entry timestamp; countersign finishes the removal (matched on timestamp and key) instead of approving
- **low** - GET rejected-keys adds a second endpoint; a repeat flag could ride on the existing proposals response.
  - Disposition: not adopted: the proposals list is read as a raw file by the client parser (no server list endpoint exists), so the separate read-only endpoint is the smaller change
- **low** - Author is the OS username of the server process, not a verified person.
  - Disposition: accepted limit in the ADR; route mounted beside countersign with the same host middleware
- **low** - decision_rejected and decision_countersigned are new record kinds in a file leadwright also reads: an unwritten cross-repo contract.
  - Disposition: open follow-up for leadwright, recorded in the ADR

Summary: Approve with conditions: a reject route writing an audit line under the existing decisions lock is the smallest mechanism that meets the operator decision. Settle audit.jsonl coexistence, the missing-key fallback and the reason field.

### opus-plan-reviewer (verdict: revise, severity high)

- **high** - Reject skipped the decision_log check when the entry was still in the proposed file. After a countersign that wrote the log but crashed (or failed the rename) before the proposed-side removal, Reject wrote decision_rejected and removed the entry: the proposal was both countersigned and rejected, and the countersigned audit line could never be completed.
  - Disposition: fixed in ace6cd909, test: reject of an already-logged entry is refused and records nothing
- **high** - Countersign ignored a half-finished reject: reject writes its audit line first, so a crash/rename failure leaves decision_rejected with the entry still listed (even badged as a repeat); clicking Countersign would mint an ADR for a rejected proposal.
  - Disposition: fixed in ace6cd909 (matched on timestamp AND decisionKey after the code review), tests for both cross-action cases
- **medium** - The audit record sits in a file the audited lead can edit; exactly-once is decided by a matching line, so a forged decision_rejected line makes a later real reject skip its own record, and a lead can delete lines to remove the repeat badge.
  - Disposition: accepted limit, documented in the ADR (the brief names audit.jsonl as the audit view)
- **medium** - If the audit write fails (symlink, unreadable, unwritable) countersign gets stuck half-done: entry logged and still proposed, every retry failing the same way.
  - Disposition: fixed in ace6cd909: assertAuditAppendable before the log write; the residual-cleanup path treats the audit as best-effort so an approved entry never stays listed
- **medium** - Durability is overstated: nothing is fsynced, so on power loss the rename may survive while the appended audit line is lost.
  - Disposition: accepted limit, reworded in decisions-audit.ts and the ADR
- **low** - decisionKey has no cap or character rule and goes verbatim into summary and data; a lead-influenced key could carry quoted text.
  - Disposition: fixed in ace6cd909: key must match a 200-char slug pattern, else null (server and client mirror, tested)
- **low** - The reject reason can still carry quote text; only the UI hint protects it.
  - Disposition: accepted: reason is operator-authored, hint shown, documented in the ADR
- **low** - Auditing can create a directory for an unknown lead (mkdir recursive), since neither route checks the org chart.
  - Disposition: fixed in ace6cd909: reject returns 404 lead_unknown, countersign skips the audit, nothing is created
- **low** - Already-rejected matching ignores the key (timestamp only) and has no body check.
  - Disposition: accepted, very unlikely collision; countersign side now matches on key
- **low** - Countersign did not map a lock timeout (ELOCKED gave 500).
  - Disposition: fixed (already in the first commit): countersign maps ELOCKED to 409
- **low** - No cross-site request protection on /api/org/* writes (text/plain body parsed by c.req.json), so reject is a new destructive action reachable cross-site.
  - Disposition: accepted limit, not new to this unit (same exposure as countersign), recorded in the ADR; follow-up
- **low** - rejected-keys reads each lead's whole audit.jsonl (up to 50 leads); errors silently become an empty list.
  - Disposition: accepted, only on open and after a decision

Summary: Revise: normal paths hold (double click, retry, crash between audit line and removal give one audit line; both writes under the FR-04.28 lock; no proposal text in the record), but two crash cases produced contradictory records (findings 1 and 2) and the audit trail lives in a lead-writable file. Findings 1 and 2 had to be fixed before merge.

## External plan review findings (glm: revise, openai: revise)

| Finding | Disposition |
|---|---|
| Retry must match (lead, entryTimestamp, decisionKey), not key alone | accepted-and-fixed: record identity is kind + entryTimestamp + key |
| Countersign and reject must hold the same lock | accepted-and-fixed: both run in `withDecisionsLock` (verified) |
| (timestamp, leadId) may match two entries | accepted-and-fixed: 409 `duplicate_proposal_identity` on both routes |
| Audit "usable" check must be inside the lock | accepted-and-fixed: `assertAuditAppendable` runs inside the lock before the log write |
| Re-click Reject must recover a half-rejected entry | accepted-and-fixed: retry finds the audit line and finishes the removal (tested) |
| Bound and sanitise the operator reason | accepted-and-fixed: one line, 280 chars, JSON-serialised |
| rejected-keys read path / staleness | accepted: re-read per request, refetched after every decision |
| HIGH countersign recovery order | accepted-and-fixed: log, then audit, then removal, each step idempotent; failures between steps tested |
| HIGH partial JSONL append / atomic rewrite | accepted-and-fixed: single-write append, readers skip a torn line, proposed file rewritten with the existing atomic write; process death only, not power loss (limit above) |
| Recorded reject takes precedence over countersign | accepted-and-fixed (tested both orders) |
| Legacy entries without a key | accepted-and-fixed: `decisionKey: null`, never a repeat |
| Authorization / identity | accepted: same host check as countersign, author derived server-side, lead id validated |

## External code review findings (glm: revise, openai: revise)

| Finding | Disposition |
|---|---|
| high: E2E wipes the real `~/.claude/leads` | rejected-with-reason: the E2E runs under `isolated-stack.mjs`, which gives the whole run an ephemeral HOME; same pattern as the 12 existing org specs |
| medium: `already_rejected` decided on timestamp only | rejected-with-reason: it applies only when the entry is already gone; a new entry reusing the timestamp is still present and is audited with its own key |
| low: assert the entry is gone after the double click | accepted-and-fixed in 8556ba6cd |
| low: cosmetic confirm-panel state, swallowed-audit branch has no test | accepted, no change |
| high (openai): countersign recovery swallows an audit failure and removes the entry | accepted-with-reason: the log with its ADR number is authoritative; the audit file is prechecked before the log write, so this needs the file to break in between; keeping the entry listed forever was the worse failure found by the doubt review |
| medium (openai): rejected-keys only reads 50 leads | accepted-and-fixed in 8556ba6cd: the client batches by 50 |
