# Cross-repo contract: `decisions-proposed.md` entry format

Two repositories write/read `decisions-proposed.md` under one lock
(`<path>.lock`, proper-lockfile defaults): the leadwright daemon
(`lib/decisions-proposed.ts`, `renderEntry`) and this WebUI (countersign
routes only). Campaign `shadow-proposals-webui`, unit W1.

## Accepted header forms

| Form | Shape | Lead id comes from |
|---|---|---|
| WebUI (legacy, still accepted) | `## [<timestamp>] <leadId>` | the header |
| Daemon (what leadwright writes today) | `## Proposed <timestamp> — <decisionKey>`, preceded directly by the marker line `<!-- decisionKey: <encoded-key> -->` | the FIRST `- **Lead:** <id>` bullet after the closing fence line |

Identity of an entry, for both forms: `(timestamp, leadId)`. The marker line
belongs to the entry below it: it is part of that entry's block and is removed
with it on countersign (blank lines between marker and header are tolerated).

Injection rules (quote and evidence pointer are lead-written free text):
header lines between a daemon entry's two identical `⟦SHIPWRIGHT-FENCE:<nonce>⟧`
lines are NOT headers (a quote cannot split an entry or forge an identity),
and the lead is the first bullet after the closing fence line, so neither a
`- **Lead:**` in the quote nor one smuggled into the evidence pointer wins.
Evidence shown to the operator is read from the same region. A daemon entry
without a Lead bullet has no identity and is not listed. Leadwright should
additionally reject or escape CR/LF in evidencePointer, leadId and decisionKey.

On countersign the log header becomes `## ADR-NNNN [<timestamp>] <leadId>` for
both forms; a daemon entry keeps its marker line as the first body line.

## Pinned sample

`server/src/external/org/__tests__/fixtures/decisions-proposed-daemon-sample.md`
is a byte-for-byte rendering of `renderEntry` output (two entries). The same
file must be pinned in leadwright (campaign `shadow-slice-1`, unit S1-E) as a
test fixture; a change to the daemon's entry shape must update both copies in
the same release train. Rollout: WebUI tolerant of both forms first, then
leadwright switches to the WebUI header form, then W2-W4.

Mirrors that must stay in step: `server/src/external/org/proposed-entry-format.ts`
and `client/src/lib/orgDecisionsApi.ts` (`parseProposedDecisions`).

## Compatibility gate and policies

- Fixture SHA-256 (LF bytes, pinned `-text` in `.gitattributes`):
  `a2260319cd6c2ba17fdaf7e21a34f2ed3cf43933c2f150b42ae750c8bcb4163b`.
  The leadwright copy must hash to the same value; a test here asserts this
  document names the fixture's current hash. Format changes: update the
  daemon renderer, both fixtures and this hash in the same release train, WebUI
  tolerance first.
- **Lead is identity, not authentication.** The `- **Lead:**` bullet only keys
  the entry (with the timestamp) and is shown to the operator; nobody should
  build access control on it. Anyone able to write the file can write it.
- **Orphan or stale markers** (marker with no entry below, or a key that no
  longer matches its header) are neither listed nor validated; an orphan rides
  with the block above it (and leaves with it on countersign). Dedup stays the daemon's job.
- **Retry identity** is the logged `(timestamp, leadId)`, never block text.
  Block text is compared only when a still-proposed entry has that identity,
  to tell crash residue (same body, removed) from a genuine second proposal
  (different body, reported as `duplicate_identity`).
- CRLF files parse; the rewritten log header line is LF-terminated (legacy behaviour, unchanged).
- **Legacy form / exit condition:** once leadwright (S1-E) writes the WebUI
  header, the daemon header is a legacy form; it can be removed when no entry in
  that form remains in any `decisions-proposed.md`.
- **Open cross-repo issue (raise with leadwright):** the daemon dedups only
  against decisionKey markers in `decisions-proposed.md`. A countersigned entry
  moves its marker (kept as `<!-- decisionKey: ... -->`, first body line) into
  `decision_log.md`, so the daemon would accept the same key again unless it
  also scans the log or the WebUI leaves a tombstone. Not changed in W1.
