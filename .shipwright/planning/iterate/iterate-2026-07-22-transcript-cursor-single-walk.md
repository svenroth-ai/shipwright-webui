# Iterate: the transcript pane asks for the delta, and a poll walks the disk once

- **Run ID:** `iterate-2026-07-22-transcript-cursor-single-walk`
- **Intent:** CHANGE (Path B) — performance; the rendered transcript is unchanged
- **Complexity:** medium (`prior_source: history`, n=20; the scope keyword said
  trivial and was wrong — this touches a public route handler, an exported
  result type and the accumulation semantics of the pane)
- **Risk flags:** `touches_public_api`, self-declared. The message classifier
  returned none because it sees the prompt, not the diff: `readChunk`'s exported
  `TranscriptReadResult` gains a field and `GET /api/external/tasks/:id/transcript`
  changes how it obtains the mtime it acts on. Not `touches_io_boundary` (no env
  file, config schema, state file or serialized format), not `cross_component`
  (no merge/churn resolver, hook fan-out, phase validator or campaign drain),
  not `touches_ci_supplychain` (no `.github/**`). All three are re-checked
  against the real diff by the F11 verifier.
- **Spec Impact:** **NONE**. `none_reason`: the pane renders the same bytes in
  the same order; the endpoint's request and response shapes are untouched
  (`fromByte` has been an accepted parameter since day one — this run is the
  first caller to use it). No FR text moves.
- **Affected FRs:** FR-01.02 (task detail 3-pane viewer — the survivor
  `FR-01.12` "stateless byte-range transcript read" folded into), FR-01.66
  (Mission view, whose poll loses a walk)
- **Predecessor:** `iterate-2026-07-21-transcript-positional-tail-read` (PR #313)
  named both of these in its "What this run does NOT fix" section and filed them
  as triage. This run pays both.

## The defect

Two independent leftovers, both in the same 1 Hz poll.

### 1. The pane asks for the whole file, once a second, forever

`client/src/hooks/useTaskTranscript.ts:77` sends `fromByte: 0` on every tick and
says so in its own docblock ("incremental byte-offset fastpath is Sub-iterate 1.5
work"). The server honours it exactly — it reads, decodes, and serialises the
entire transcript, every second, for as long as the tab is open.

PR #313 made the **disk read** positional. It could not make this caller ask for
less, and the disk read is not where the money is. A poll does four O(file)
things and #313 addressed one of them:

| step | who | fixed by #313? |
|---|---|---|
| 1. read `[fromByte, EOF)` off disk | `session-jsonl-io.ts` | yes — but `fromByte` is 0, so it reads everything |
| 2. `Buffer → string` (UTF-8 decode) | `session-watcher.ts` | no |
| 3. `JSON.stringify` inside `c.json()` | `transcript/routes.ts` | no |
| 4. `JSON.parse` on the client | `externalApi.httpJson` | no |

### 2. Every poll walks `~/.claude/projects` twice

`readChunk` resolves the JSONL through `findByUuid`, discards the location, and
then `transcript/routes.ts:109` walks the whole directory a second time for the
same file's mtime. A Mission-context poll repeats the pattern
(`mission-context/wire.ts` walks, then `readChunk` walks again), as does the
Inbox cold path. Pre-existing, and it did not matter while the read dominated.
It matters now.

## Measured, on this machine (2026-07-22)

Real corpus under `~/.claude/projects` — `n=210, median 2.49 MB, p90 5.66 MB,
max 131.5 MB, 890 MB total`. Warm page cache, best of three.

**One poll, all four steps, as the route and client actually perform them:**

| transcript | mode | read | decode | stringify | parse | **total** | wire |
|---|---|---:|---:|---:|---:|---:|---:|
| median 2.49 MB | `fromByte: 0` (today) | 0.75 | 0.49 | 5.28 | 2.68 | **9.19 ms** | 2 725 KB |
| | 4 KB cursor (after) | 0.20 | 0.00 | 0.01 | 0.01 | **0.23 ms** | 5 KB |
| p90 5.66 MB | `fromByte: 0` | 1.43 | 1.28 | 11.23 | 6.86 | **20.79 ms** | 6 254 KB |
| | 4 KB cursor | 0.07 | 0.00 | 0.00 | 0.00 | **0.08 ms** | 5 KB |
| max 131.5 MB | `fromByte: 0` | 36.58 | 30.03 | 221.02 | 97.06 | **384.68 ms** | 135 984 KB |
| | 4 KB cursor | 0.17 | 0.01 | 0.01 | 0.01 | **0.19 ms** | 5 KB |

Read the max row twice. **384 ms of a 1 000 ms poll budget**, and the disk read
that #313 optimised is 36.58 ms of it — under a tenth. `JSON.stringify` alone is
221 ms. On the median transcript a single open tab moves **2.7 MB/s** across
localhost HTTP and through two JSON codecs, indefinitely, to redeliver bytes the
client already has.

**What that table is and is not.** It measures the transport — the four steps
above. It does NOT measure what the pane then does with the content, and the
external plan review was right to push on that (finding #4). `TaskDetailPage`
re-runs `parseSessionJsonl` over the **whole accumulated transcript** in a
`useMemo` keyed on `transcript.content`, so every poll carrying new bytes pays it
again. Measured on the same corpus:

```
parseSessionJsonl, full content   median 2.49 MB → 5.6 ms (1 127 events)
                                  p90    5.66 MB → 11.3 ms (3 015 events)
```

That cost is untouched by this run, and it splits the win in two:

| open tab, per poll | today | after | |
|---|---:|---:|---|
| **idle** session (no new bytes) | 9.19 ms | 0.23 ms | **40×** — the delta is empty, the content string is unchanged by value, and the `useMemo` does not re-run |
| **actively streaming** (median) | 14.8 ms | 5.8 ms | **2.5×** — transport collapses, the full-content re-parse remains |

The idle case is the one that runs for hours and was pure waste. The streaming
case improves by less, and the remainder is named in "What this run does NOT
fix" rather than folded into the headline.

**End-to-end through the SHIPPED path**, because the table above models the four
steps rather than running them. A real Hono server on an isolated `USERPROFILE`,
the real route, the real `SessionWatcher`, real JSON serialisation and a real
HTTP round trip — `?fromByte=0` against `?fromByte=size-4096`, best of three:

| transcript | `fromByte: 0` (before) | cursor (after) | | response body |
|---|---:|---:|---:|---|
| median 2.49 MB | 15.46 ms | 1.35 ms | **11×** | 2 725 KB → 5 KB |
| p90 5.66 MB | 31.28 ms | 1.39 ms | **23×** | 6 255 KB → 5 KB |
| max 131.49 MB | **641.27 ms** | **1.39 ms** | **461×** | 135 985 KB → 5 KB |

These are larger than the modelled numbers because they include HTTP, Hono and
the directory walk. The cursor column is flat at ~1.4 ms across a 53× range of
file size — that flatness *is* the change; the residue is round-trip overhead,
not the transcript. And the headline: on the largest real transcript this
project has, the pane spent **641 ms of every 1 000 ms** re-fetching bytes the
browser already had.

**One `~/.claude/projects` walk**, measured against the shipped `SessionWatcher`
(5 subdirs, 336 entries, 210 transcripts on this machine):

```
findByUuid HIT  (avg over 5 corpus positions): 0.45 ms
findByUuid MISS (full walk)                  : 0.47 ms
```

So the two follow-ups are not independent in size — they are sequential:

| per transcript poll (median transcript) | walks | read+decode+wire | total |
|---|---:|---:|---:|
| today | 0.90 ms | 9.19 ms | ~10.1 ms |
| after the cursor only | 0.90 ms | 0.23 ms | ~1.13 ms |
| after both | 0.45 ms | 0.23 ms | **~0.68 ms** |

The cursor removes 89 % of a poll. The **duplicate** walk was 4.5 % of the
original total (0.45 of 10.09 ms) and is **40 % of what is left** afterwards
(0.45 of 1.13 ms) — the 9 % / 80 % figures belong to *both* walks together, and
an earlier draft of this sentence quoted those while describing only the
duplicate. That ordering is still the argument for doing the two together:
fixing only the cursor promotes a 4.5 % item to the largest single line.

Honest caveat on the walk figure: this machine has 5 project subdirs. The walk
is O(subdirs × entries), so a developer with thirty adopted projects pays
proportionally more, and the corpus figure above is a floor, not a typical case.

## Fix

### Part 1 — client cursor (`useTaskTranscript`)

Send `fromByte: <cursor>`; accumulate instead of replace. The cursor is the
`toByte` the server last reported, which is always on a `\n` boundary, so an
accumulated buffer is always a whole-line prefix of the file.

**Replace-vs-append is decided by what the server echoes back, never by what the
client believes it asked for**, and the decision is committed against the cursor
that is *currently accepted*, not the one captured when the request left:

```
chunk.fromByte === 0            → replace  (first poll, post-rotation, post-missing)
chunk.fromByte === buf.cursor   → append   (the ordinary case)
otherwise                       → drop the response, keep the rendered content,
                                  reset cursor + fingerprint so the next tick
                                  refetches whole
```

The accumulated text and its byte cursor live together in **one ref**
(`{ content, cursor }`), mutated in a single synchronous check-and-advance after
the tick's `cancelled` guard, with no `await` inside the critical section. State
is then published from it. This is what makes the third branch cheap and makes
a duplicate or out-of-order response a no-op instead of a splice at the wrong
offset: the second application of the same delta sees a cursor that has already
moved and is dropped.

The plan review pushed hard here (openai #1 HIGH, gemini #1/#2), and the pushback
was worth taking even though the poller is already sequential — `setTimeout` is
scheduled only after the previous fetch settles, and the `cancelled` flag stops a
task-switch response from landing. Both of those are *implicit* invariants of the
current code. Gating the commit on the live cursor makes the property local and
testable instead of a consequence of two other things staying true.

One correction to the reviewers, recorded because the suggested fix would have
shipped a bug: gemini proposed guarding with `prev.length === chunk.fromByte`.
`prev` is a JS string measured in UTF-16 code units and `fromByte` is a byte
offset. Every non-ASCII character in a transcript — and Claude transcripts are
full of them — breaks that equality. The cursor must be carried as bytes, which
is why it is tracked explicitly rather than derived from the content's length.

Resets — cursor to 0, accumulated content cleared — on `taskId` change, on
`missing`, and on `rotated`. The `rotated` handler already nulls the
fingerprint; the cursor has to travel with it or the next poll asks a new file
for an old offset.

`modelName` goes incremental, with the asymmetry the review caught (openai #2):

- on an **append**, `extractModelName(delta) ?? previous` — equivalent to "last
  `"model":"…"` in the whole file", because the last occurrence overall is the
  last occurrence in the newest delta that has one;
- on a **replace**, `extractModelName(content)` and nothing else. A `fromByte: 0`
  response is an authoritative snapshot, so the model must be allowed to become
  `null` again. Carrying `previous` across a rotation or a task switch is exactly
  the leak AC-3 forbids, and my first draft of this rule would have caused it.

### Part 2 — one walk per poll

`readChunk` already resolves a `JsonlLocation` and throws it away. Make it
symmetric:

- **out** — `{ status: "ok", chunk, location }`. `transcript/routes.ts` reads
  `result.location.mtimeMs` and deletes its second `findByUuid`.
- **in** — an optional `location` argument. A caller that already walked
  (`mission-context/wire.ts` needs `sizeBytes` to compute the tail offset
  *before* the read; `inbox/_derive.ts` walks on its cold path) passes it and
  `readChunk` skips its own walk.

Both directions are earned by real call sites; neither is speculative. Net
walks per poll: transcript 2→1, Mission 2→1, Inbox cold path 2→1.

`location` is added to the `ok` variant only. `rotated` also has one in hand, but
no caller wants it — the route returns before the mtime block on that branch —
and an unused union field is a claim someone will later have to verify. It is
**required**, not optional: the compile errors that lands on every `readChunk`
test mock are the point, because an optional field would let the route keep a
silent `?? findByUuid()` fallback and re-grow the second walk (openai #5).

**The freshness contract, stated because the review went for it (openai #3).**
Passing a `location` in means "I walked in this same poll; do not walk again". It
does *not* make the location authoritative over the bytes: `readTailFromDisk`
opens the path and runs its own `fstat`, so the read is bounded by the size *it*
observes, and bytes appended between the caller's walk and the read are simply
deferred to the next poll — the concurrency contract #313 established, unchanged.
What the passed location does supply is `chunk.size` and the fingerprint. That
would matter if a caller passing a stale location also relied on the fingerprint
for rotation — and none does: both `mission-context/wire.ts` and
`inbox/_derive.ts` pass `expectFingerprint: null`, while the one rotation-
sensitive caller, the transcript route, does not pass a location at all. So the
concern is real in the abstract and empty in this codebase; the asymmetry is
documented at the call sites and pinned by a test rather than left to hold by
luck. `readWithRetry` wraps only the read, never `findByUuid`, so the returned
`location` is by construction the one the delivered bytes came from, including
on the last of six retries.

`JsonlLocation` is constructed only by `findByUuid` / `findManyByUuid` and no
route accepts one from a request, so this does not open a path-trust boundary
(openai #6). Keeping it that way is a constraint on future callers, noted here
and in the docblock.

### THREE behavior changes, all deliberate

An earlier draft of this section declared one. The internal review found the
other two, both introduced by this run's own fixes, and an undeclared behavior
change is exactly what the predecessor run had to be corrected for.

1. **A JSONL deleted mid-poll no longer idles a live task.** Today, if the file
   vanishes between `readChunk`'s walk and the route's second walk, `loc` is
   `null`, `mtime` is `0`, and `now - 0 > ACTIVE_IDLE_THRESHOLD_MS` flips a live
   task to `idle` and persists `lastJsonlSeenMtimeMs: 0`. One walk cannot
   disagree with itself, so the race is gone and the mtime the server acts on is
   now consistent with the fingerprint the client is handed in the same
   response.
2. **The fingerprint no longer survives a task switch.** It never should have:
   the server compares the supplied `mtime:size` against the *new* file, so
   switching to a task with a smaller transcript produced a spurious `rotated`
   on its first poll. Pre-existing; fixed here because the reset semantics are
   what this run is reasoning about.
3. **Switching tasks blanks the pane immediately** instead of leaving the
   previous task's conversation and model name on screen until the new task's
   first response lands. This one is visible — see the design check.

### The cursor gives up a safety property; the resync buys it back

While the client asked for the whole file every second, *any* divergence
repaired itself within a second: a mis-spliced delta, a transcript swapped under
the same uuid, a bug in the fold. That self-healing was accidental, and the
cursor removes it.

The internal review demonstrated the concrete case by probe: the server reports
`rotated` only on a **shrink** (`sizeBytes < fromByte || sizeBytes < prevSize`),
so a transcript replaced under the same uuid by a **same-or-larger** one slips
through, and its delta is appended onto the wrong prefix. The pane then
disagrees with disk *permanently* — where before it recovered on the next tick.

So the hook asks for the whole file once every `RESYNC_EVERY_POLLS` (60) ticks
regardless of the cursor. That keeps ~98 % of the saving — one whole-file read a
minute instead of sixty — and bounds how long the pane can be wrong, for any
cause, including a defect in `accumulate` itself. Widening the fingerprint to
carry file identity would detect the replacement directly, but it changes the
rotation contract for every caller and belongs to its own run.

### Why `session-watcher.ts`'s header shrinks

The file is at 298 of a 300-line convention and this change adds ~8 lines. The
budget comes from its own header: lines 15–24 describe the torn-read retry
envelope in full and are *immediately followed* by a paragraph pointing at
`session-jsonl-io.ts`, which owns it. That duplication is an artefact of PR
#313's split — both halves kept the text. Collapsing it to the pointer is the
cleanup this change forces, and it is disclosed here rather than smuggled in as
unrelated tidying. No `shipwright_bloat_baseline.json` entry exists for any
touched file (checked against the real ARRAY shape of `entries`).

## Alternatives considered

**(A) Server-side location cache with a short TTL.** A 250 ms memo inside
`SessionWatcher` would kill every duplicate walk with no call-site changes.
Rejected. `mtimeMs` and `sizeBytes` are not incidental metadata here — they *are*
the fingerprint, and the fingerprint is what detects rotation. A cache that
serves a 250 ms-old size can suppress a rotation for a poll, which is a
correctness bug traded for a 0.45 ms saving. It is also the same family of
server-side read state that the predecessor run rejected as its alternative (C),
and the Inbox's own bespoke warm-path cache (`inbox/_cache.ts`) already shows
that invalidation here is a per-caller judgement, not a blanket one.

**(B) Keep `fromByte: 0` and add a "not modified" short-circuit** when
`expectFingerprint` still matches. Rejected: it fixes only the idle case. The
expensive case is an *active* session on a large transcript, where the
fingerprint changes every second and the whole file ships anyway.

**(C) Push the delta over SSE / WebSocket.** Forbidden by architecture rule 7
(no SSE for transcript) and unnecessary — the endpoint has accepted a cursor
since day one; nothing was missing but a client that used it.

**(D) Have the hook keep the accumulated text in a `useRef` and expose a
version counter** to avoid re-rendering on an empty delta. Deliberately not
done. `prev.content + "" === prev.content` by value, so the existing
`useMemo([transcript.content])` consumers already skip their work; the remaining
re-render is a shallow one that predates this run. Folding it in would blur the
attribution of a measured change with an unmeasured one.

## Acceptance Criteria

- **AC-1** — After the first poll, the hook sends a non-zero `fromByte` equal to
  the previous response's `toByte`, and the pane's rendered content equals the
  concatenation of every delta received — byte-identical to what a `fromByte: 0`
  poll would have returned at the same instant.
- **AC-2** — Accumulation self-corrects. `rotated`, `missing`, and a `taskId`
  switch each reset the cursor to 0 and the buffer to empty; a response whose
  `fromByte` is neither 0 nor the current cursor is discarded without corrupting
  the pane and triggers a whole-file refetch on the next tick.
- **AC-3** — `modelName` is unchanged in value from the whole-file
  implementation, including when the newest delta contains no `"model"` field
  (it keeps the previous value) and across a reset (it does not leak the prior
  task's model).
- **AC-4** — `readChunk` returns the `JsonlLocation` it resolved on `status:
  "ok"`, and accepts a pre-resolved one to skip its walk. A transcript poll,
  a Mission-context poll and an Inbox cold-path derive each perform exactly ONE
  `~/.claude/projects` walk, asserted by counting `readdir` calls against the
  real `SessionWatcher`.
- **AC-5** — `GET /api/external/tasks/:id/transcript` produces the same state
  transitions, the same persisted `lastJsonlSeenMtimeMs`, and the same response
  body as before for every branch (`ok` / `missing` / `rotated`, terminal and
  non-terminal states) — except that a JSONL deleted mid-poll no longer idles a
  live task.
- **AC-6** — Every touched file stays under the 300-line convention and no
  `shipwright_bloat_baseline.json` entry ratchets.

## Reflection (F3a)

**A performance fix can spend a safety property without noticing.** The whole
argument for the cursor is that the pane already has the bytes, so re-fetching
them is waste. What that framing hides is *what else* the waste was buying: a
whole-file poll re-establishes ground truth every second, so any divergence —
from any cause — healed itself before a human could see it. Nothing in the diff
looks like it removes a safety net, and no acceptance criterion I wrote would
have caught it. It took a reviewer building an adversarial probe. The general
form: when you delete redundant work, ask what the redundancy was silently
guaranteeing, because that guarantee is nowhere in the code as an assertion.

**Measure the shipped path or don't quote the number.** My first probe modelled
a poll's four steps faithfully and still understated it by 1.7× (384 ms vs the
641 ms the real route takes on the same file). The predecessor run learned this
same lesson one iterate ago and its spec says so — I read that spec, wrote the
modelled probe anyway, and only replaced it because the same reviewer objection
landed again. Reading a lesson is not learning it; the cheapest guard is a rule,
not a resolution: *no number in a spec that wasn't produced by the shipped code.*

**The disconfirming probe is the one worth running.** The measurement I nearly
skipped — what the cursor does *not* fix — cut the honest claim from 40× to 2.5×
for actively-streaming sessions. Every other probe I ran confirmed what I already
believed. That asymmetry is the tell: a probe that can only agree with you is
documentation, not evidence.

**A reviewer's suggested fix deserves the same suspicion as the defect.** Gemini
proposed guarding the append with `prev.length === chunk.fromByte`. It is a
plausible one-liner, it would have passed every ASCII fixture, and it would have
desynced the pane on the first accented character in a real transcript. The
finding was worth taking; the fix was not. Both got tested.

## What this run does NOT fix

Named here rather than left to be inferred — the predecessor run had to add this
section retroactively after its review found the story overstated, and the same
external reviewer found the same class of overstatement in this plan's first
draft (finding #4).

1. **The pane still re-parses the whole transcript on every poll that carries
   new bytes.** `TaskDetailPage`'s `useMemo` is keyed on `transcript.content`, so
   a non-empty delta re-runs `parseSessionJsonl` over everything accumulated —
   5.6 ms at the median, 11.3 ms at p90, measured above. `BubbleTranscript`
   likewise re-renders from the full string. That is why the streaming case
   improves 2.5× and not 40×. Fixing it means an incremental parse and a keyed
   event list, which is a renderer change, not a fetch change, and is filed as
   follow-up triage rather than smuggled in here.
2. **The client still holds the entire transcript in memory.** Accumulation
   makes peak client memory identical to today's (both hold the full string);
   it does not reduce it. Only what crosses the wire and the codecs each second
   changes.
3. **Three of the four remaining walk sites are untouched.** `tasks/list-get.ts`
   and the Inbox warm path have their own resolution strategies
   (`findManyByUuid`, a stat-first cache) that are already single-walk or better.
   This run only removes *duplicate* walks inside one logical poll.

## Design check (Tier 2)

No component, route, style token or copy changes. There is **one** visual delta,
and the first draft of this section wrongly said there were none — on the very
surface the run is about (internal review, MEDIUM-2c).

**Switching between tasks now blanks the transcript pane** (and clears the model
name in the header) until the newly-selected task's first poll returns, rather
than leaving the previous task's conversation on screen. Two reasons that is the
right way round, not merely a side effect: showing task A's conversation beneath
task B's title is *wrong content under the wrong heading*, which is worse than
an empty pane; and the stale window used to last until the first response
arrived — indefinitely if it was slow or failed. It is bounded by one poll
(≤ 1 s) and the pane already has an empty state. No other pixel moves, so no
design-fidelity pass is owed.

The rest of the user-visible consequence is temporal, and lands on the surface
people actually watch: the **transcript pane** of an open task.

What it fixes is not "the pane is slow" but "the pane charges you for the whole
session, every second, whether or not anything happened". A tab left open on a
finished or parked session — which is most of the time a task detail page is on
screen — currently re-fetches, re-decodes and re-serialises everything the
session ever wrote, once a second, to hand back bytes the browser already has.
Measured end to end on the largest real transcript here, that is **641 ms of
every second**, and it drops to 1.4 ms.

Two things deliberately do not change, and the honest version of the design story
depends on saying so:

- **While Claude is actively writing**, the pane still re-parses everything it
  has accumulated, so the improvement there is ~2.5× rather than ~40×. The
  remaining cost is the renderer's, not the fetch's.
- **Memory is unchanged.** The client held the full transcript before and holds
  it after; accumulation is not a reduction in what is retained, only in what
  crosses the wire.

Claiming otherwise would repeat exactly the overstatement the predecessor run's
review had to correct, one iterate later.

## Confidence Calibration

- **Boundaries touched:** the HTTP read boundary between the transcript pane and
  `GET /api/external/tasks/:id/transcript` (the request changes; the response
  shape does not), and the internal reader contract `SessionWatcher.readChunk`
  (an exported result type gains a required field, and an optional input
  arrives). No env file, config schema, state file or serialized format, so
  `touches_io_boundary` is correctly unset — but the *accumulation semantics*
  are new, so they are probed empirically below rather than argued.
- **Empirical probes run:**
  - **Baseline before any edit** — server 250 files / 2931 tests, client 314 /
    2961, both green. A later red is attributable, not ambient.
  - **Per-poll cost on the real corpus** (n=210, median 2.49 MB, max 131.5 MB):
    broke a poll into its four O(file) steps and measured each. Established that
    the disk read the predecessor optimised is **under a tenth** of the cost
    (36.58 of 384.68 ms at the max) and `JSON.stringify` alone is 221 ms.
  - **End-to-end through the SHIPPED path** — a real Hono server on an isolated
    `USERPROFILE`, real route, real watcher, real HTTP: 15.46 → 1.35 ms
    (median), 641.27 → 1.39 ms (max). Run *because* the first probe modelled the
    steps rather than executing them, which is precisely the criticism the
    predecessor run levelled at its own first probe.
  - **Walk cost against the shipped `SessionWatcher`** — 0.45 ms HIT / 0.47 ms
    full MISS over 5 subdirs and 336 entries. This is what made the duplicate
    walk worth removing in the same run, and it is measured, not assumed.
  - **Residual probe (the disconfirming one)** — measured what the cursor does
    NOT remove: `parseSessionJsonl` over the full accumulated content, 5.6 ms
    median / 11.3 ms p90 per poll carrying new bytes. This is why the headline
    is split into idle (40×) and streaming (2.5×) instead of one flattering
    number.
  - **Falsification, six times.** Each fix reverted individually, each breaking
    exactly one test and only that one: `fromByte` pinned to 0 (cursor test, and
    separately both E2E tests against a real browser); the model carried forward
    on a replace; the reviewer's `prev.length` guard (fails the UTF-8 case —
    proving the suggested fix would have shipped a bug); the `location`
    pass-through removed from the Mission and Inbox callers (walk count 2, not
    1); `dueForResync` forced false. The route's double walk was red before the
    fix at 20 walks for 10 polls.
  - **Anti-ratchet** — `scripts/hooks/anti_ratchet_check.py` against the staged
    tree, exit 0. Run, not assumed.
  - **F0.5 on a real browser + real stack** — 6 Playwright tests green
    (2 new + 4 pre-existing transcript specs), and the 2 new ones verified to
    FAIL on the pre-change client.
- **Test Completeness Ledger** — every behavior this diff introduces or changes.
  **0 untested-testable.** Enumeration basis: the six ACs, walked against the
  diff hunk by hunk. +35 unit tests (server 250→253 files / 2931→2948; client
  314→318 / 2961→2992) and +2 E2E.

  | # | Behavior | Status | Evidence |
  |---|---|---|---|
  | 1 | The poll sends the previous response's `toByte`, not 0 | `tested` | cursor: "second poll asks from … toByte"; E2E 103 AC-1 (wire-level) |
  | 2 | Accumulated content = concatenation of every delta | `tested` | cursor: "three polls"; E2E 103 (a line that only ever arrived in a delta) |
  | 3 | `fromByte 0` REPLACES | `tested` | accumulate: "fromByte 0 REPLACES" |
  | 4 | `fromByte === cursor` APPENDS, cursor → `toByte` | `tested` | accumulate: "APPENDS and advances" |
  | 5 | Any other `fromByte` is rejected; pane intact, cursor rewound | `tested` | accumulate: "REJECTED without corrupting the pane" |
  | 6 | A duplicate delta applies once | `tested` | accumulate: "SAME delta twice" |
  | 7 | The cursor is BYTES, not string length | `tested` | accumulate: multi-byte UTF-8 — **verified to FAIL under the reviewer's suggested guard** |
  | 8 | An empty delta preserves content by value (keeps the `useMemo` skip) | `tested` | accumulate: "no-op … BY VALUE" |
  | 9 | Model carried forward when a delta has none | `tested` | accumulate + cursor: "EARLIER delta" |
  | 10 | Newest delta's model wins | `tested` | accumulate: "last occurrence wins" |
  | 11 | A REPLACE with no model CLEARS it | `tested` | accumulate — **verified to FAIL without the fix** |
  | 12 | A rejected chunk leaves the model untouched | `tested` | accumulate: "REJECTED chunk leaves the model" |
  | 13 | `rotated` resets buffer + cursor + fingerprint | `tested` | cursor-reset; E2E 103 AC-2 on a real browser |
  | 14 | `missing` resets buffer + cursor + model | `tested` | cursor-reset: "missing clears" |
  | 15 | Task switch resets cursor AND fingerprint | `tested` | cursor-reset: "no inherited fingerprint" |
  | 16 | Task switch blanks the PUBLISHED state at once | `tested` | cursor-reset: "blanks the pane IMMEDIATELY" |
  | 17 | A late response from the previous task never lands | `tested` | cursor-reset: "in-flight response from the PREVIOUS task" |
  | 18 | Whole-file resync every 60th poll | `tested` | resilience — **verified to FAIL with `dueForResync` forced false** |
  | 19 | After a rejection the recovery poll carries `fromByte 0` AND a null fingerprint | `tested` | resilience: "after a REJECTED chunk" |
  | 20 | A failed poll leaves cursor + fingerprint intact | `tested` | resilience: "a failed poll leaves the cursor" |
  | 21 | `readChunk` returns the location it read from | `tested` | single-walk: equals `findByUuid`, and `location.sizeBytes === chunk.size` |
  | 22 | A passed location costs ZERO readdir calls | `tested` | single-walk: "performs ZERO readdir calls" |
  | 23 | Chunk byte-identical with and without a passed location | `tested` | single-walk: "byte-identical … with and without" |
  | 24 | A passed location does not re-classify read-ENOENT as fatal | `tested` | single-walk: rule-6 asymmetry case |
  | 25 | A stale location cannot truncate or throw | `tested` | single-walk: file grown after the walk (refutes gemini #3) |
  | 26 | `missing` / explicit `null` still walk | `tested` | single-walk: two cases |
  | 27 | A transcript poll walks ONCE (ok, missing, ×10) | `tested` | routes.single-walk — **red before the fix at 20 for 10** |
  | 28 | Persisted `lastJsonlSeenMtimeMs` = the file's real mtime | `tested` | routes.single-walk |
  | 29 | active→idle decay and active-stays-active preserved | `tested` | routes.single-walk, two cases |
  | 30 | Rotation still detected through the route (fingerprint stays fresh) | `tested` | routes.single-walk: shrink → `rotated` |
  | 31 | A mission-context poll walks ONCE | `tested` | callers-single-walk — **verified to FAIL without the pass-through** |
  | 32 | An inbox cold-path derive walks ONCE | `tested` | callers-single-walk — **verified to FAIL without the pass-through** |
  | 33 | The `session-watcher-debug` extraction is behaviour-identical | `tested` | session-watcher-debug: 8 cases (enable condition, all three strings byte-for-byte, the `,…` cap, silence when off) — it had ZERO coverage before the move |
  | 34 | Terminal-state stop / single-source model (F21, F22) unchanged | `tested` | `covered-by-existing-test` — `useTaskTranscript.test.ts` untouched and green |
  | 35 | The other `readChunk` consumers are unaffected | `tested` | `covered-by-existing-test` — full server suite green (253 files) incl. inbox + transcript route suites |
  | 36 | The pane's full-content re-parse cost after the change | `untestable` | `requires-manual-visual-judgment` would be wrong; the honest code is **`covered-by-existing-test`** for correctness — and for the *number*, it is measured (5.6 / 11.3 ms) but deliberately NOT asserted, because a wall-clock threshold in CI is a flake generator. Scoped out in "What this run does NOT fix" |
  | 37 | Cold-page-cache behaviour on a 131 MB transcript | `untestable` | `requires-external-nondeterministic-service` — the OS page cache cannot be evicted deterministically. The warm figure is the CONSERVATIVE one: a cold read strictly worsens the `fromByte: 0` column and leaves the cursor column flat |

- **Confidence-pattern check:**
  - **Asymptote (depth):** the headline was measured on the shipped path over
    real HTTP, not modelled — after a first probe that *was* modelled, which I
    replaced rather than defended. Depth paid twice more: the residual-parse
    probe cut the claimed win from 40× to 2.5× for streaming sessions, and the
    internal review's replacement probe found a permanent-divergence path that
    no assertion in the suite covered. Beyond that, further digging produced
    restatements, not decisions.
  - **Coverage (breadth):** both halves of the fold (replace / append / reject),
    both directions of the cursor's lifecycle (advance and every rewind), all
    four reset triggers, both concurrency shapes the reader can present
    (truncation and append mid-read), all three `readChunk` callers, and every
    mtime-reading branch of the route. The known gaps are stated in "What this
    run does NOT fix" rather than papered over, and the one safety property the
    cursor genuinely removes is bought back explicitly instead of being
    rationalised away.
  - **Integration composition:** `cross_component` is NOT set, and recomputing
    it from the diff agrees — no merge/churn resolver, no Claude-Code hook
    fan-out, no pipeline phase validator, no campaign drain. No
    `category:"integration"` behavior is owed. The nearest thing to a
    composition risk — that the three `readChunk` callers each still perform one
    walk — is covered by behaviors 27, 31 and 32 against the real watcher.

## External code review (openrouter: openai + gemini) — outcomes

### PLAN pass — 1 HIGH + 4 MEDIUM actioned, 2 refuted, before a line was written

- **HIGH — VALID, design changed.** (openai #1) The cursor protocol said nothing
  about response ordering. The poller *is* sequential and *does* guard on
  `cancelled`, so no duplicate could actually land today — but that made the
  safety a consequence of two unrelated invariants rather than a property of the
  cursor. Commit is now gated on the live cursor inside a synchronous
  check-and-advance, so a duplicate or out-of-order response is a no-op by
  construction. Tests added for both orderings and for a task switch mid-flight.
- **MEDIUM — VALID, fixed.** (openai #2) `extractModelName(delta) ?? previous`
  is wrong for `fromByte: 0` responses: after a rotation or task switch it would
  retain the old transcript's model when the new one has none — the exact leak
  AC-3 forbids. Replace responses now derive the model from that response alone.
- **MEDIUM — VALID, scoped + documented.** (openai #3) The `location` input
  changes a freshness contract, not just a walk count. Empirically the concern
  has no live consequence — the read re-stats, and no caller that passes a
  location uses the fingerprint for rotation — but the asymmetry is now stated
  at the call sites and pinned by a test instead of holding by luck.
- **MEDIUM — VALID, and the most useful finding.** (openai #4) The claim "cost
  is proportional to what just happened" was not established: the pane re-parses
  the full accumulated transcript on every non-empty delta. Measured (5.6 ms
  median / 11.3 ms p90), split the headline into idle vs. streaming, and moved
  the residual into "What this run does NOT fix".
- **MEDIUM — VALID, actioned.** (openai #5) Making `location` required on the
  `ok` variant breaks every `readChunk` test mock at compile time. That is the
  intended signal, but it is work: all mock sites are enumerated and updated
  rather than discovered during the build.
- **LOW — noted, no code change.** (openai #6) `JsonlLocation` stays
  constructible only inside the watcher; no route accepts one. Recorded as a
  constraint on future callers.
- **MEDIUM — REFUTED, and the suggested fix would have shipped a bug.**
  (gemini #2) Guarding the append with `prev.length === chunk.fromByte` compares
  UTF-16 code units against a byte offset. It passes on ASCII fixtures and
  corrupts any transcript containing a non-ASCII character. The cursor is
  carried as bytes for precisely this reason.
- **LOW — REFUTED empirically.** (gemini #3) A stale `location.sizeBytes` cannot
  truncate or throw: `readTailFromDisk` opens the path and runs its own `fstat`,
  so the read is bounded by what it observes and later bytes defer to the next
  poll. Pinned by a test rather than argued.

## Internal code review (subagent) — outcomes

The strongest pass of the three. It ran probes rather than reading, and the top
finding is a defect no test in the suite would have caught.

- **MEDIUM-1 — VALID, verified by probe, fixed.** The cursor silently gives up a
  safety property. Rotation fires only on a shrink, so a transcript replaced
  under the same uuid by a same-or-larger one is appended onto the wrong prefix
  and the pane diverges from disk *permanently* — where the old whole-file poll
  repaired it within a second. The reviewer reproduced it end to end against the
  real `SessionWatcher` (pane `AAAA\nBBBB\nXXXX\nWWWW\n` vs disk
  `ZZZZ\nYYYY\nXXXX\nWWWW\n`, still diverged three polls later). Fixed with
  `RESYNC_EVERY_POLLS`; the fix is pinned by a test verified to fail without it.
  Note the E2E rotation case rewrites to a *shorter* file — deliberately on the
  detectable side of the heuristic — so it could never have found this.
- **MEDIUM-2 — VALID, spec corrected.** The spec declared one behavior change
  and there were three; worse, the design check said "no visual delta" while a
  fix made earlier in this same run blanks the transcript pane on task switch.
  Both corrected above, the visual delta argued rather than buried.
- **MEDIUM-3 — VALID, arithmetic corrected.** "The duplicate walk … was 9 % of
  the problem, is then 80 % of what is left" quoted the figures for *both* walks
  while describing one. The duplicate alone is 4.5 % and 40 %. The sentence
  contradicted its own tail clause. This is the same class of overstatement the
  predecessor run was corrected for, caught one draft earlier this time.
- **LOW-4 — VALID, comment corrected.** The reject branch was documented as
  "unreachable"; the reviewer reached it by probe (a truncation between the
  reader's discovery and its read clamps `from` to the live size). The branch is
  load-bearing, and a comment calling it unreachable invites its deletion.
- **LOW-5 — VALID, documented.** `chunk.toByte` can exceed `chunk.size` (path
  stat vs open-handle fstat). Pre-existing, but newly load-bearing: the rotation
  check's `sizeBytes < fromByte` disjunct is what absorbs it. Noted at the site.
- **LOW-6 — VALID, fixed.** The E2E's `expect(cursors).toContain(0)` was vacuous
  — `cursors[0]` is always 0, so it passed whether or not the client rewound.
  Now `lastIndexOf(0) > 0`.
- **LOW-7 — VALID, fixed.** Collapsing `session-watcher.ts`'s header deleted
  provenance that survived nowhere else: the Plan D'' round-1 BLOCKER and PoC
  finding 4 (torn reads do not fire on NTFS at Claude's write rates — the
  measurement that makes the retry envelope insurance rather than a live need).
  Moved verbatim into `session-jsonl-io.ts` instead of lost. I had justified the
  collapse as removing duplication; part of it was not duplicated.
- **LOW-8 — VALID, both gaps closed.** Nothing pinned that a rejected chunk's
  recovery poll carries `fromByte: 0` *and* `expectFingerprint: null` (the
  fingerprint reset lives outside `accumulate`, so the fold test cannot reach
  it), nor that a failed poll leaves the cursor untouched. Two tests added.
- **Process note — actioned.** The reviewer caught an unstaged one-line mutation
  in the tree mid-pass (`fromByte: 0`, feature disabled) — my E2E falsification
  probe, since reverted. Re-verified clean before the commit; `git add -A` in
  that window would have shipped a no-op.

Checked and clean, with the checks named: every `readChunk` mock and
`TranscriptReadResult` construction in `server/src` (three, all accounted for,
despite `tsconfig` excluding test files); no caller can pair a passed `location`
with `expectFingerprint`; every mtime-reading branch of the route enumerated,
with `mtime === 0` load-bearing in exactly the one declared arm; no path where
`cursor` and `content` can move apart; the shared `EMPTY_BUFFER` cannot be
mutated in place; architecture rules 4/5/6/7 and DO-NOT #1 hold; the
`session-watcher-debug.ts` extraction byte-identical including the `,…` overflow
marker; and the idle-tick `useMemo` skip genuinely holds because
`prev.content + ""` is `===` by value.
