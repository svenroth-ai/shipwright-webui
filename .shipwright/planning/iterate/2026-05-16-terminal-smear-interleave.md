# Iterate Spec: terminal-smear-interleave

- **Run ID:** iterate-20260516-terminal-smear-interleave
- **Type:** bug
- **Complexity:** medium
- **Status:** implemented

## Goal

Fix Bug B — the embedded-terminal left-column glyph-fragment smear (`Wa`/`Di`/`┌`
prefixes). Root cause (empirically confirmed): a client-side replay/live-data
interleave race — on WS attach, the server emits `replay_snapshot` then
immediately flushes buffered live `data`; the client writes the snapshot
asynchronously (`term.write(data, cb)`) while the live `data` handler writes
incoming chunks unconditionally → concurrent writes corrupt the xterm buffer.
The renderer was empirically ruled out (WebGL + DOM both smear, Canvas
incompatible); the on-disk snapshot bytes were verified clean.

## Acceptance Criteria

- [x] AC-1: While a `replay_snapshot` `term.write` is in flight, incoming WS
  `data` envelopes are NOT written to xterm directly — they are queued. (Unit:
  dispatch `replay_snapshot`, then a `data` envelope before flushing the write
  completion → `writeSpy` called with the snapshot payload, NOT with the live
  `data` payload.)
- [x] AC-2: After the snapshot `term.write` completion callback fires, the
  queued `data` chunks are drained to `term.write` in arrival order, after the
  snapshot. (Unit: queue 2 chunks mid-flight, flush completion → both written,
  in order.)
- [x] AC-3: The gate never deadlocks AND never releases via a concurrent write.
  All release/degrade paths are deterministic: (a) `term.write(snapshot)` throws
  synchronously → catch releases the gate + clears the queue; (b) the component
  disposes before the completion callback → queue dropped, gate released;
  (c) the snapshot callback never fires within `REPLAY_DRAIN_TIMEOUT_MS` → the
  watchdog force-releases via a single concatenated drain (still single-threaded);
  (d) the queue exceeds `REPLAY_DRAIN_MAX_BYTES` → oldest chunks are dropped to
  stay under the cap while the gate stays CLOSED — never a force-drain mid-flight.
  After any release a subsequent `data` envelope writes straight through.
- [x] AC-4: When no replay is in flight, `data` envelopes write straight to
  `term.write` (no regression to the normal live path).
- [x] AC-5: A new `replay_snapshot` arriving while a prior drain/gate is still
  open re-arms the gate cleanly: the prior generation's queued live data is
  dropped (a fresh snapshot is authoritative — superseded data must not be
  drained into the new buffer), the prior generation's pending completion
  callback + watchdog become no-ops via a generation token, and `data` chunks
  arriving after the new snapshot queue against the new generation in arrival
  order.
- [x] AC-6: The ADR-099 WebGL atlas-maintenance machinery is deleted;
  `npm run build` (tsc + vite) and the full client test suite stay green;
  production still renders via WebGL (renderer behaviour unchanged).
- [x] AC-7: (DONE 2026-05-16 — iterate checkpoint) The renderer-bisect probe
  scaffolding was reverted (`git restore` of `EmbeddedTerminal.tsx`,
  `EmbeddedTerminal.test.tsx`, `vite.config.ts`, `package.json`,
  `package-lock.json`) and `terminal-bisect/` deleted BEFORE the iterate branch
  was cut. The branch starts from clean `main`. No probe-removal work remains
  in the build — only the drain gate (AC-1..AC-5) + the ADR-099 deletion (AC-6).

## Affected FRs

- Embedded-terminal surface (ADR-067 / ADR-087 / ADR-092 replay path). The
  project spec is not wrong — the smear is an implementation defect, not a spec
  error — so no FR acceptance-criteria rewrite (BUG path Step 2: skip).

## Out of Scope

- The Resume-CTA misfire (`resumeCtaGate.ts` JSONL-mtime gate) — separate iterate.
- The streaming flicker — re-observe after this iterate; the ADR-099 removal is
  the likely flicker fix but the flicker root cause is unconfirmed. Do NOT patch
  it speculatively here.
- Any server-side change. The server `routes.ts` flush-after-snapshot ordering
  is left as-is; the fix is purely client-side (the snapshot bytes are clean).

## Design Notes

n/a — no UI mockup change. The fix is a non-visual client-side write-ordering
gate; the only visible effect is the *absence* of the smear.

## Affected Boundaries

The WS envelope sequence `replay_snapshot` → buffered `data` is a producer/
consumer boundary (producer `server/src/terminal/routes.ts`; consumer
`client/src/hooks/useTerminalSocket.ts` → `EmbeddedTerminal.tsx`
`onReplaySnapshot` / `onData`). The fix changes the consumer-side write
*ordering*, not the wire format. No file-IO boundary (`.env` / `*_config.json`
/ json.dump-load) is touched → `touches_io_boundary` does not fire. The
drain-order unit test (AC-1/AC-2) is the equivalent round-trip probe.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| server `routes.ts` WS emit | `EmbeddedTerminal onReplaySnapshot` / `onData` | WS JSON envelope (`replay_snapshot`, `data`) |

## Confidence Calibration

- **Boundaries touched:** the WS `replay_snapshot` → buffered `data` envelope
  sequence — consumer-side write *ordering* only (producer `server/routes.ts`
  unchanged, wire format unchanged). See "Affected Boundaries" above.
- **Empirical probes run** (real tests, executed — not a diff re-read):
  - AC-1 queue-during-flight: live `data` is absent from `writeSpy` until the
    snapshot completion flushes — PASS.
  - AC-2 drain-in-order: queued chunks emerge as ONE concatenated write,
    after the snapshot, in arrival order — PASS.
  - AC-3 synchronous-throw: `term.write` throws → gate released → next `data`
    writes straight through — PASS.
  - AC-3 dispose-before-callback: unmount drops the queue; the deferred
    callback is a safe no-op (no throw, no orphan write) — PASS.
  - AC-3 watchdog: completion callback never fires → watchdog drains +
    releases after `REPLAY_DRAIN_TIMEOUT_MS` — PASS.
  - AC-3 byte-cap overflow: queue >8 MiB → oldest chunks trimmed, newest
    survives, gate stays closed — PASS (synthetic ~4 MiB chunks).
  - AC-5 callback-after-watchdog: stale generation → no double drain — PASS.
  - AC-5 second-snapshot: new snapshot supersedes prior queued data — PASS.
  - AC-4 straight-through: no replay in flight → direct write — PASS.
  - Full client suite (892 tests) + tsc + production build — all green.
  - F0.5: Playwright `v0-9-6-live-pty-replay.spec.ts` (ADR-092 guard) +
    drain-gate buffer-integrity E2E against the real stack.
- **Edge cases NOT probed + why acceptable:**
  - Real-xterm async parse cadence — the unit mock defers the completion
    callback deterministically; real async timing is covered by the F0.5
    Playwright run against actual xterm 6.x.
  - Byte-cap under real PTY chunk sizes (small, ~KB) — synthetic 4 MiB
    chunks force the trim path; real chunks would rarely fill the 8 MiB cap
    inside a sub-second snapshot write, so the synthetic probe is the
    conservative case.
- **Confidence-pattern check:** no "are you confident?"-style yes-then-bug
  fired in this run. The one HIGH defect (overflow handler re-creating the
  smear) was caught by the external plan review BEFORE build and fixed in
  the spec/mini-plan — not discovered post-implementation.

## Verification (medium+)

- **Surface:** web
- **Runner command:** `npm.cmd --prefix client run test -- run src/components/terminal/EmbeddedTerminal.test.tsx`
  for the unit gate; Playwright `client/e2e/flows/v0-9-6-live-pty-replay.spec.ts`
  (the ADR-092 regression guard) plus a drain-gate E2E against the dev stack.
- **Evidence path:** `client/playwright-report/` + the vitest run log.

## Risk flags

- `touches_build` — `client/package.json` (remove `@xterm/addon-canvas` +
  `overrides`) and `client/vite.config.ts` (remove the addon-canvas alias).
  Enforces the Performance Budget step.
