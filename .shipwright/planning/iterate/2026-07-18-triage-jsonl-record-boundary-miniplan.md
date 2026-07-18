# Mini-Plan: triage JSONL record-boundary recovery + newline guard

run_id: `iterate-2026-07-18-triage-jsonl-record-boundary` · Intent CHANGE · medium ·
Spec Impact MODIFY (FR-01.30) · risk flag `touches_io_boundary` (operator-declared)

## Context the reviewer needs

Port of monorepo PR #399 into the WebUI (TypeScript). The Python half
(`shared/scripts/triage.py`) has ALREADY shipped this fix, so TS is currently the
divergent side of a byte-parity-tested cross-language contract.

`.shipwright/triage.jsonl` is an append-only log. Two independent writers exist: the
Python producers and this TS server. They use **incompatible lock primitives** (Python
`msvcrt/fcntl` byte-locks via a `<file>.lock` sidecar; TS `proper-lockfile` via a
`.weblock` directory) — documented and deliberate (ADR-101/ADR-106). Line-atomicity of
small appends is the mitigation.

## The defect (two halves)

- WRITER `core/triage-write.ts:148` — `appendFileSync(targetPath, line)` appends a
  terminated line but never checks the file it appends TO is terminated. An unterminated
  predecessor puts two records on one physical line.
- READER `core/triage-store.ts:110` — `parseRawLines` skips any line failing `JSON.parse`,
  so a concatenated line discards BOTH records. Corruption reads as absence.

## Plan

1. **New neutral-leaf `server/src/core/jsonl-records.ts`** (never logs; corruption is
   returned as data):
   - `endsWithoutNewline(path)` — true iff exists, non-empty, last byte != `\n`.
     Missing/zero-byte → false. `\r\n` counts as terminated.
   - `splitRecords(line) -> { records, remainder }` — partial recovery.
   - `parseJsonlRecords(raw) -> { records, corrupt[] }` — line-numbered.
   Leaf placement avoids a `triage-store` <-> `triage-write` import cycle.
2. **Writer**: `const sep = endsWithoutNewline(targetPath) ? "\n" : ""` then
   `appendFileSync(targetPath, sep + line)`. Placed AFTER the header-bootstrap branch.
   Runs inside the caller's existing lock. File is never rewritten.
3. **Reader**: `parseRawLines(raw, onCorrupt?)` delegates per-line to `splitRecords`.
   Return type stays `Record<string, unknown>[]` (see constraint 2 below).
4. **Reporting**: server log ONLY (explicit user decision). `readBoardItems` collects
   fragments → one structured `console.warn` reusing the existing house idiom.
   `readAllItems` (counts) and `triage-origin.ts` (git blob) get recovery but stay silent.
5. **Tests**: RED-first per AC, plus a corrupted fixture regenerated through the REAL
   Python (`server/scripts/regen-triage-fixtures.py`) to prove cross-language parity.

## `splitRecords` contract (pinned to the Python leaf docstring)

- Skip ONLY JSON whitespace `" \t\r\n"` — NOT a unicode-aware whitespace test, which would
  accept NBSP / U+000B / U+000C and diverge from other JSON consumers of the same bytes.
- Blank / whitespace-only line → `([], "")` (formatting, not corruption).
- Only JSON **objects** are records; a bare scalar is a fragment (callers do `raw.event`).
- Recovery is **PARTIAL**: a valid record followed by an unrecoverable fragment yields the
  valid record AND the fragment. All-or-nothing recovery reproduces the very bug it fixes.
- `remainder` is VERBATIM from the first undecodable byte to end of line.

Implementation note: Python uses `JSONDecoder.raw_decode`, which has NO `JSON.parse`
equivalent. So this is NEW code, not a translation: a string-and-escape-aware brace scanner
finds the balanced end of an object, then `JSON.parse` validates the slice.

## Constraints that shaped the design

1. **Bloat anti-ratchet (hard gate).** `core/triage-store.ts` is baselined at exactly 305
   lines, `grandfathered`, and `core.hooksPath=scripts/hooks` is active. Growth blocks the
   commit. Headroom comes from deleting `tryParseLine` (7 lines) + `isPlainObject` (4),
   both dead once `splitRecords` owns parsing + object validation.
2. **`parseRawLines` must keep its array return.** Five consumers; one
   (`appendIdsInFile`) is on the **write** hot path — it drives residence routing for every
   status flip, so a parse-shape change would alter write behavior. Python's reader also
   returns a plain list and reports corruption separately.
3. Python parity fixtures are currently clean (no concatenation, all newline-terminated),
   so adding recovery cannot break existing parity gates.

## Alternative considered and REJECTED

Change `parseRawLines` to return `{ records, corrupt }` (the shape the Python `RecordRead`
dataclass suggests). Rejected: ripples through 5 call sites incl. the write hot path;
forces `readAllItemsWithDeliveredOrigin` to abandon its one-line `resolveUnion` composition
and breaks the load-bearing "degrade == readAllItems" equivalence test; and grows
`triage-store.ts` past its anti-ratchet ceiling.

## Acceptance Criteria

AC1 writer: unterminated predecessor → two separately-parseable lines, predecessor intact.
AC2 writer: already-terminated / missing / zero-byte → no blank line injected.
AC3 reader: concatenated line → BOTH records, in wire order.
AC4 reader: valid record + unrecoverable text → record returned AND fragment reported.
AC5 contract: blank → nothing; bare scalar → fragment; only `" \t\r\n"` skipped.
AC6 no regression: existing Python-parity gates byte-identical.
AC7 cross-language parity on a deliberately concatenated fixture (Boundary Probe).
AC8 reporting: exactly one structured warn from `readBoardItems`; leaf never logs; no API
    or client shape change.
AC9 bloat: `triage-store.ts` <= 305 lines; pre-commit anti-ratchet passes.

## Review questions

- Is the brace-scanner + `JSON.parse`-validate approach a faithful substitute for
  `raw_decode`? Any input class where it diverges from Python?
- Is the optional-callback side channel the right call vs. changing the return type, given
  constraint 2?
- Does the writer probe have a race or ordering hazard given the two-writer,
  incompatible-lock reality described above?
- Is "recovery everywhere, logging only at the board read" a defensible scope boundary?
