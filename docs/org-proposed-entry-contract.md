# Cross-repo contract: `decisions-proposed.md` entry format

Two repositories write/read `decisions-proposed.md` under one lock
(`<path>.lock`, proper-lockfile defaults): the leadwright daemon
(`lib/decisions-proposed.ts`, `renderEntry`) and this WebUI (countersign
routes only). Campaign `shadow-proposals-webui`, unit W1.

## Accepted header forms

| Form | Shape | Lead id comes from |
|---|---|---|
| WebUI (the target form leadwright switches to in S1-E; also what WebUI-written entries use) | `## [<timestamp>] <leadId>`, optionally preceded by a decisionKey marker line (then it is a marker-owned entry with the same fenced shape as the daemon form) | the header |
| Daemon (what leadwright writes today; legacy once S1-E lands) | `## Proposed <timestamp> — <decisionKey>`, preceded directly by the marker line `<!-- decisionKey: <encoded-key> -->` | the FIRST `- **Lead:** <id>` bullet after the closing fence line |

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

Mirrors that must stay in step: `server/src/external/org/proposed-grammar.ts`
and `client/src/lib/orgProposedGrammar.ts` (verbatim, text drift guard), plus
`proposed-entry-format.ts` / `orgDecisionsApi.ts` (`parseProposedDecisions`),
which the shared adversarial corpus holds in step.

## Compatibility gate and policies

- Fixture SHA-256 (computed over the LF-normalised content, so a CRLF checkout hashes the same):
  `e5f3bd48c1ca08e51e6015908ba502a40ffdd0c1e00db0755f05920fb3d75447`.
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
- **Legacy form / exit condition:** the daemon header (`## Proposed ...`) is the
  CURRENT leadwright form and becomes legacy only once S1-E switches to the WebUI
  header (with marker + fence); it can then be removed when no entry in that form
  remains in any `decisions-proposed.md`. The S1-E header switch is safe ONLY
  with the guarantees in this document: marker-owned `## [<ts>] <lead>` headers
  are first-class owners (fence masking + exact-shape check, same as the daemon
  form), a marker-less WebUI-form body with ANY structural line (fence line,
  decisionKey marker, `## Proposed` / `## ADR-` header) is unlisted, and
  leadwright rejects CR/LF (next bullet).
- **Open cross-repo issue (raise with leadwright):** the daemon dedups only
  against decisionKey markers in `decisions-proposed.md`. A countersigned entry
  moves its marker (kept as `<!-- decisionKey: ... -->`, first body line) into
  `decision_log.md`, so the daemon would accept the same key again unless it
  also scans the log or the WebUI leaves a tombstone. Not changed in W1.
- **A fence opens only where the daemon puts it, and only for the right
  file:** in `decisions-proposed.md` only a `## Proposed` header OR a `## [<ts>] <lead>`
  header with its decisionKey marker above it can own a fence (a `## ADR-` line
  in a marker-less WebUI-form body opens nothing); in `decision_log.md` only `## ADR-` headers can. The
  fence is the first line after the owner header (marker and blank lines
  skipped): a `⟦SHIPWRIGHT-FENCE:<nonce>⟧` line followed by the `[FENCED DATA`
  label, closing at the next identical line that is followed by the blank /
  Lead / Evidence tail.
  **Fail closed on the reading side (integrity beats availability):** in
  `decisions-proposed.md`, a fenced region that holds ANY structural line (a
  fence line, a decisionKey marker, a `## [`, `## Proposed` or `## ADR-`
  header) is ambiguous: the owner entry is NOT listed and nothing inside the
  region is listed either; an opener with no valid close poisons everything
  after it. Header-looking text in a quote therefore can never produce a listed
  (hence countersignable) forged entry; the price is that the lead's own entry,
  and after a dangling opener the following entries, go unlisted until the file
  is repaired. A marker-less WebUI-form body is checked the same way: any fence
  line, marker, `## Proposed` or `## ADR-` line in it makes it unlisted.
  Honest scope: a plain WebUI-form body has no fence and therefore no
  injection protection; only fenced quotes (marker-owned entries) are
  protected. Lead is identity, not authentication. `isCanonicalDaemonBlock` applies the same rule. In
  `decision_log.md` (single writer: the countersign) a fence opens only when the
  `## ADR-` header is directly followed by a decisionKey marker (the only shape
  countersign writes), a valid region is always masked but never crosses another
  `## ADR-` owner (header + marker), so a quoted `## ADR-` line never becomes a phantom logged entry or
  moves the next ADR number; ADR numbers above 9999 parse (`\d{4,}`). The
  upstream fix (leadwright rejects CR/LF in evidencePointer / decisionKey /
  leadId) is still required: it is the only thing that stops those unfenced
  fields from forging structure.
- **Adversarial corpus:** `__tests__/fixtures/adversarial-corpus.json` (input +
  expected `[timestamp, leadId]` list) is read by both the server and the
  client suites; leadwright should pin it as well.
- **Listed means countersignable:** a daemon entry whose Lead is not a valid
  lead id (`^[a-z0-9][a-z0-9-]*$`, the countersign route's rule) is not listed.
- **BLOCKING S1-E precondition for leadwright:** `evidencePointer` and
  `decisionKey` are written unfenced, `leadId` unconstrained. Leadwright MUST
  reject CR/LF in evidencePointer, decisionKey and leadId before real shadow use
  and before switching headers. The reading side cannot fully close it: an
  evidence pointer with a newline after a canonical entry can still make a
  following header look real, and a decisionKey with a newline makes that one
  lead's entry (and the marker-less WebUI headers after it) unlisted - a
  single-lead denial of service via one unfenced newline.
- **Defence in depth (S1-E):** leadwright should also reject lone CR, U+2028 and U+2029 in evidencePointer / decisionKey / leadId. The reader tolerates U+2028/U+2029 inside a value (the entry stays listed); a lone CR inside a Lead/Evidence line fails closed (the entry and everything after it is unlisted).
- **Availability trade-off, no UI signal yet:** whatever fails closed is simply
  NOT LISTED; the operator sees nothing (no "N entries skipped" signal exists
  yet). That covers ambiguous fenced regions, dangling openers (everything after
  one), non-ISO daemon timestamps, structural lines in a WebUI body, and
  WebUI-form headers directly after an unlisted marker-owned entry. A skipped
  signal is a follow-up.
- **Marker grammar:** exactly `<!--[ \t]*decisionKey:...-->` (plain space/tab only); leadwright must match it, or reject anything looser, when deduplicating.
- **Upstream requirement (leadwright):** the per-entry fence nonce must be
  random, generated AFTER the quote is known, and the quote must not contain it.
  The reader's close rule (first identical fence line followed by the
  Lead/Evidence tail) relies on that; a guessable or reused nonce lets a quote
  close its own fence early.
- **Accepted / open:** an evidence pointer carrying `\n## [<ts>] <lead>` after a
  LISTED marker-owned entry can still list a marker-less WebUI header (the
  reader does not taint headers after a listed entry, because legitimate mixed
  files would lose entries). Leadwright's CR/LF rejection is the blocking fix.
- **Leadwright dedup marker regex:** it is currently looser (`/<!--\s*decisionKey:\s*(.*?)\s*-->/g`, unanchored). It must be anchored per line and use `[ \t]` (plain space/tab) like the reader, so both sides agree on what a marker is.
- **Tracked leadwright follow-up (before real shadow use):** dedup/tombstone -
  the daemon dedups only against markers in `decisions-proposed.md`, so it
  accepts a countersigned decisionKey again (the marker moves to the log).
- **Only the exact `renderEntry` shape is listed (and so countersignable):**
  `[marker] header, blank, fence + label + text + fence, blank, Lead bullet,
  Evidence bullet`, nothing after. Any extra line (an evidence pointer or
  decisionKey carrying a newline) makes the entry non-canonical: it is not
  listed and cannot be moved into `decision_log.md`. A fence also only counts
  when its closing line is followed by that Lead/Evidence tail, and a
  WebUI-form header after a non-canonical / ambiguous marker-owned entry (0, 1
  or 2 blank lines between) is not an entry. The timestamp of a marker-owned
  header must be ISO (`ISO_TIMESTAMP_RE`, the countersign route's rule); a
  leading BOM is ignored by both parsers.
  Residual risk, upstream: a lead can still write a complete, canonical-looking
  entry as itself (the Lead id is self-reported by the lead; the daemon does not
  verify it against the beat's real lead). Leadwright must verify leadId and
  reject newlines in evidencePointer, decisionKey and leadId (S1-E).

## Display convention (W2, read-only, client only)

The operator window shows each entry as: proposed line, lead, beat, evidence
pointer and each quote as its own element (`client/src/lib/orgProposedView.ts`).
Nothing here changes identity, listing or countersign.

- **Beat** comes from the fence label (`origin: <lead> beat <beatId>,`); absent = not shown.
- **Proposed line** = the fenced lines that do not start with `>`; **a quote** = one
  fenced line starting with `>`, optionally ending ` — <pointer>` (split at the LAST
  ` — `). A quote without its own pointer inherits the entry's Evidence pointer.
- **Pointer** is `session:time:number` (the S1-E format) or the legacy
  `session <id> at <ISO time>, message <n>`. Anything else (empty, free text) is shown
  as **unknown source** (with the raw text), never hidden.
- One line per quote (a continuation line counts as part of the proposed line). A quote whose
  ` — ` suffix is not a valid pointer shows the raw suffix beside "unknown source" (nothing is
  dropped); an absent pointer shows "unknown source (none given)". An entry that is not
  fenced falls back to the sanitised markdown body.
- Quote and pointer text is rendered as plain text only (never markdown/HTML).
- No "Open source session" link: a pointer's session id has no resolvable target in the
  WebUI yet (short ids are not mapped to tasks); it is added only where a target exists.
- **PROPOSAL, needs leadwright sign-off in S1-E:** quotes as `> text — pointer` lines inside the
  fence. Until agreed and pinned as a fixture in both repos, entries show no quotes unless the lead
  already writes this shape. Tracked next to the other S1-E preconditions.
- A suffix after ` — ` is split off only when it looks like a pointer attempt (`session …` or
  `<id>:…`); otherwise the whole line is quote text and shows the entry's evidence pointer,
  labelled "(entry evidence)". Empty `>` lines are skipped.
- Unfenced (marker-less) bodies stay sanitised Markdown with no quote extraction.
- The line/quote classification (`fencedParts`) and the pointer parser (`parseSourceRef`) live in the
  mirrored grammar (W4); the server countersign and the client view use the same rule.

## Countersign with an edited line (W4)

- Request: `POST .../decisions/countersign` takes an optional `line` (the operator's wording). The server
  normalises it to one line (control characters become a space, max 2000 characters) and decides itself
  whether it differs from the proposed line (`edited` in the response); the client sends no flag.
- Refused with 400 and nothing changed: `line_empty`, `line_too_long`, `line_contains_quote` (the edited
  line shares a run of 20 or more characters with a quote of the entry, compared case-insensitively after Unicode folding: NFKC, so non-breaking and wide forms, and zero-width format characters removed), `edit_not_supported` (an entry
  without a fence has no line to edit; its plain countersign is unchanged).
- **A fenced entry never carries its fence, quotes, Lead/Evidence bullets or original wording into
  `decision_log.md`**, edited or not. The log block is `## ADR-NNNN [<timestamp>] <leadId>`, the decisionKey
  marker (only when the key is a plain identifier), `<!-- proposal: <32 hex> -->` (a sha256 prefix of the
  proposed block, written only when the fence nonce has at least 128 bits (32 hex) - it hides the block only
  because that nonce is unguessable; a shorter nonce gets no fingerprint and crash residue is then refused; it tells
  crash residue from a different proposal with the same identity, and is read only at its fixed place in a block
  of exactly this shape), a blank line and `- <line>`. The list prefix keeps any text
  of the line from becoming a header, marker or fence.
- Audit (`decision_countersigned`, additive fields): `data.edit` = `edited` | `approved_as_proposed`,
  `data.evidence` = `{session, time, message}` when the entry's pointer has a known shape, else `null`
  (free text is never copied). The summary ends `(edited)` / `(approved as proposed)`. No quote, no original text.
- A fenced line that starts with `>` after optional blanks is a quote. An UNEDITED line goes through the same
  checks (empty, too long, repeats a quote) and the operator must edit it when it fails. Quote needles include
  the text without its ` — <pointer>` suffix. Evidence pointer fields are bounded (session 1-64 chars, message
  up to 9 digits). Invisible characters (Unicode format characters such as tag characters, bidi overrides and zero width, and C1 controls) are removed from every line before it is shown, sent or logged, so the log never carries them. Quotes under 20 characters are not guarded, the quote region is also checked as one joined text, and a paraphrase or translation of a quote is not detected (documented limits). decisionKey is lead-written and may carry wording.
- Accepted limits (tracked follow-ups, not built): the client always sends the line it displayed, so only seen text is logged and a changed line is audited as edited, but
  it sends no fingerprint of the quotes/evidence it displayed, so a same-identity rewrite of those between view and click is approved; a lead can pre-plant a
  `decision_countersigned` line in its own audit.jsonl; a missing lead folder skips the audit line.
- Retry after a crash between log write and removal compares the rest of the block with the line the log
  already holds (a retry that names another line than the logged one is answered `loggedLineDiffers: true`; this applies to W4 line blocks only, not pre-W4 whole-entry blocks). The evidence session id (up to 64 identifier characters) is lead-written like the decisionKey: an accepted limit; a log block in the pre-W4 shape (whole entry) still matches.

