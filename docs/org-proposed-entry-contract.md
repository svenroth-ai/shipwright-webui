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
- **Availability trade-off, with a signal:** whatever fails closed is NOT LISTED, but the operator now
  sees that something was left out (see "Skipped entries" below). That covers ambiguous fenced regions,
  dangling openers (everything after one), non-ISO daemon timestamps, structural lines in a WebUI body, and
  WebUI-form headers directly after an unlisted marker-owned entry.
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
- **Pointer** is `session:time:number` (the S1-E format), the legacy
  `session <id> at <ISO time>, message <n>`, a file line `file:<project>/<path>#L<n>` (shown as
  `<project> · <path> · line <n>`) or a journal event `event:<id>` (shown as `event <id>`); see
  "Evidence pointer forms" below. Never a link. Anything else (empty, free text) is shown
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
  `data.evidence` = `{session, time, message}` for a session pointer, `{form: "file", project, path, line}` or
  `{form: "event", id}` for the two newer forms (see "Evidence pointer forms"), else `null`
  (free text is never copied). The summary ends `(edited)` / `(approved as proposed)`. No quote, no original text.
- A fenced line that starts with `>` after optional blanks is a quote. An UNEDITED line goes through the same
  checks (empty, too long, repeats a quote) and the operator must edit it when it fails. Quote needles include
  the text without its ` — <pointer>` suffix. Evidence pointer fields are bounded (a file or event pointer at most 1024 characters as written; session 1-64 chars, message
  up to 9 digits). Invisible characters (Unicode format characters such as tag characters, bidi overrides and zero width, and C1 controls) are removed from every line before it is shown, sent or logged, so the log never carries them. Quotes under 20 characters are not guarded, the quote region is also checked as one joined text, and a paraphrase or translation of a quote is not detected (documented limits). decisionKey is lead-written and may carry wording.
- Accepted limits: the client always sends the line it displayed, so only seen text is logged and a changed line is audited as edited. A rewrite of the quotes/evidence between view and click is caught by
  the stale-entry digest (see "Hardening" below). A lead can pre-plant a `decision_countersigned` line in its own audit.jsonl, but that no longer
  suppresses the operator's own record (see "Own record"); a missing lead folder skips the audit line.
- Retry after a crash between log write and removal compares the rest of the block with the line the log
  already holds (a retry that names another line than the logged one is answered `loggedLineDiffers: true`; this applies to W4 line blocks only, not pre-W4 whole-entry blocks). The evidence session id (up to 64 identifier characters) is lead-written like the decisionKey: an accepted limit; a log block in the pre-W4 shape (whole entry) still matches.

## Hardening (iterate org-proposals-hardening)

- **Cross-site guard.** Every browser write under `/api/org/*` (countersign, reject, beat-register release, the lead
  setup wizard, the charter PUT) refuses a request the browser marks `Sec-Fetch-Site: cross-site` (403
  `cross_site_refused`); every POST needs a JSON content-type (415 `unsupported_media_type`), so a cross-site
  `text/plain` form POST never reaches a handler. Same two rules as the reminder routes
  (`server/src/routes/org-write-guard.ts`). A request WITHOUT the header (curl, a script, an old browser) is not refused: this is a
  browser-path defence in depth, not authentication, and says nothing about who else can reach the port.
- **`409 audit_unwritable`.** When the lead's `audit.jsonl` cannot be read or written (read-only, a directory,
  unreadable), countersign and reject answer 409 `{error: "audit_unwritable", leadId, message}` BEFORE anything changes; the
  window shows it as a blocked status ("Nothing was changed. ...") naming the file to fix. A symlinked file stays `403 symlink_forbidden`.
  The blocked status is per row and not sticky: the next click retries from scratch. If the file only fails AFTER the pre-check
  (it became unusable mid-request), a countersign has already written the log: the answer is the same 409 with `logged: true` and the
  `adr`, the entry stays listed, the window says "Logged as ADR-N, but the audit record could not be written ... countersign again to
  finish", and the retry completes the record and removes the entry (an unusable file keeps it listed until fixed). Reject writes the audit
  line first, so its failure changes nothing.
- **Own record.** A decision appends its audit record unless THIS webui already wrote the identical one: same kind, entry
  timestamp, decisionKey, author and action, plus the same reason (reject) or ADR (countersign). A matching line that the lead
  wrote itself (other author or shape) does not count, so Reject leaves the operator's own `decision_rejected` record and
  removes the entry. Limit: the match uses only fields a same-OS-user lead can predict (author defaults to the OS user name, reason is often empty), so a lead that reproduces them exactly can pre-empt the record (`recorded:false`, "already in the log"); the audit content stays true, real provenance would need a webui-only marker (out of scope). A countersign whose audit write failed after the log write (`logged:true`) stays listed until the file is fixed; if the lead rewrites that entry meanwhile, the retry answers `409 duplicate_proposal_identity` with `loggedAdr` (the ADR of the earlier version) and the window tells the operator to use Reject: Reject treats a still-listed entry that is NOT the logged proposal (the fingerprint differs, `isCrashResidue`) as a different proposal and removes it with its own `decision_rejected` record that carries `supersededAdr: "ADR-N"` (so it never reads as a rejection of the approved key and `rejected-keys` skips it) (a logged block that cannot be fingerprinted, i.e. its fence nonce was shorter than 32 hex, is never taken for a different proposal: Reject answers `already_countersigned` and removes nothing, countersign answers `duplicate_proposal_identity` without `loggedAdr`; such residue, and a whole-entry log block compared after dropping CR, BOM and trailing blanks, need a manual fix in the files, accepted), only when the request carries the `fingerprint` of the version the operator saw (without it the answer stays `already_countersigned`: a different proposal is never removed unchecked; the window always sends it); the older ADR's missing countersign record stays missing until the lead's audit file is fixed (accepted). Plain-http LAN: browsers send no Fetch-Metadata there, so the 415 JSON rule plus the CORS allowlist carry the guard; the 403 applies on secure contexts and localhost, and refuses `same-site` as well as `cross-site`. Under `HONO_HOST` or the `open` network profile the CORS policy reflects any origin, so there the 415 rule alone stands between a plain-http LAN page and the writes (tracked limit: an Origin check against the trusted-origin policy). Quote guard: the comparison fold also maps look-alike letters to their Latin twin, before and after lower-casing (`foldConfusables`, mirrored in `orgProposedConfusables.ts`): Cyrillic а в е к м н о р с т у х і ј ѕ ԁ ԛ ԝ һ ӏ ѵ (both cases) and Greek α ι κ ν ο ρ υ χ γ plus Α Β Ε Ζ Η Ι Κ Μ Ν Ο Ρ Τ Υ Χ, dotless ı, ɡ, ſ; fullwidth and other compatibility forms are NFKC. The map is a small, explicit, BOUNDED list of near-identical letters, not the full Unicode UTS #39 confusables table: other scripts (e.g. Armenian, Cherokee), letters built with combining marks, rarer look-alikes, paraphrase and translation stay undetected (accepted limit). It affects the comparison only; the logged line is exactly what the operator typed. The operator approves what is on screen: a row whose block digest changed after a refetch (another row's action, a focus refetch) is shown with a "changed since you opened it" marker, Countersign/Edit/Reject stay disabled until the operator presses "I have read the new version", the edit field restarts from the new proposed line and an edit that was open is flagged (the note stays visible, also when the version comes back, until the operator edits again); the digest sent afterwards is the new version's, and the server's `entry_changed` check stays the backstop. A row that appears AFTER the window finished its first load (a new proposal, or one the lead re-issued under a new timestamp) gets the same marker ("appeared after you opened the window") and lock until acknowledged; the rows of the first load are the baseline and the baseline resets when the window closes. Row identity is (timestamp, lead, ordinal among rows sharing that pair), not the list position, and a row status belongs to the digest it was produced for. Reject: a retry after a crash between audit line and removal with a DIFFERENT reason reuses this webui's earlier record (same kind, entry, key, author, action; the `reason` field present) and appends nothing; the answer carries `reasonKept: true, existingReason` and the window says "Its audit record already exists in the lead's audit file (with the reason ...); your new reason was not added" (once, as the notice; the reason text is read from that file and labelled as such, never attributed to the operator); a record of another author (a forged line) never counts and gets its own record. Reject on an entry that is in the log but whose countersign record is missing (`audit_pending`) answers `409 countersign_audit_pending` `{number, message}`, changes nothing, and the window says "Logged as ADR-N, but its audit record is missing - fix the lead's audit file, then use Countersign to finish". The reason is compared as stored (already normalised by `normalizeReason`). Exactly once under retries: a retry finds its own record and writes nothing. The reject response carries
  `recorded: true|false` (false = the identical record was already there, or the entry was already gone) and the window only says
  "Recorded in the audit log" when it is true. Countersign of an entry whose reject line exists (forged or crash residue) is still
  `409 reject_pending`; Reject is the way out. Residual limit: a lead can write such a line to stop its OWN proposal being approved
  (it cannot stop the operator rejecting it); `rejected earlier` (entry gone) is still decided from any author's line, since no
  entry is left to protect.
- **Accepted environmental limits (no code, by decision).** (0) The fingerprint of the logged proposal hashes the block with only CR removed and the end trimmed: a whitespace-only rewrite of crash residue by an external tool reads as "a different version", and the window then offers Reject for it (the operator sees "different version" wording and decides; the ADR stays logged and its countersign record stays missing). A reject-reuse record is matched on kind, entry, key, author, action and a present reason field, and not on `supersededAdr`: a plain reject and a rejected rewrite of one identity can stand in for each other (the window says which reason is on record). (1) A lead running as the SAME OS user can pre-plant an identical own record
  (same kind, entry, key, author, action; for a reject ANY reason, since a retry with another reason reuses an earlier record, and the reason text read back is normalised and capped at 600 characters (280 before iterate decision-reject-reason)) in its audit.jsonl: the decision then answers `recorded:false` ("already in the
  log"); the audit content stays true, and real provenance would need a webui-only marker or a signature. (2) On plain-http LAN addresses
  browsers send no Fetch-Metadata headers, so only the JSON content-type rule (415) and the CORS allowlist guard the writes there; the
  403 `cross_site_refused` applies on secure contexts and localhost. Neither is fixable inside this app.
- **Stale-entry digest.** Countersign and reject accept an optional `fingerprint`: the first 32 hex characters of SHA-256 over the
  block text the operator saw (`blockForDigest`: BOM and CR removed, trailing blanks trimmed; client `orgBlockDigest.ts`, server
  `blockDigest`; both pinned on the shared sample). Compared under the decisions lock; a difference is `409 entry_changed` with nothing
  written and the window says "This proposal changed since you opened it - reload" and refetches. Absent = not checked (secret-gated
  callers). A crash retry (the entry is already in `decision_log.md`) is judged by the logged fingerprint only, never by this digest,
  so it still heals. A malformed value is `400 fingerprint_invalid`. Change detection, not a secret. Everything (re-read of the file,
  digest check, own-record match, the writes) happens inside the one decisions lock; the lead's own writes to its audit.jsonl do not
  take that lock (documented limit). If `blockForDigest` ever changes, windows opened before the change get `entry_changed` and a reload fixes it.
- **Text rules on the write path** (`normalizeLine`, mirrored): besides format characters, default ignorables and C1 controls, the
  braille blank U+2800, private-use characters and lone surrogates are removed; Unicode space separators (NBSP, ideographic space,
  U+2000 range, ...) become a plain space. U+FE0F directly after an emoji base (and in a keycap sequence) is kept so emoji keep their
  presentation; every other variation selector is removed; ZWJ is a format character and stays stripped (emoji ZWJ sequences
  therefore split into their parts). Umlauts, CJK and plain emoji are untouched. The quote-guard fold strips the same set (and the
  emoji selector too), so a line cannot hide a quote behind them.
- **Skipped entries.** The client parser reports `{count, leadIds}` of candidate entries it dropped (ambiguous region, damaged or
  non-canonical entry, bad timestamp or lead, structural injection, a dangling opener plus the header-looking lines after it). Lead ids appear
  only when they pass the lead-id rule; no content of a skipped entry is ever shown. The window shows one `role=status` line: "N entries
  could not be read and were skipped (lead: ...)." The count is a lower bound after a dangling opener (text after it is untrusted) and
  may include a header-looking line that was never a real entry.
- `loggedLineDiffers` is decided for W4 line blocks only (a fenced entry); a pre-W4 whole-entry log block has no single line to compare.

## Evidence-line quote (iterate evidence-line-quote-grammar)

**Accepted.** Leadwright (`renderEntry`, leadwright #141) writes the shadow evidence quote NOT inside the fence but on the
Evidence bullet: `- **Evidence:** <session>:<ISO .mmmZ>:<n> — "<quote>"`. The quote is one line, 24-200 characters, and
may itself contain ` — ` and `"`. `parseEvidence` (mirrored grammar) matches `^(\S+) — "(.*)"$` greedily; the part
before the first ` — ` must be a KNOWN pointer: the short form `<session>:<ISO>:<n>`, or (since iterate evidence-file-event-pointers) a
file-line or journal-event pointer, see the next section (the long `session ... at ...` form followed by a quote reads as unknown), otherwise the line is handled exactly as before
(unknown source, no quote). An empty, blank or invisible-only quote is no quote.

- **Display:** the quote is shown first, as its own quote with the entry's pointer, as untrusted plain text.
- **Guard:** the folded quote (when its folded form is 20+ characters, `QUOTE_GUARD_MIN`) is a `line_contains_quote` needle, so an unedited proposed line that repeats it is refused (400).
- **Audit:** `evidence` is the structured pointer `{session,time,message}` (no longer null for this form); for a fenced entry (the form leadwright writes) the quote text is never written to the log or the audit.

**Not adopted.** The `> text — pointer` quote line inside the fence (W2 display convention) stays accepted for reading, but
the Evidence-line form is not extended to it and it is not what leadwright writes for the shadow evidence quote.

**Fixture pin.** `server/src/external/org/__tests__/fixtures/decisions-proposed-renderentry-sample.md` is copied from leadwright
`tests/fixtures/decisions-proposed-renderentry-sample.md` (commit 44a6606, #141). SHA-256 (LF-normalised):
`f37620e501c9727becb88206207bbc82db1a33cdff08779a4693aa164b00902c`.

**Producer requirements.** Leadwright must write the short pointer with ASCII spaces around the em dash and keep the closing
`"` when it truncates a quote; any other shape (NBSP or tab around the dash, the long pointer form, an unterminated quote)
reads as unknown source: no quote shown, no guard needle, audit evidence null. The displayed quote is plain text as written
(invisible characters are folded away by the guard, not stripped for display), the same as fence quotes.

## Evidence pointer forms: file line and journal event (iterate evidence-file-event-pointers)

**Accepted.** Leadwright #149 (commit d5c9ae01, `lib/evidence-pointer.ts`, "evidence pointer grammar" in its `docs/guide.md`)
lets a shadow lead cite a line of a file in one of its readable projects or a journal event of its run, besides a session
excerpt. The Evidence bullet keeps its shape `- **Evidence:** <pointer> — "<quote>"`. `parseSourceRef` (mirrored
evidence-pointer module, `proposed-evidence-pointer.ts` / `orgProposedEvidencePointer.ts`) tells the forms apart in this order:

1. **Session excerpt** (unchanged, `kind: "known"`): `^[A-Za-z0-9_-]{1,64}:<ISO>:\d{1,9}$` or the long `session ... at ...` form.
   Tried FIRST: a session id may itself be `file` or `event`.
2. **File line** (`kind: "file"`): `^file:C(?:/C)+#L[1-9][0-9]{0,8}$`, `C` = `(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+`. The first
   component is the project folder name, the rest the path inside it, the number the 1-based line.
3. **Journal event** (`kind: "event"`): `^event:C$`.

Each component is percent-encoded UTF-8; leadwright writes uppercase hex, the reader also accepts lowercase hex and a
needlessly encoded unreserved byte. Read as **unknown source** (raw text shown, no quote, no guard needle, audit `null`), as
leadwright refuses them: a pointer longer than 1024 characters as written, broken UTF-8 after decoding, an empty, `.` or `..`
component, a decoded file component holding `/`, `\`, a C0 control or DEL or one of `: ? * < > | "`, ending in `.` or a
space, or a Windows device name (`con`, `prn`, `aux`, `nul`, `com0`-`com9`, `lpt0`-`lpt9`, with or without extension), a
line of 0, with a leading zero or of more than 9 digits, a blank event id. **Stricter than the producer, for display:** any
decoded component (event id included) holding a character that renders as nothing or moves text (Unicode control or
format characters such as bidi overrides and zero width, default-ignorables such as the Hangul filler or variation
selectors, private use, line/paragraph separators) reads as unknown, so a pointer can never reorder or hide text on the
page; and a file component holding the label separator `·` (U+00B7) reads as unknown, so a project or path name cannot
fake the `· line N` part of the label. Residual: other dot-like look-alikes (e.g. U+2219, U+30FB) are not refused; the
label is plain text and the quote, not the pointer, is the durable evidence.

- **Display:** the decoded fields as plain text, never a link and never a path the WebUI opens: `dinovo GmbH · Projekte/Q4 Plan.md · line 3`,
  `event evt-2026-11-27-001`. The quote is shown first, as for a session pointer.
- **Guard:** the folded quote is a `line_contains_quote` needle for both forms, exactly as for a session pointer. Because the
  reader refuses some pointers the daemon accepts (the stricter display rules above, e.g. an emoji with a variation selector
  in a file name), the guard does NOT depend on the pointer being known: the quote of any Evidence bullet in the
  `<token> — "<quote>"` shape is a needle (`evidenceQuoteForGuard`); such an entry shows unknown source, no quote, and
  audits `evidence: null`. A needle can only make the guard stricter.
- **Fence quotes:** a `> text — <pointer>` line inside the fence is lead-written and never checked by the daemon (its
  anti-mimic rule covers only the Evidence bullet), so a file-line or journal-event pointer there is shown as **unknown source**
  with its raw text, never as a citation; the session form there keeps its earlier reading. The guard needles are unchanged
  (the suffix is split off as before).
- **Audit (`decision_countersigned`, `data.evidence`):** `{"form": "file", "project": "<decoded>", "path": ["<decoded>", ...], "line": <number>}`
  or `{"form": "event", "id": "<decoded>"}`. The session form keeps its original `{session, time, message}` shape (no `form`
  field), so records written before this change read the same. Never the quote, never a full filesystem path (the project is
  a folder name). The decoded fields are lead-written text, like the decisionKey (bounded by the 1024-character pointer).

Examples, exactly as leadwright writes them:

    - **Evidence:** file:dinovo%20GmbH/Projekte/Q4%20Plan.md#L3 — "answered within two working days"
    - **Evidence:** event:evt-2026-11-27-001 — "release branch be merged before the freeze"

**Fixture pin.** `server/src/external/org/__tests__/fixtures/decisions-proposed-renderentry-evidence-forms-sample.md` is copied
byte for byte from leadwright `tests/fixtures/decisions-proposed-renderentry-evidence-forms-sample.md` (commit d5c9ae01, #149).
SHA-256 (LF-normalised): `5059ef1cdbed1cef01925c9e34ef6117b44fddac7d8f6769681098791618a049`.

**Residual (by design, leadwright's):** the pointer was checked by the daemon at proposal time only; the file may have changed
since, so the recorded quote, not the pointer, is the durable evidence. The WebUI never reads the cited file or event.

**Residual (accepted):** leadwright refuses `file:` / `event:` free-text evidence from a non-shadow lead only since #149. An
older entry, or one written by another tool or by hand, whose Evidence bullet happens to be a well-formed file or event
pointer reads as a structured citation and is audited as such. The reader accepts lowercase hex and needlessly encoded bytes
(the producer's input rule), which the daemon itself never writes. Leadwright refuses such a text in new proposals; an old one
is removed by countersign or reject.

## Rejected decisions file (iterate decision-reject-reason)

A reject no longer loses the proposal. The webui appends one block per rejection to the org-wide
`<leadsRoot>/decisions-rejected.md`; the leadwright daemon reads it so a lead sees what was already rejected and
why. Pinned sample (the writer's exact output, held by `decisions-rejected.test.ts`):
`server/src/external/org/__tests__/fixtures/decisions-rejected-sample.md`.

**Writer and lock.** Only the reject action writes the file, never the generic `/file` route (it is not in the
org allowlist). The write is atomic (temp file + rename) and happens while the reject holds the same
`decisions-proposed.md` lock as the rest of the reject (proper-lockfile `<path>.lock`, the FR-04.28 contract), so a
reader that takes that lock sees either the old or the new file. The path is resolved by the path guard and refused
as a symlink (`403 symlink_forbidden`); a file that cannot be read or written (not a file, unreadable or read-only file, read-only folder) is
refused BEFORE anything changes with `409 rejected_file_unwritable {message}` (the same 409 with `auditWritten: true` answers a write that fails after that check; the audit line is then written and the entry stays listed, so a retry finishes it, and the WebUI says "Half done" instead of "Nothing was changed"). Countersign never touches the file.

**File.** Created on the first rejection, in ONE write together with the first block, starting with this header
(no `## ` line, so it is never a block):

```
# Rejected decisions

Proposals the operator rejected, appended by the Shipwright WebUI when a proposal is rejected (oldest first).
Each block: the proposed line, when it was rejected and the operator's reason. Leads: do not propose these again
in other words. Format: docs/org-proposed-entry-contract.md in shipwright-webui, "Rejected decisions file".

```

An existing empty or whitespace-only file is treated as missing. Blocks are only ever appended, oldest first. LF line
endings as written; a reader should tolerate CRLF and a BOM (an editor may add them).

**Block grammar** (exact; every line ends with `\n`):

```
## Rejected [<entry timestamp>] <leadId>            heading
<!-- decisionKey: <key> -->                         only when the entry has an identifier key
                                                    one empty line
- <proposed line>                                   item 1, always present
- Rejected: <rejection time>                        item 2, always present
- Reason: <operator reason>                         item 3, only when a reason was given
                                                    one empty line (end of block)
```

- Heading: `## Rejected [` + the rejected entry's timestamp (its identity in `decisions-proposed.md`, canonical
  ISO-8601 UTC, e.g. `2026-11-20T09:15:00.000Z`) + `] ` + the proposing lead's id (`^[a-z0-9][a-z0-9-]*$`). Regex:
  `^## Rejected \[([^\]]+)\] (\S+)$`. The heading mirrors `decision_log.md`'s `## ADR-NNNN [<timestamp>] <leadId>`.
- Marker: the line directly below the heading, `<!-- decisionKey: <key> -->`, written under the same condition as the
  log: only when the entry's key is a plain identifier (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`, `decisionKeyOf`). An
  old WebUI-form entry has no key and no marker line.
- Items are **positional**: the first list item after the empty line is ALWAYS the proposed line, whatever text it
  starts with (a line may itself start with `Reason:` - see the sample's second block). Item 2 is `Rejected: ` + the
  rejection time (ISO-8601 UTC with milliseconds, `Date.toISOString()`). Item 3, when present, is `Reason: ` + the
  reason. A reader must not look items up by prefix in the first position.
- Every text field is one line: invisible and control characters are removed, line breaks and odd spaces become
  one space (`normalizeLine`), so no text can start a header, a marker or another item.
- The proposed line is the line as the lead proposed it (a fenced entry's line, at most 2000 characters). Two
  replacements: an empty line is written as `(no text)`, and a line that copies a quote of the entry's evidence
  (the same check countersign applies to an unedited line, run on the text as it would be written, i.e. after
  the 2000-character cut) is written as
  `(line withheld: it repeats a quote from the lead's evidence)` - the file is read by every lead and a quote is
  that lead's own evidence. An unfenced (old WebUI form) entry's body is flattened to one line, at most 2000
  characters, after its quote lines (`> `) and its `- **Evidence:**` bullet are left out: such a body has no
  fenced evidence to check against, so the quote structure itself is dropped.
- The reason: optional, one line, at most 600 characters, refused (`400 reason_too_long`, `reason_contains_quote`,
  `reason_invalid` for a non-string) with nothing changed when it is longer or repeats a quote of the entry
  (20-character folded run, same rule as an edited line). It is always the reason of the request that wrote the
  block, never a reason read back from the lead's audit file. So after a crash between the audit line and the block,
  a retry with a different reason leaves the audit with the first reason and the block with the second; the
  WebUI notice says so.
- Hand edits: the writer tolerates CRLF, a BOM, and trailing whitespace on any line when it looks for an existing
  block. A block whose heading or marker is otherwise changed (a blank line before the marker, an indent) is not
  recognised, so a retry of that same reject would append a second block. A reader should trim lines the same way.

**Exactly once and order.** A block's identity is (entry timestamp, lead id, decisionKey or none, proposed line);
the rejection time and the reason are not part of it. Under the lock the reject writes: (1) the
`decision_rejected` audit line (unchanged: `data.reason` is the reason string or `null`), (2) the block, only when
no block with that identity exists, (3) the removal from `decisions-proposed.md`. A crash after (1) leaves the entry
listed (countersign answers `409 reject_pending`) and the retry writes the block once; a crash after (2) makes the
retry append nothing; the entry's text is never gone before its block exists. A retry after (3) answers
`alreadyRejected: true` and writes nothing. A different proposal under the same identity (another line), or the same
line under a new timestamp, gets its own block. Rejections made before this change have no block (their text is gone).
A reason is validated after the entry is found: an `already_rejected` / `already_countersigned` answer wins over an
invalid reason.

**Trust and size (for the reader).** The proposed line is lead-written text, quoted from an AI lead: the reader must
present it to leads as quoted data, never as instructions. The reason is the operator's words. The file grows by one
block per rejection and is never pruned by the writer; the reader decides how much of it a lead is fed (e.g. the
latest N blocks or a time window). The writer re-reads the whole file under the lock on each reject (linear scan),
fine at the expected size. Residual: a same-OS-user lead can write into the file; a pre-planted block with the same
identity suppresses the operator's block (its content would be identical anyway).

## Countersign note (iterate decision-reject-reason)

`POST .../decisions/countersign` takes an optional `note`: one line, at most 600 characters, same rules as the reject
reason (`400 note_too_long`, `note_contains_quote`, `note_invalid`; blank = no note). It is written as its own list
item directly below the logged line:

```
## ADR-0007 [2026-11-21T09:15:00.000Z] acme-lead
<!-- decisionKey: friday-reviews -->
<!-- proposal: <32 hex> -->

- Reviews happen every Friday afternoon.
- Note: Agreed in the Monday sync.

```

Without a note the block is byte-for-byte what it was before. A whole-entry (unfenced) log block gets the note after
its body and one empty line. Only the first countersign writes it; a retry of an already logged entry keeps the
logged block as it is (crash residue with a note still heals as the same proposal). Residual (accepted): for an
old unfenced entry the crash-residue check accepts the logged body plus exactly one trailing `- Note:` item, so a
lead that rewrites such an entry under the same identity by dropping a final `- Note:` item of its own reads as the
logged proposal; fenced entries are told apart by their fingerprint and are not affected. The note is not written to the
audit record. leadwright reads `decision_log.md` keys from the `<!-- decisionKey -->` markers only, so the extra item
does not change which keys count as decided.

## Evidence pointer forms: the operator's reason and note (iterate decision-record-evidence)

**Accepted.** Leadwright #153 (commit f79a181, `lib/evidence-pointer.ts`, `lib/decision-record-evidence.ts`, "How leads
learn from you" in its `docs/guide.md`) lets a lead cite the operator's own words, mainly for a learning proposal. The
Evidence bullet keeps its shape `- **Evidence:** <pointer> — "<quote>"`. `parseSourceRef` (mirrored evidence-pointer
module) reads two more forms, after the excerpt form and within the 1024-character bound, with leadwright's exact regexes:

4. **Rejected decision** (`kind: "rejected"`): `^rejected:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z)\/([a-z0-9][a-z0-9-]*)$`,
   the `## Rejected [<time>] <lead>` block of `decisions-rejected.md`; the quote comes from its operator reason.
5. **Countersigned decision** (`kind: "decision"`): `^decision:ADR-(\d{1,9})$`, the `## ADR-<n> [...] <lead>` block of
   `decision_log.md` (`ADR-7` names `ADR-0007`); the quote comes from its operator note.

- **Resolved, unlike the other forms.** Both records are written by this WebUI, so the server checks the citation
  (`server/src/external/org/decision-record-evidence.ts`, `POST /api/org/decisions/record-evidence` with
  `{pointer, quote}`, a POST so the quote stays out of URLs; `Cache-Control: no-store`). The file path is fixed, never
  taken from the pointer; the file is read through one no-follow handle, at most 5 MB. The reader is a port of
  leadwright's (`rejectedReasons`, `decisionNote` with the strict countersign line shape, `quoteProblem` bounds: 24 to 200
  characters after whitespace runs become one space, or all of a shorter text). **Positional:** item 1 of a rejected
  block is always the lead's line, whatever it starts with; only a third item after `- Rejected: ` is a reason; a
  decision block counts only in the line shape and two blocks under one ADR number cite nothing. Answers:
  `confirmed` (with `words`, the one reason or note that holds the quote), `quote_not_found`, `no_words` (no such block,
  or no reason / note), `unreadable` (with a fixed `detail`: missing, a symbolic link, not a file, too large, outside
  the leads folder). The words are returned only with `confirmed`, so the route reads no more than the citation itself.
  The existing reject-side reader `parseRejectedBlocks` (duplicate check on reject) is not fence-aware; the two differ only
  for hand-edited files with fences, and the duplicate check is not evidence (accepted).
- **Display:** the source as `your reason for rejecting <lead>'s proposal of <time>` / `your note on ADR-<n>`. The
  window shows the quote as the operator's words, with the full recorded reason or note, ONLY on `confirmed` ("found in
  <file> when shown": a view-time check, re-run after a reject or countersign). While checking, on a failed request
  and on every other answer it shows a notice and NOT the quote as the operator's words (fail closed). A fence quote
  with a record pointer, or one inheriting the Evidence bullet's record pointer, shows as unknown source.
- **Guard:** unchanged, the quote is a `line_contains_quote` needle (a learning rule that repeats 20+ characters of the
  operator's words must be edited before countersigning; accepted, stricter).
- **Audit (`data.evidence`):** `{"form": "rejected", "time": "<time>", "lead": "<lead>"}` or `{"form": "decision", "adr": "<digits as written>"}`. Never the quote.

## Learning label (iterate decision-record-evidence)

A learning proposal has a decisionKey starting with `learning.` and a line that starts with its label, written by
leadwright (`learningLabel`) and read back by it from the countersigned line (`parseLearningLabel`):
`Learning (this lead|all leads[, importance 1-5][, pinned][, replaces learning.<key>]): <rule>` (reach first, the other
parts at most once, any order, case-insensitive). The window shows the label as chips apart from the rule (`for this
lead only` / `for all leads`, `importance N of 5`, `pinned`, `replaces <key>`), and reads it again live under the edit
field ("The leads will read this line as"). No label reads as this lead, importance 3. A label outside the grammar is
shown as a warning with leadwright's own problem text: countersigning still logs the line (nothing here blocks), but the
daemon does not write that learning (`learning_not_promoted`) until the line in `decision_log.md` is fixed. The label is
read from the line as the countersign logs it (`normalizeLine`: a newline, a run of spaces, NBSP or an invisible
character reads exactly as leadwright will read the logged line). The preview checks the label grammar only: leadwright's
600-character cap on the promoted learning (rule plus the operator's note) is not shown here. Port:
`client/src/lib/orgLearningLabel.ts`, display only.

On `confirmed`, the window shows the lead's quote as cited and, beside it, the operator's full recorded reason or note;
the match is leadwright's (whitespace runs as one space, `⟦⟧` and `<!--`/`-->` in their recordable form), so the
quote may differ from the record in those characters only. The full text beside it is the record verbatim.

**Countersigned log sample (for leadwright to pin; leadwright does not pin it yet, follow-up).** `server/src/external/org/__tests__/fixtures/decision-log-countersigned-sample.md`
is written byte for byte by the real countersign (`handleCountersignRequest`, test `decision-log-countersigned-sample.test.ts`):
ADR-0001 a learning whose label the operator edited (`all leads, importance 4, pinned` to `this lead, importance 3`) with a
`- Note:`, ADR-0002 a plain decision approved as proposed with a `- Note:`. The file starts with the first heading (the
writer created it) and every block ends with one empty line. SHA-256 (LF-normalised): `990956d0d22a4a21a1cec90856eeca9274f2367b8462149437f5c0581bab91fa`.
A change to the log block shape updates the writer, this fixture, this hash and, once it exists, the leadwright copy in the same release train.
