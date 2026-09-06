# iterate-2026-09-06-claim-lock-contract-explicit — brief (small complexity, no formal iterate spec)

## What this changes

leadwright published the FR-04.28 shared claim-record lock fixings
machine-readably at `schemas/claim-record-lock-contract.json`
(`contractVersion: 1`, `staleMs: 10000`, `realpath: true`,
`lockPathSuffix: ".lock"`). This repo has two lock call sites on files
leadwright also writes:

1. `server/src/external/org/decisions-lock.ts` (`decisions-proposed.md`) —
   already set `stale`/`realpath` explicitly, on purpose.
2. `server/src/index.ts` (`sdk-sessions.json`) —
   `lockfile.lock(p, { retries: 3 })`, agreeing with the contract only
   because `proper-lockfile`'s own defaults happen to equal it. A library
   version bump changing either default would silently desync the two
   repos on a file they both write.

## Done means

(a) Both call sites state the contract's `stale`/`realpath` values
    explicitly, from one shared module (`server/src/core/claim-record-lock.ts`),
    so neither can drift from the other.
(b) A test asserts both call sites against the PUBLISHED contract values —
    read from a vendored copy of the JSON, never retyped numbers.
(c) The contract is vendored at
    `server/src/vendor/leadwright/claim-record-lock-contract.json` (no
    cross-repo build/runtime dependency); a human re-copies it when
    leadwright bumps `contractVersion` — a pinned test catches a silent
    version drift.
(d) The `.lock` marker fixing is checked as the contract states it: neither
    side sets `lockfilePath`; the marker derives from the canonical target
    path.
(e) `realpath: true` gets a real proof on `sdk-sessions.json` via a FILE
    symlink (not a directory junction — a junction was shown to be
    transparent to proper-lockfile even without `realpath: true`, so it
    would prove nothing). Gated on this host being able to create a file
    symlink without elevation (self-explaining skip otherwise); real on CI
    (ubuntu-latest).

## Explicitly out of scope

No lock TIMING or retry-policy change beyond making the contract's values
explicit. No change to the beat lock (leadwright-only, deliberately 5
minutes, different file). No new npm dependency. No build-time dependency
between the two repositories — the vendored JSON is the entire coupling.
