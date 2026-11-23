# Mini-plan W1: one entry format in both repos
1. New server module proposed-entry-format.ts: parseProposedEntries/toLoggedBlock accept `## [ts] lead` and `<!-- decisionKey --> + ## Proposed ts — key` (lead = last `- **Lead:**` bullet). Marker line belongs to the entry below. decisions-lock.ts re-exports.
2. countersign-core idempotent-retry body comparison uses toLoggedBlock so both forms compare like-for-like.
3. Client orgDecisionsApi.parseProposedDecisions mirrors the grammar (rule 7: no cross-package import).
4. Pin daemon sample fixture (server tests), document contract docs/org-proposed-entry-contract.md; leadwright pins the same file (cross-repo, out of this repo).
5. Tests: parse both forms, countersign once + retry for both, marker removal, spoofed Lead, CRLF, client parse.
Risk: old WebUI-form entries must behave identically (existing 340 server tests stay green).
