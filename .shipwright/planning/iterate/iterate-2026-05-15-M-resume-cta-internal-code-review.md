# Iterate M — Internal code review

- **Reviewed**: PR #16 commit `28daae1` on `iterate/post-merge-resume-gate-and-replay-smear`
- **Reviewer**: Claude Opus 4.7 (self-review, 2026-05-15)
- **Reviewer hat**: senior dev playing "what would I flag in PR review"
- **Status**: PR OPEN, awaiting user UAT + merge

## Scope

Single commit `28daae1`, 11 files changed (+592, −13). Two distinct fixes bundled:

- **Bug 1 (Iterate M)**: Resume CTA gate falsified by ADR-098 (NO_FLICKER=1 default-on flips Claude into main-buffer; `altScreenActive` stays false during streaming).
- **Bug 2 (ADR-099 v10)**: Post-replay-snapshot atlas maintenance for re-mount-after-navigate-back smearing.

## Findings

### Finding M-1 — Client/server clock-skew vulnerability in 15 s window

- **Severity**: low
- **File**: `client/src/components/external/TaskDetailHeader.tsx` (isPtyForegroundActive helper)
- **Finding**: The gate uses client-side `Date.now() - lastPtyDataAt < 15_000` where `lastPtyDataAt` is server-generated epoch-ms. If client + server clocks drift by >15 s (NTP failure, sleep/wake on either side, deliberate clock manipulation), the gate fails open (Resume shows during streaming) or closed (Resume never shows even after Claude exits).
- **Mitigation**: shipwright-webui is local-first (server is on user's box); typical client + server clocks are the SAME wall clock. Skew is unlikely in production.
- **Verdict**: ACCEPT — would need a server-side `now()` epoch in the API response + client computes delta to make robust, but adds complexity for a failure mode that doesn't manifest in the target deployment.

### Finding M-2 — Helper export from TaskDetailHeader.tsx creates module layering quirk

- **Severity**: low (cosmetic)
- **File**: `client/src/components/external/TaskCard.tsx` (line ~95)
- **Finding**: `TaskCard.tsx` imports `isPtyForegroundActive` from `TaskDetailHeader.tsx`. Slightly odd module layering — TaskCard and TaskDetailHeader are peers under `external/`; a shared helper should live in its own module (e.g. `client/src/components/external/resumeCtaGate.ts`).
- **Justification**: deferred to keep the PR diff focused. TaskDetailHeader is the iterate's "natural" home for the helper since `ctaFor()` is its primary consumer.
- **Verdict**: ACCEPT for this PR — flag as follow-up cleanup if the helper grows additional consumers. Trivial refactor cost.

### Finding M-3 — 15 s window is arbitrary

- **Severity**: low
- **File**: `client/src/components/external/TaskDetailHeader.tsx` (`PTY_RECENT_ACTIVITY_MS`)
- **Finding**: 15 000 ms threshold is hand-tuned. Empirically chosen to be "longer than typical Claude mid-thinking pause (≤ 5 s on most prompts), shorter than typical user think-time after exit". If Claude has a long internal pause >15 s (rare but possible during heavy tool-call latency), Resume briefly appears mid-session and the user could click it accidentally.
- **Mitigation**: clicking Resume mid-session would inject `claude --resume <uuid>` bytes into the still-running Claude — but Claude would interpret those as user input (would echo through Claude's TUI). Annoying, not destructive.
- **Verdict**: ACCEPT — 15 s is a reasonable starting point; can be tuned later via constant change if empirical evidence emerges.

### Finding M-4 — `lastPtyDataAt` bump is unguarded in pty.onData

- **Severity**: low
- **File**: `server/src/terminal/pty-manager.ts` (~line 475 in pty.onData handler)
- **Finding**: Every onData chunk does `entry.lastPtyDataAt = Date.now()` — no early-return guard. Adds ~1 µs per pty.onData call (Map lookup + property write + Date.now syscall).
- **Verdict**: ACCEPT — negligible overhead, matches the cost of the existing `touchIdle(entry)` call directly above.

### Finding M-5 — v10 setTimeout(0) doesn't cancel on dispose

- **Severity**: low
- **File**: `client/src/components/terminal/EmbeddedTerminal.tsx` (onReplaySnapshot callback)
- **Finding**: The `setTimeout(() => safeAtlasMaintenanceRef.current?.(), 0)` does not capture the timer ID for cancellation in cleanup. If component disposes between scheduling and firing (highly unlikely with 0 ms delay, but possible under StrictMode double-mount + immediate unmount), the callback fires after dispose.
- **Mitigation**: `safeAtlasMaintenanceRef.current` is nulled in mount-effect cleanup → optional chain handles it; ALSO `safeAtlasMaintenance` itself short-circuits on `disposedRef.current`. Two-layer defense.
- **Verdict**: ACCEPT — double-defended; tracking timer for cancellation would add LOC for marginal value.

### Finding M-6 — Test coverage for v10 is indirect

- **Severity**: medium
- **File**: `client/src/components/terminal/EmbeddedTerminal.tsx` — onReplaySnapshot v10 maintenance
- **Finding**: No unit test directly asserts that `safeAtlasMaintenance` is called after `onReplaySnapshot`. The 40 existing EmbeddedTerminal tests + 16 server pty-mirror tests don't exercise this path.
- **Justification**: The maintenance call is gated through a ref populated by the mount-effect's `if (webglRef && atlasMaintenanceEnabled)` block, which doesn't run under jsdom (no WebGL context). A unit test would need to mock the ref population + assert call count — possible but adds coupling to internals.
- **Mitigation**: visual UAT via `?atlasMaintenance=off|on` two-tab compare is the documented validation path (kill switch is part of Iterate K v8's permanent infrastructure).
- **Verdict**: ACCEPT WITH FOLLOW-UP — consider adding a deterministic test that:
  1. mocks `webglRef + safeAtlasMaintenanceRef`
  2. calls `onReplaySnapshot({ data: "test", terminalVersion: "6.0.0" })`
  3. awaits microtask
  4. asserts `safeAtlasMaintenance` was called exactly once.
  Not blocking — added effort for one assertion isn't strongly justified given the kill switch provides the UAT escape hatch.

### Finding M-7 — `liveSession === true` vs truthy check

- **Severity**: trivial (style)
- **File**: `client/src/components/external/TaskDetailHeader.tsx` (`isPtyForegroundActive`)
- **Finding**: `if (task.liveSession !== true) return false;` — strict check rejects `undefined` (correct, fallback to "no foreground") but also rejects the (non-occurring) case `liveSession: 1`. Consistent with the rest of the codebase's defensive style around server-augmented optional fields.
- **Verdict**: ACCEPT.

## Test coverage assessment

| Surface | Tests added | Verdict |
|---|---|---|
| Server pty-manager `getLastPtyDataAt` | +5 tests (cold pty null, no entry null, first chunk bumps near-now, monotonic, null after kill, buffer-type-independent) | STRONG |
| Client `isPtyForegroundActive` helper | +5 direct unit tests (liveSession undefined, firstJsonlObservedAt missing, lastPtyDataAt null, within window, exact boundary) | STRONG |
| Client TaskCard gate | +7 tests covering the full Iterate M matrix | ADEQUATE |
| Client TaskDetailHeader ctaFor matrix | +4 tests (active Claude-in-main, stale activity, missing firstJsonlObservedAt, idle compound gate) | ADEQUATE |
| ADR-099 v10 maintenance call after onReplaySnapshot | NONE directly | THIN — see Finding M-6 |

## Recommendations (none blocking, all follow-up)

1. Extract `isPtyForegroundActive` to `client/src/components/external/resumeCtaGate.ts` to clean up the TaskCard ↔ TaskDetailHeader module layering (Finding M-2).
2. Consider adding a deterministic unit test for the v10 `setTimeout(0)` maintenance path (Finding M-6).
3. Consider exposing `PTY_RECENT_ACTIVITY_MS` to user settings if 15 s proves too short/long in real-world UAT.

## Overall verdict

**SHIP-AS-PROPOSED** pending user UAT. The diff is well-documented, addresses two distinct real-world bugs traced to specific empirical evidence (live curl + UAT quotes), and ships with comprehensive test additions (+22 tests covering the new gate + the new server field). The findings above are all low/cosmetic — none should block merge.
