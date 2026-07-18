# Iterate: triage JSONL record-boundary recovery + newline guard (webUI port)

- **run_id:** `iterate-2026-07-18-triage-jsonl-record-boundary`
- **Intent:** CHANGE · **Complexity:** medium · **Spec Impact:** MODIFY (FR-01.30)
- **Risk flags:** `touches_io_boundary` (**operator-declared floor** — the auto-detector's
  patterns are Python-oriented (`*_state.json`, `json.load`) and did not fire on a TS
  `JSON.parse` site. `triage.jsonl` is a cross-language wire-format contract between the
  Python producers (`shared/scripts/triage.py`) and this TS reader, so the round-trip /
  Boundary-Probe obligation applies.)
- **Handoff:** port of monorepo PR #399, run `iterate-2026-07-18-outbox-newline-corruption`.
  Contract reference: `shared/scripts/lib/jsonl_records.py`.

## Goal

Close a record-loss defect on the append-only triage log, in both halves, and **restore
cross-language parity** with the Python side that already shipped this fix.

## Problem

Two independent halves of one defect.

**WRITER** — `server/src/core/triage-write.ts:148` calls `appendFileSync(targetPath, line)`.
The line it appends is newline-terminated, but nothing checks that the file it appends *to*
is. An unterminated predecessor — an interrupted write, an external (Python) writer, an
operator edit — puts two records on one physical line.

**READER** — `server/src/core/triage-store.ts` documents its tolerance contract as
"skips lines that fail JSON.parse (not thrown)" (`:16`), implemented at `:110`
(`if (parsed === undefined) continue; // corrupt — skip`). A concatenated line fails
`JSON.parse` as a whole, so the reader discards **both** records.

**On an append-only log, corruption must never read as absence.**

### This is an active divergence, not only latent prevention

The brief framed this as latent (both local logs scan clean and newline-terminated — verified).
That is true of the *local data*, but the *code* is already divergent: `shared/scripts/triage.py`
has shipped both halves (`:263` `read_jsonl_records`, `:318` `ends_without_newline`). Python
recovers a concatenated line; TS drops it. `readAllItems` is byte-parity-tested against Python,
so webui is currently the non-conforming implementation of a shared contract.

### Correction to the brief

The brief located the reader contract in `triage-board-read.ts`. It is actually in
`triage-store.ts:16`, and the skip is in `parseRawLines` (`:110`). This matters: `parseRawLines`
is the **single funnel** for every on-disk read *and* the `git show origin/…` blob path in
`triage-origin.ts:124`, so one fix covers a surface the brief did not name.

## Constraints discovered

1. **Bloat anti-ratchet (hard).** `server/src/core/triage-store.ts` is baselined at **305**
   lines, `state: grandfathered`, and `core.hooksPath=scripts/hooks` is active. Any growth
   ratchets an existing entry and the pre-commit hook **blocks the commit**. The reader change
   must be net-neutral or shrink. Headroom is created by deleting `tryParseLine` (7 lines) and
   `isPlainObject` (4 lines), both dead once the splitter owns parsing + object validation.
2. **`parseRawLines` must keep returning `Record<string, unknown>[]`.** It has five downstream
   consumers, one of which (`appendIdsInFile`) is on the **write** hot path — residence routing
   for every status flip. Python's reader also returns a plain records list and reports
   corruption separately, so keeping the array shape is both parity-faithful and ripple-free.
   Corruption travels on an **optional callback**, not a changed return type.
3. **Python parity fixtures are clean** (no concatenation, all newline-terminated), so adding
   recovery cannot break the existing parity gates.

## Design

### New neutral-leaf module — `server/src/core/jsonl-records.ts`

Mirrors the Python leaf's reasoning: the reader half and the writer half both need one agreed
answer to "where does a record end?", and parking it in either module creates an import cycle
(`triage-store` ↔ `triage-write`). The leaf **never logs** — corruption is returned as data.

- `endsWithoutNewline(path): boolean` — true iff the file exists, is non-empty, and its last
  byte is not `\n`. Missing / zero-byte → `false` (safely appendable). A file ending `\r\n`
  already ends in `\n`, so it counts as terminated (prefixing another newline would inject a
  blank line).
- `splitRecords(line): { records, remainder }` — splits one physical line into records plus the
  verbatim unrecoverable remainder.
- `parseJsonlRecords(raw): { records, corrupt: CorruptFragment[] }` — line-numbered whole-blob
  form.

**Port deviation (deliberate).** The Python leaf exposes `read_jsonl_records(path)`. webui's
reader is **string-based** — it must serve the `git show` blob path as well as on-disk reads —
so the path-based variant would be dead code. Ported as `parseJsonlRecords(raw)` instead;
`endsWithoutNewline` stays path-based because the writer probes a file.

**`splitRecords` is new code, not a translation.** Python uses `JSONDecoder.raw_decode`, which
has no `JSON.parse` equivalent.

Implementation (revised after external review R2 — the original plan was a bespoke
string-and-escape-aware brace lexer, which both the reviewer and a second look agree is a
classic source of latent bugs around escaped quotes and backslash runs):

- **Fast path** — try native `JSON.parse` on the whole trimmed line. This is the 99.9% case,
  costs one native call, and never engages recovery logic at all.
- **Slow path (only on failure)** — walk candidate end positions at each `}` from an anchored
  `{` start, and let native `JSON.parse` validate each slice. This is **self-correcting for
  braces inside strings**: a candidate that ends at an in-string `}` is unbalanced and simply
  fails to parse, so the walk continues. The **shortest valid prefix is the correct record
  boundary**, because any shorter prefix ending at `}` is necessarily unbalanced.

No hand-rolled JSON lexer is written. Because only `{` can start a record, the "valid JSON but
wrong shape" case (a bare scalar) collapses into the same branch as a malformed one — both
become a fragment, which is the contract Python specifies. A malformed *first* record makes the
**entire rest of the line** the remainder — no resync past a bad record, matching `raw_decode`.

**Known parity boundary (external review R4, verified empirically).** Python's default
`JSONDecoder` accepts `NaN` / `Infinity` / `-Infinity`; `JSON.parse` rejects them. Confirmed by
probe: `raw_decode('{"a": NaN}')` succeeds. The triage record schema carries only strings and
`null` (no float fields), so this is unreachable from the real producers — but it is a genuine
divergence, recorded rather than ignored, and pinned by a test asserting TS degrades such a line
to a **fragment** (safe) instead of throwing.

Contract, pinned to the Python docstring:
- JSON whitespace between records is skipped — **explicitly `" \t\r\n"`, not a unicode-aware
  whitespace test**, which would silently accept NBSP / U+000B / U+000C and diverge from every
  other JSON consumer of the same bytes.
- A blank / whitespace-only line yields `([], "")` — formatting, not corruption.
- Only JSON **objects** count as records; a bare scalar is a fragment (callers do `raw.event`).
- **Recovery is PARTIAL.** A valid record followed by an unrecoverable fragment yields the valid
  record **and** the fragment. All-or-nothing recovery would reproduce the very bug it fixes.

### Writer — `triage-write.ts`

Probe before append, mirroring `triage.py:318`:

```ts
const separator = endsWithoutNewline(targetPath) ? "\n" : "";
appendFileSync(targetPath, separator + line);
```

Placed **after** the header-bootstrap branch (the header is written newline-terminated, so the
probe correctly returns `false` on a just-bootstrapped file) and **immediately before** the
append, to keep the TOCTOU window as small as possible. Runs inside the caller's existing
`proper-lockfile` lock. The file is never rewritten; this is purely a prefix on the next append.

`endsWithoutNewline` does a `statSync` for the size then a **one-byte** `readSync` at
`size - 1`. It never reads file contents — an O(N) read here would degrade every status flip as
the log grows (external review R3).

### KNOWN LIMITATION — the writer guard is best-effort, not a guarantee

Flagged independently by **both** external reviewers (R1, severity high), and the plan
originally overclaimed it.

Probe-and-append is a TOCTOU sequence. `proper-lockfile` serialises only *TS* callers; the
Python producers use a **disjoint** lock primitive (`msvcrt`/`fcntl` byte-locks on a
`<file>.lock` sidecar) — an accepted, documented asymmetry (ADR-101 / ADR-106). So a Python
write landing between the TS probe and the TS append can still either recreate a concatenation
or cause a spurious blank line.

This is **not fixable** without a shared cross-language lock protocol or a single writer, both
far outside this port's scope. The honest contract is therefore:

> **The writer guard repairs a pre-existing unterminated tail. The reader recovery is what
> actually guarantees no record is lost.**

That is precisely why the fix has two halves, and it makes the reader half **load-bearing**
rather than defence-in-depth. AC1 is scoped accordingly, and an interleaving test pins the
residual behaviour so the limitation is visible rather than assumed away.

### Reader — `triage-store.ts`

`parseRawLines(raw, onCorrupt?)` delegates per-line work to `splitRecords`, so a concatenated
line now yields all its records in wire order. Order preservation is load-bearing: the two-pass
status resolution depends on `(ts, file-order)`, and recovered records must keep their relative
position.

### Reporting — at the command boundary, never in the leaf

Per the answered scoping question: **server log only.** No API field, no client type, no UI
banner — matching the Python half, which warns from the reader and points at a repair CLI that
exists only in the monorepo. A WebUI banner would report a problem the operator cannot act on
from the WebUI.

`readBoardItems` (`triage-board-read.ts`) collects fragments and emits one structured
`console.warn` per read, reusing the existing house idiom already in that file
(`{ level, message, projectId, error }`). Threading passes through `triage-compose.ts`.

**Deliberate scope boundary:** `readAllItems` (counts + write preconditions) and
`triage-origin.ts` (git blob) get **recovery** but stay log-silent. Recovery is the data-integrity
fix and applies everywhere; logging is proportionate to the user-facing read path, and the origin
blob is a git-clean copy far less exposed to a torn local write.

## Acceptance Criteria

- **AC1 (writer, scoped)** Given a triage file whose last byte is not `\n` **and no concurrent
  foreign writer**, when a status event is appended, then the file contains two
  separately-parseable lines — the predecessor is intact and the new record is on its own line.
  The guarantee is explicitly limited to repairing a **pre-existing** unterminated tail; see
  "Known limitation" above.
- **AC1b (writer, residual risk made visible)** Given a foreign write interleaves between the
  probe and the append, when the store is subsequently read, then **no record is lost** — the
  reader's record-boundary recovery absorbs the resulting concatenation. This is the test that
  proves the two halves compose.
- **AC2 (writer)** Given a file already ending `\n` (or `\r\n`), a missing file, or a zero-byte
  file, when a status event is appended, then no extra blank line is injected.
- **AC3 (reader)** Given a physical line holding two concatenated JSON objects, when the store
  is read, then **both** records are returned, in wire order.
- **AC4 (reader, partial)** Given a line holding a valid object followed by unrecoverable text,
  when the store is read, then the valid record IS returned **and** the remainder is reported as
  a fragment — not discarded, not all-or-nothing.
- **AC5 (contract)** A blank/whitespace-only line yields no records and no corruption; a bare
  scalar (`42`, `"str"`, `null`) is a fragment, not a record; only `" \t\r\n"` is skipped between
  records (NBSP / U+000B / U+000C are **not** whitespace).
- **AC5b (lexical hardening, external review R5)** `splitRecords` is correct for braces inside
  strings (`{"x":"}{"}{"y":1}`), escaped quotes and backslash runs before quotes, nested objects
  and arrays, and an unterminated string. A malformed **first** record yields the entire rest of
  the line as remainder — no resync past a bad record (matches `raw_decode`).
- **AC6 (no regression)** Existing Python-parity gates stay green and byte-identical:
  `readAllItems` single-file + union parity, `triage_cli.py list --json` projection parity.
- **AC7 (cross-language parity, Boundary Probe — broadened per external review R6)** A fixture
  resolved by the **real** Python `read_all_items` deep-equals the TS result across:
  concatenated objects; a valid object followed by an invalid suffix; a scalar followed by an
  object; CRLF and blank lines; and NBSP / U+000B / U+000C between objects.
- **AC8 (reporting)** An unrecoverable fragment produces exactly one structured `console.warn`
  from `readBoardItems` carrying **bounded metadata only** — projectId, file identifier, line
  number and fragment **byte length**, never the fragment text (external review R7). The leaf
  module itself never logs. No API or client shape changes.
- **AC9 (bloat)** `server/src/core/triage-store.ts` stays **≤ 305 lines**; the pre-commit
  anti-ratchet hook passes.

## Confidence Calibration

- **Boundaries touched:**
  - `.shipwright/triage.jsonl` + `.shipwright/triage.outbox.jsonl` — the append-only
    cross-language wire format (Python producers ↔ TS reader/writer). Both a READ and a
    WRITE boundary.
  - `GET /api/triage/:projectId` and `GET /api/triage/counts` — read surfaces whose output
    changes on corrupt input (more records recovered). No response *shape* change.
  - Git's EOL layer — the parity fixture must round-trip byte-exact (`.gitattributes`).
  - No client boundary: zero client files touched, no API field added.

- **Empirical probes run:**
  - **Defect reproduced before fixing.** The AC1b test failed RED with
    `expected [] to deeply equal ['trg-1111aaaa','trg-2222bbbb']` — a concatenated line lost
    BOTH records. Not argued from the code; observed.
  - **Python is already fixed** — read `triage.py:263` (`read_jsonl_records`) and `:318`
    (`ends_without_newline`). So TS was the divergent side of a parity-tested contract, not
    merely "latent". This changed the framing of the whole iterate.
  - **NaN/Infinity divergence measured, not assumed** — ran Python
    `JSONDecoder().raw_decode('{"a": NaN}')` → succeeds `({'a': nan}, 10)`; `JSON.parse`
    rejects. Then verified the triage record schema carries only strings/null, making it
    unreachable from real producers. Recorded as a known boundary + pinned by a test.
  - **Existing parity fixtures proven unaffected** — regenerated all fixtures through the
    REAL Python and confirmed `git status` showed only the two NEW files; `triage-resolved.json`
    and `triage-union-resolved.json` byte-identical. The "corrupt line" already in the
    fixture (`this is not even json`, line 7, 21 bytes) is skipped identically before and
    after, so recovery did not silently move the parity baseline.
  - **Cross-language parity proven on corrupt input** — the deliberately-corrupted fixture
    resolves deep-equal between TS and real Python, INCLUDING which records are legitimately
    unrecoverable (a leading scalar and an NBSP separator each drop the following record in
    BOTH languages). Passed first run.
  - **EOL corruption caught and fixed** — `git ls-files --eol` + `git cat-file blob` showed
    the staged blob held **0 CR bytes for a worktree file with 1**: `core.autocrlf=true` had
    silently stripped the deliberate CRLF, which would have made the CRLF case untested on a
    fresh clone and mismatched the committed expected-output JSON. Fixed via `.gitattributes`
    and re-verified byte-exact (1 CR, 3198 bytes).
  - **Bloat ceiling measured, not estimated** — `triage-store.ts` baselined at exactly 305
    with the hook active; landed at **304**. `anti_ratchet_check.py` run against the staged
    tree: exit 0.
  - **Full suites green** — server 2305 passed / 1 skipped (196 files); client 2695 passed
    (295 files); `tsc --noEmit` exit 0 both workspaces; lint clean for all new files.

- **Test Completeness Ledger:** see below — 47 behaviors enumerated, all `tested`,
  0 untested-testable.

- **Confidence-pattern check:**
  - **Depth (asymptote):** the risky component is the record splitter. It is not tested only
    on the happy path — it is tested against the exact lexical classes that break naive brace
    counting (braces inside strings, escaped quotes, backslash runs before a closing quote,
    nested objects/arrays, unterminated strings), against the whitespace boundary
    (NBSP/VT/FF must NOT be skipped), and against a cross-language oracle that was generated
    by the other implementation rather than by me. The external review's core objection —
    that a hand-rolled JSON lexer is a latent-bug factory — was addressed by *removing the
    lexer* and delegating validation to native `JSON.parse`, so the class of bug is designed
    out rather than tested for.
  - **Breadth (coverage):** both halves of the defect (write prevention, read recovery), both
    files (tracked + outbox), both read paths (`readAllItems` and the board/origin composer),
    the WRITE hot path (`appendIdsInFile` residence probe — recovery there changes routing,
    not just display), the HTTP consumer chain (list + counts + dismiss), the reporting
    boundary, and the byte-level git surface.
  - **Composition:** the two halves are tested TOGETHER (AC1b) rather than only in isolation —
    which matters because the writer guard is deliberately best-effort and the reader is the
    actual guarantee. No `cross_component` framework machinery is touched, so no
    integration-coverage obligation applies.
  - **Known residual risk, stated not hidden:** the TOCTOU race against the Python writer is
    unfixable without a shared lock protocol. It is documented in the module, scoped out of
    AC1, and its consequence is pinned by AC1b.

## Test Completeness Ledger

Principle: **testable ⇒ tested**. 57 behaviors, 57 `tested`, 0 `untestable`,
**0 untested-testable**. Rows 48–57 were added in response to the internal code
review (new behavior ⇒ new tests).

| # | Behavior | Disposition | Evidence |
|---|---|---|---|
| 1–6 | `endsWithoutNewline`: missing / zero-byte / LF / CRLF / unterminated / directory | tested | `jsonl-records.test.ts` (6 cases) |
| 7–21 | `splitRecords`: clean · concatenated · JSON-ws · blank · partial · verbatim remainder · no-resync · scalars+array are fragments · braces-in-string · escaped quote · backslash run · nested · unterminated string · NBSP/VT/FF not skipped · NaN degrades | tested | `jsonl-records.test.ts` (15 cases) |
| 22–27 | `parseJsonlRecords`: clean multi-line · order preserved across lines · 1-based lineNo · blank-line numbering · CRLF absorbed · multiple corrupt lines | tested | `jsonl-records.test.ts` (6 cases) |
| 28–31 | writer: no concatenation on torn tail · no blank line (LF/CRLF/missing/zero-byte) · repeated appends · two halves compose on a lost race | tested | `triage-write.newline.test.ts` (7 cases) |
| 32–35 | store: recovery at `readAllItems` · header-concatenation · composes with two-pass status resolution · across tracked∪outbox · `appendIdsInFile` write-path probe | tested | `triage-store.recovery.test.ts` (7 cases) |
| 36–39 | reporting: silent on clean · silent when fully recovered · exactly one structured warn with bounded metadata and NO fragment text · true total vs capped sample | tested | `triage-store.recovery.test.ts` (4 cases) |
| 40 | cross-language parity on corrupted fixture (Boundary Probe) | tested | `triage-store.recovery.test.ts` vs real-Python `triage-recovery-resolved.json` |
| 41–45 | HTTP consumer chain: GET both records · GET partial · counts not under-counting · wholly-corrupt still 200 · dismiss lands on a recovered file | tested | `triage.recovery-api.test.ts` (5 cases) |
| 46 | `triage-store.ts` stays ≤ 305 lines (anti-ratchet) | tested | measured 304; `anti_ratchet_check.py` exit 0 |
| 47 | parity fixture round-trips byte-exact through git (no EOL normalization) | tested | `.gitattributes` `-text` + fixture CR-byte assertion |
| 48–50 | slow-path work budgets: attempt ceiling → fragment · line-length ceiling → fragment · a long but VALID record still takes the fast path | tested | `jsonl-records.test.ts` "work budgets bound the recovery walk" (3 cases) |
| 51–55 | `endsWithoutNewline` fault injection: short read → false · sizes from the OPEN handle (live-end, not a stale stat) · fd closed when the read throws · no close when the open fails · zero-byte short-circuits without reading | tested | `jsonl-records.faults.test.ts` (5 cases, `vi.mock("node:fs")`) |
| 56–57 | **web surface**: both halves of a concatenated line reach the Inbox · a partial line's valid record still renders and opens | tested | `client/e2e/flows/triage-record-boundary-recovery.spec.ts`, executed against an isolated stack (1 passed) |
