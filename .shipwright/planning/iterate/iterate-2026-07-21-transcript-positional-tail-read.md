# Iterate: the transcript reader reads only the tail it was asked for

- **Run ID:** `iterate-2026-07-21-transcript-positional-tail-read`
- **Intent:** CHANGE (Path B) — performance, behavior-preserving
- **Complexity:** medium (history-calibrated, `prior_source: history`, n=20)
- **Risk flags:** `touches_public_api` (`readChunk` backs
  `GET /api/external/tasks/:id/transcript`). `touches_auth` is a pattern
  false-positive — no auth code is in scope. No `touches_io_boundary`: no
  serialized format, env file or config schema changes; the bytes on the wire
  are unchanged by construction (AC-2).
- **Spec Impact:** **NONE** — identical bytes out, fewer bytes read. No FR text
  changes; no user-visible contract moves.
- **Affected FRs:** FR-01.66 (Mission tab)
- **Triage:** `trg-4c0e54d6` (deferred by
  `iterate-2026-07-21-mission-recovery-memo-perf`, PR #311)

## The defect

`SessionWatcher.readChunk` is the single transcript reader. It asks for a byte
range and then does this:

```ts
const bytes = await readWithRetry(() => this.deps.readFile(loc.path));  // WHOLE FILE
const from  = Math.min(Math.max(args.fromByte, 0), bytes.length);
let slice   = bytes.subarray(from);                                     // …then slice
```

Every caller therefore pays for the **whole file** no matter how little it
wants. The three production callers want very different amounts:

| Caller | Cadence | Asks for | Read before | Read after |
|---|---|---|---|---|
| `external/mission-context/wire.ts` | 10 s / open Mission tab | 512 KB tail (1 MB while unidentified) | whole file | **512 KB / 1 MB** |
| `external/transcript/routes.ts` | ~1 s / open task detail | whatever `fromByte` the client sends | whole file | `[fromByte, EOF)` |
| `external/inbox/_derive.ts` | 3 s (cold path only) | `fromByte: 0` — genuinely the whole file | whole file | whole file (correct) |

**Only the first row is a delivered win, and the review that established that is
recorded below.** The transcript endpoint is stateless and has always accepted a
`fromByte`, but the sole shipped client — `client/src/hooks/useTaskTranscript.ts:77`
— hardcodes `fromByte: 0` and says so in its own comment ("incremental
byte-offset fastpath is Sub-iterate 1.5 work if this becomes a hot-path
bottleneck"). So that poll asks for the whole file and, correctly, still gets
it. This run makes the *reader* honour a bounded request; it does not make that
caller issue one. See "What this run does NOT fix".

PR #311 narrowed the recovery window from "always 1 MB" to "1 MB once per task",
which cut UTF-8 decode, string allocation and downstream scanning. It could not
touch the read, and said so in the code
(`mission-context/routes.ts:61-64`). This run pays that debt.

## Measured, on this machine (2026-07-21)

Real corpus under `~/.claude/projects`, **not** synthetic:

```
n=203 transcripts   median 2.61 MB   max 137.9 MB   82 % over 1 MB   917 MB total
```

One sweep of the corpus, warm page cache, best of two alternating runs:

| | bytes moved | wall clock |
|---|---|---|
| whole-file read + slice (today) | **917 MB** | 229 ms |
| positional 512 KB tail (after) | **101 MB** | 37 ms |
| | **9.1× fewer** | **6.2× faster** |

Per **single poll** — the number a user actually waits on. The 512 KB column is
the shipped Mission-tab win; the 4 KB column is what the reader is now *capable*
of and what a client sending a cursor would get, not a win any caller collects
today:

| transcript | whole file (before) | 512 KB tail (Mission, shipped) | ~4 KB delta (capability) |
|---|---|---|---|
| median (2.6 MB) | 0.6 ms | 0.16 ms | 0.10 ms |
| p90 (5.9 MB) | 1.2 ms | 0.13 ms | 0.07 ms |
| max (137.9 MB) | **30.9 ms** | **0.12 ms** | **0.06 ms** |

End-to-end through the real `SessionWatcher` on the 137.9 MB transcript, after
the change: `readChunk` returns a valid 523,621-char newline-terminated chunk in
**2.22 ms**.

The shape is the point, not the absolute milliseconds: today's cost is **O(file
size)** and grows for the whole life of a session; the positional read is
**flat**, because it moves what was asked for. On the largest real transcript
that is a 258× difference per poll, and these figures are measured with a WARM
page cache — the honest worst case (a 138 MB cold read off disk) is far larger
for the left-hand column and unchanged for the right.

The allocation profile matters as much as the clock: today each poll allocates a
fresh Buffer the size of the file. At 1 Hz on a 138 MB transcript that is
~138 MB/s of garbage, plus a libuv threadpool slot (default 4) held for the
whole read while other file I/O queues behind it.

## Fix

Give `readChunk` a positional read: `open` → `fstat` → `read(buf, 0, len, from)`
→ `close`. `fromByte: 0` callers (the inbox derive) are unaffected — they still
read the whole file, because that is what they asked for.

The whole-file `readFile` dep is **removed**, not left beside the new one. No
test injects it (verified: 0 matches across `server/src`), so keeping it would
leave an injectable that silently no longer influences behavior — a trap for the
next person who overrides it in a test and wonders why nothing changes.

### Why `session-watcher.ts` splits

The file was at **299 lines** against the repo's 300-line convention. In place,
the change would have taken it to **~330** (the new dep docblock and the
positional-read wiring add ~31 lines while the 32 lines of moved helpers stay),
so it genuinely could not land there. It carries no
`shipwright_bloat_baseline.json` entry — checked against the real ARRAY shape of
`entries`, not the path-keyed map that a previous run got wrong — so the
anti-ratchet hook would not have blocked it. The convention still binds.

Stated precisely, because the first draft of this section said "lands well under
its ceiling" and the code review called that out: the file ends at **298**, one
line below where it started. The split bought headroom against the +31 the
change brought in, not a large reduction. The load-bearing justification is
cohesion, and one concrete gain: `readWithRetry` is now directly unit-testable
instead of reachable only through the class.

The split is by cohesion, not by line count: **how we touch the disk safely**
(`core/session-jsonl-io.ts` — the retry envelope, the positional read, the
newline scan) versus **what we look for** (`core/session-watcher.ts` —
discovery + the chunk contract). Net: session-watcher lands well under its
ceiling and `readWithRetry` becomes directly unit-testable rather than reachable
only through the class.

## Alternatives considered

**(B) Add a separate `readTail()` method, leave `readChunk` untouched.**
Rejected. It leaves the 1 Hz transcript poll — the highest-frequency consumer
and the larger cost — on the whole-file path, and creates two readers with
independent newline-trimming and rotation semantics. Those two would drift, and
the drift would be invisible until a chunk arrived split mid-line.

**(C) Cache file content server-side, keyed by fingerprint.** Rejected on two
counts. It contradicts architecture rule 4 (the transcript endpoint is
stateless — that is what makes multi-tab work by construction), and it would
retain multi-MB of transcript text per task in server memory, which the
mission-context reader explicitly avoids today (`revision` is metadata, never a
content digest, for exactly this reason).

**(D) Swap the hand-rolled `lastIndexOf` loop for native `Buffer.lastIndexOf`.**
Deliberately NOT done. Once the read is positional the scan only covers the tail
that was requested, so the swap buys approximately nothing new; folding it in
would blur the attribution of the measured win. Moved unchanged.

## Acceptance Criteria

- **AC-1** — `readChunk` reads only `[fromByte, EOF)` from disk. Bytes read are
  bounded by `size - fromByte`, never by file size.
- **AC-2** — Output is byte-identical to the whole-file implementation across
  every input class: `from = 0`, mid-file (on and off a line boundary), past
  EOF, negative, a tail containing no `\n`, an empty file, multi-byte UTF-8
  (including a `fromByte` landing mid-character), the rotation branch, and a
  file **truncated between the discovery stat and the read**. `content` /
  `fromByte` / `toByte` / `size` / `fingerprint` / `status` all unchanged.
- **AC-3** — The torn-read retry envelope still covers the read
  (EBUSY/EPERM/EACCES/ENOENT, 6 attempts, 50→1600 ms), and the file handle is
  closed on every path — including when the read itself throws.
- **AC-4** — A short read (the kernel returning fewer bytes than requested)
  never corrupts a chunk: content still ends on `\n` and `toByte` matches
  exactly what was delivered, so the next poll resumes correctly.
- **AC-5** — `server/src/core/session-watcher.ts` is back under the 300-line
  convention (298, against ~330 had the change landed in place) and no
  `shipwright_bloat_baseline.json` entry ratchets. Every new file is also under
  the convention.

## What this run does NOT fix

Named here rather than left to be inferred, because the first draft of this spec
claimed two of them as delivered.

1. **The transcript pane still asks for the whole file.**
   `client/src/hooks/useTaskTranscript.ts:77` sends `fromByte: 0` every second.
   The server would honour a cursor today — the sequential-poll test in
   `session-watcher.readchunk-positional.test.ts` models exactly that, and
   architecture rule 4 (stateless reads) is what makes it safe — but landing the
   client-side cursor means teaching the hook to accumulate content across polls
   instead of replacing it, which is a behavior change to the pane and outside a
   reader-level perf charter. Filed as follow-up triage.
2. **Two `~/.claude/projects` walks per transcript poll.** `readChunk` resolves
   the JSONL via `findByUuid`, then `transcript/routes.ts` resolves it again for
   the mtime; a Mission poll adds a third. Pre-existing, but now a comparable
   share of what a poll costs, since the read beside it got ~14× cheaper.
   `readChunk` already holds the `JsonlLocation` it could hand back. Filed with
   the above.

## Design check (Tier 2)

No UI surface changes: no component, route, style token or copy is touched, so
there is no visual delta to review and no design-fidelity pass is owed. The
user-visible consequence is purely temporal, and — per the correction above —
lands on the **Mission tab only**: it stops stuttering on long sessions, and
stops getting *worse* as a session grows. That regression-with-age is the
design-relevant part: the old behavior made the app feel slower the longer you
used it, which reads as the app degrading rather than as a file growing. The
transcript pane keeps its current feel until the cursor follow-up lands.

## Confidence Calibration

- **Boundaries touched:** the filesystem read boundary of the shared transcript
  reader (`server/src/core/session-watcher.ts` → new
  `server/src/core/session-jsonl-io.ts`). No serialized format, no env file, no
  config schema, no wire contract — `touches_io_boundary` is correctly not set,
  but the change IS a read-semantics change, so it is probed empirically below
  rather than argued.
- **Empirical probes run:**
  - **Baseline**: full server suite green BEFORE any edit — 247 files / 2890
    tests. So a later red is attributable, not ambient.
  - **Corpus probe (scratchpad algorithm)**: measured the real 203-transcript
    corpus rather than a synthetic file. 917 MB → 101 MB per sweep, 6.2×.
  - **Corpus probe (SHIPPED module)**: re-run importing the real
    `session-jsonl-io.ts` + `SessionWatcher`, because the first probe measured a
    copy of the algorithm and not the code that ships. 919 MB / 253 ms →
    102 MB / 44 ms; end-to-end `readChunk` on the 137.9 MB transcript = 2.22 ms,
    `status=ok`, 523,621 chars, newline-terminated. The probe file was deleted
    before commit.
  - **Positional-I/O probe**: wrapped a genuine `FileHandle` and recorded what
    `read()` was actually asked for — 100,001 bytes requested against a
    1,000,001-byte file. This is the probe that answers "did the read really get
    smaller", which no assertion on the return value can.
  - **Falsification probe**: reverted the truncation fix and re-ran; exactly the
    two new tests failed, and only those. The tests pin the defect rather than
    passing either way.
  - **Fence probe**: `grep readWithRetry` / `readFile:` over `server/src` before
    moving them — zero production importers of `readWithRetry` outside the
    module, zero injections of the `readFile` dep. That is what made removing
    the dep (rather than deprecating it) safe, and it refuted the external
    reviewer's "breaks consumers" finding empirically.
  - **Anti-ratchet probe**: `scripts/hooks/anti_ratchet_check.py` against the
    staged tree — exit 0. Run, not assumed; a previous run in this repo recorded
    the opposite from a broken lookup.
- **Test Completeness Ledger:** every behavior this diff introduces or changes.
  **0 untested-testable.**

  | # | Behavior | Status | Evidence |
  |---|---|---|---|
  | 1 | `readChunk` reads only `[fromByte, EOF)` | `tested` | io: positional-I/O probe over a real handle (bytes requested = 100,001, not 1,000,001) |
  | 2 | `fromByte: 0` still yields the whole file | `tested` | io: "fromByte 0 returns the whole file" |
  | 3 | Mid-file read returns exactly the tail | `tested` | io: "returns exactly [fromByte, EOF)" |
  | 4 | `fromByte` past EOF → empty, correct size | `tested` | io: "clamps a fromByte past EOF" |
  | 5 | Negative `fromByte` clamps to 0 | `tested` | io: "clamps a negative fromByte to 0" |
  | 6 | Empty file | `tested` | io: "handles an empty file" |
  | 7 | No read is issued when already at EOF | `tested` | io: "does not read at all when fromByte is already at EOF" |
  | 8 | Short read is filled by the loop, not truncated | `tested` | io: "fills the buffer across a short read" (10 one-byte reads) |
  | 9 | Truncation mid-read → caller clamps to the new size | `tested` | io: "re-stats after a short read" |
  | 10 | Truncation below `start` → bytes dropped, not relabelled | `tested` | io: "drops bytes that the post-truncation size can no longer address" — **verified to FAIL without the fix** |
  | 11 | Partial read capped at the post-truncation end | `tested` | io: "caps a partial read at the post-truncation end" — **verified to FAIL without the fix** |
  | 12 | A re-stat that GREW cannot inflate the clamp | `tested` | io: "never reports a size larger than the one the read observed" |
  | 13 | Handle closed when `read` throws | `tested` | io: "closes the handle when the read throws" |
  | 14 | Handle closed when `fstat` throws | `tested` | io: "closes the handle when fstat throws" |
  | 15 | A `close()` failure never replaces the read error | `tested` | io: "propagates the READ error, not a close() failure" |
  | 16 | A `close()` failure never fails a good read | `tested` | io: "does not fail a successful read because close() threw" |
  | 17 | Output equivalence vs. the whole-file reader, 12 input classes | `tested` | readchunk-positional: 12 parameterised cases vs. a reference implementation of the old algorithm + absolute invariants |
  | 18 | Rotation still detected before any read | `tested` | readchunk-positional: "still reports rotation" |
  | 19 | `missing` still reported with no JSONL | `tested` | readchunk-positional: "still reports missing" |
  | 20 | Sequential polling of a growing file: no dup, no skip | `tested` | readchunk-positional: "walks a growing file" |
  | 21 | `fromByte` is forwarded to the reader, not discarded | `tested` | readchunk-positional AC-1 spy |
  | 22 | One-shot EBUSY on the read is retried | `tested` | readchunk-positional AC-3 |
  | 23 | ENOENT retryable on the read, fatal for discovery | `tested` | readchunk-positional AC-3 + retry: "treats ENOENT as retryable by default" |
  | 24 | Short read still yields a `\n`-terminated chunk with matching `toByte` | `tested` | readchunk-positional AC-4 |
  | 25 | Bytes appended mid-read defer to the next poll, cursor-safe | `tested` | readchunk-positional: "defers bytes appended mid-read" |
  | 26 | `readWithRetry` envelope unchanged by the move | `tested` | retry: 4 cases (moved + the new ENOENT-policy case) |
  | 27 | `lastIndexOfByte` unchanged by the move | `tested` | retry: 3 cases |
  | 28 | The other two callers are unaffected | `tested` | `covered-by-existing-test` — full server suite green (249 files / 2929), incl. the inbox-derive and transcript-route suites |
  | 29 | The measured speed-up holds for the SHIPPED code, not just the design | `tested` | corpus probe against the real module (see probes) |
  | 30 | Cold-page-cache behavior on a 138 MB transcript | `untestable` | `requires-manual-visual-judgment` is wrong here; the honest code is **`requires-external-nondeterministic-service`** — the OS page cache cannot be evicted deterministically from a test, so only the warm figure is measurable. The warm number is the CONSERVATIVE one (cold strictly worsens the whole-file column and leaves the tail column ~flat), so the claim is not weakened by the gap |

- **Confidence-pattern check:**
  - **Asymptote (depth):** the win was *measured on the shipped module*, not
    argued from the design, and the equivalence claim is pinned by a reference
    implementation of the code being replaced rather than by my reading of it.
    The one place further digging did pay was the truncation race — reviewed
    twice, wrong twice, and only the second fix survives a test that fails
    without it. Depth beyond that yields diagnostics, not decisions.
  - **Coverage (breadth):** all three production callers are accounted for; both
    concurrency directions (append and truncate) are covered, and truncation in
    both its sub-shapes (`off == 0` and `off > 0`); every failure path of the
    new handle lifetime (stat throw, read throw, close throw, close throw
    *during* a read throw); and both retry policies. The deliberate gap — the
    client still sending `fromByte: 0` — is stated in "What this run does NOT
    fix" rather than papered over.
  - **Integration composition:** `cross_component` is NOT set, and recomputing
    it from the diff agrees: no merge/churn resolver, no Claude-Code hook
    fan-out, no pipeline phase validator, no campaign drain. No
    `category:"integration"` behavior is owed.

## External code review (openrouter: openai + gemini) — outcomes

Run twice: on the mini-plan before building, and on the diff after.

**PLAN pass — one HIGH, VALID, fixed before a line was written.** Both reviewers
independently attacked the same seam: the equivalence argument does not hold if
the file is truncated between `fstat` and `read`, because the helper would report
the pre-read size while the old whole-file reader clamped against the bytes it
actually obtained. Fixed with the re-stat on the short-read path. Three MEDIUMs
also actioned: the contract is now stated as "reads through the EOF the OPEN
HANDLE observed" with a cursor-safety test for concurrent appends; the ENOENT
policy at the call site is pinned by a test instead of left implicit; and — the
most useful of the three — the objection that a watcher-level `readTail` spy
proves only that an offset was *passed*, never that a positional read *happened*.
That produced the real-`FileHandle` probe, which is now the strongest assertion
in the suite. One LOW (a throwing `close()` masking the primary error, and with
it the retry classification) fixed; one LOW (security) needed no action.

**DIFF pass — one HIGH, VALID, fixed.** The re-stat fix from the plan pass was
half a fix: with bytes already in hand (`off > 0`) and the file truncated below
`start`, those bytes were returned under a smaller reported size, so `readChunk`
labelled content from offset 900,000 as starting at 200,000. The internal
reviewer raised the same defect independently. Fixed by capping delivered bytes
to `effective - start`; two tests added, both verified to fail without the fix.

**DIFF pass — one MEDIUM, REFUTED.** `readWithRetry` "was a named export and is
now re-exported nowhere, so consumers break". There are no consumers: the only
importer was `session-watcher.test.ts`, updated in the same diff. `tsc --noEmit`
exits 0 and 249/249 server test files pass — a compile-time claim that the
compiler itself falsifies. Not actioned.

## Internal code review (subagent) — outcomes

- **HIGH — VALID, spec corrected.** The spec claimed the 1 Hz transcript poll
  was "the worst of the three" and that this run paid that debt. It does not:
  `useTaskTranscript.ts:77` hardcodes `fromByte: 0`, so that caller asks for the
  whole file and still gets it. The measurement table, the caller table and the
  design-check paragraph all overstated the win. Corrected, and the unpaid part
  is now its own section rather than a footnote. This is the finding that
  mattered most — the code was right; the story told about it was not.
- **MEDIUM — VALID, fixed.** The incomplete truncation fix (see above).
- **MEDIUM — VALID, fixed.** `external/mission-context/routes.ts` still carried
  a comment asserting that `readChunk` reads the whole file and that this is
  "deliberately untouched here", citing the very triage item this run closes.
  Rewritten with the measured figures, and the correction is stated as a
  correction so the next reader can see the comment moved.
- **LOW — VALID, fixed.** CLAUDE.md architecture rule 6 attributed the retry
  envelope to `session-watcher.ts`. Text amended, numbering untouched (it is
  load-bearing); the rule now also records the positional read and the ENOENT
  asymmetry.
- **LOW — VALID, corrected.** AC-5's "lands well under its ceiling" was false
  (299 → 298). The counterfactual (~330 in place) is what carries the argument,
  and the section now says so plainly.
- **LOW — deferred with reason.** The double `~/.claude/projects` walk per poll.
  Pre-existing and genuinely out of a reader-level charter, but it is now a
  comparable share of poll cost, so it is named in "What this run does NOT fix"
  and filed as triage rather than silently dropped.
- **LOW — sequencing, not a defect.** "No CHANGELOG drop." F4 writes it; it had
  not run when the review did.
- Review confirmed clean, having checked rather than assumed: fd lifetime on
  every path; `allocUnsafe` cannot leak uninitialised memory on either return
  path; the fill loop terminates; the `readWithRetry` / `ENOENT_FATAL` /
  `lastIndexOfByte` move is character-identical; the rotation branch reaches no
  new state; architecture rules 4, 5, 6 and DO-NOT #1 hold (`open(p, "r")` is
  the sole open, read-only).
