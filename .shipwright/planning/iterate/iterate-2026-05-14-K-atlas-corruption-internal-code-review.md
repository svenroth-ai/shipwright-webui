# Iterate K — Internal code review (retrospective)

- **Reviewed**: PR #14 merged as merge commit `3b8bc0d` on 2026-05-14
- **Reviewer**: Claude Opus 4.7 (retrospective audit, 2026-05-15)
- **Reviewer hat**: senior dev playing "what would I flag in PR review"
- **Status**: SHIPPED — review captured for audit/learning, not gating

## Scope

12 commits on `iterate/codex-rescue-altscreen-rendering` covering v1–v9 of the xterm.js 6.0 WebGL atlas-corruption workaround + server-side SGR-encoding re-emit + Vite WS-proxy hardening + D-e2e task-type matrix cherry-pick.

## Findings

### Finding K-1 — Cross-effect ref pattern is reasonable but unusual

- **Severity**: low
- **File**: `client/src/components/terminal/EmbeddedTerminal.tsx`
- **Lines**: ~229 (`safeAtlasMaintenanceRef` declaration), ~935 (assignment), ~1029 (cleanup)
- **Finding**: v9 introduces a `useRef<(() => void) | null>(null)` to bridge the mount-effect's `safeAtlasMaintenance` closure into the auto-launch effect. Functional but adds across-effect coupling.
- **Alternative considered**: define `safeAtlasMaintenance` at component scope, depend on it from both effects via useCallback + state. Rejected because of (a) churn on every re-render and (b) safeAtlasMaintenance needs access to closure variables (`webglRef`, `term`) that only exist inside the mount-effect.
- **Verdict**: ACCEPT — ref bridge is documented inline, lifecycle (set in mount → null in cleanup) is clear, optional chaining at call sites handles null safely.

### Finding K-2 — `?atlasMaintenance=off` kill switch is mount-only

- **Severity**: low (by design)
- **File**: `client/src/components/terminal/EmbeddedTerminal.tsx`
- **Lines**: ~865 (URL param read)
- **Finding**: Reads `window.location.search` once at mount; not reactive to URL changes during session. If user changes the param mid-session, takes effect only on next mount.
- **Verdict**: ACCEPT — explicitly a debug/UAT escape hatch. The "mount the page fresh with the param" workflow is the documented usage. Reactive read would add complexity for zero practical gain.

### Finding K-3 — v9 post-launch-settle is unconditional

- **Severity**: low
- **File**: `client/src/components/terminal/EmbeddedTerminal.tsx`
- **Lines**: in auto-launch effect, ~line 530-560 (setTimeout 4 s after consumeLaunch)
- **Finding**: Fires `safeAtlasMaintenanceRef.current?.()` after 4 s regardless of `writesSinceLastClear`. Adds one extra mid-clear flash per launch even on a launch that doesn't actually need atlas cleanup.
- **Justification provided in commit message**: "Resume guarantees writes will happen; gating would just hide bugs. The maintenance call is idempotent anyway (clearTextureAtlas + refresh on a clean atlas is a no-op)."
- **Verdict**: ACCEPT — empirically the workaround flicker is documented as ~6 per minute; +1 per launch is negligible.

### Finding K-4 — DOM wheel listener uses bubble phase

- **Severity**: low
- **File**: `client/src/components/terminal/EmbeddedTerminal.tsx`
- **Lines**: ~975 (`container.addEventListener("wheel", onWheel, { passive: true })`)
- **Finding**: If a future xterm.js internal handler called `event.stopPropagation()` on wheel, our bubble-phase listener would not fire. Tabby uses the same pattern; xterm.js 6.0 does NOT stopPropagation on wheel, so this is safe today.
- **Mitigation**: ADR-099 documents this as part of the v8 design decision. Falsifiability path covers it.
- **Verdict**: ACCEPT — bubble phase matches the reference implementation; capture phase would fight xterm's internal scroll handling.

### Finding K-5 — Visual smearing reduction not empirically reproduced in this session

- **Severity**: medium (process, not code)
- **Files**: `client/e2e/probe-iterate-k-smearing-{ab,video}.mjs`
- **Finding**: Two probe scripts validated control-flow + pixel-level changes between OFF/ON variants, but could NOT visually reproduce the smearing bug with synthetic pwsh `[Console]::Write` 256-color stress. The visual smearing-reduction claim rests on the chronological user-UAT history captured in per-commit messages, not on a positive empirical demonstration in this session.
- **Honest assessment in ADR-099**: "What the empirical attempt did NOT validate: Visible smearing reduction in synthetic stress (stills + video) could not be reproduced."
- **Verdict**: ACCEPT WITH CAVEAT — the workaround is grounded in a real upstream bug (`xtermjs/xterm.js#5847`), validated by VS Code's `forceRedraw` + Tabby's wheel listener as reference patterns. The probe scripts shipped as permanent regression infrastructure for future post-merge UAT cycles. Falsifiability path is explicit.

### Finding K-6 — Server-side `?1006h` re-emit unconditional

- **Severity**: low
- **File**: `server/src/terminal/replay-snapshot.ts` (commit `814620c`)
- **Finding**: The replay-snapshot envelope re-emits `\x1b[?1006h` at the end of the serialized payload unconditionally. Wastes ~5 bytes if mouse mode was never enabled, but always-correct.
- **Verdict**: ACCEPT — conservative + cheap.

## Test coverage assessment

| Surface | Coverage | Verdict |
|---|---|---|
| EmbeddedTerminal unit tests (40) | Mount/dispose lifecycle, ResizeObserver, paste handlers, ready state | ADEQUATE for the public component contract; no test exercises the safeAtlasMaintenance call path directly (relies on integration via probes) |
| Scenarios probe (probe-iterate-k-scenarios.mjs) | 10 scenarios × 3 live tasks: 17 176 maintenance events captured, `altClears == 0` invariant validated | STRONG for control flow |
| Smearing A/B probe (stills) | Matched-pair SHA-256 hashes, kill switch validated | STRONG for plumbing, WEAK for visual outcome |
| Smearing A/B probe (video) | Same as above with `recordVideo` for transient artifacts | STRONG for plumbing, WEAK for visual outcome |
| Server tests | No new server tests; SGR re-emit covered transitively by existing replay-snapshot fixtures | THIN — could benefit from a unit test asserting `?1006h` presence in envelope output |

## Recommendations (none blocking)

1. Add a server-side unit test asserting `replay_snapshot` envelope contains `?1006h` re-emit on a mouse-tracking-enabled mirror state. Low priority — existing fixtures exercise the path indirectly.
2. Consider extracting `safeAtlasMaintenance` to a hook (`useAtlasMaintenance(termRef, webglRef, options)`) in a future iterate when the EmbeddedTerminal file size pressure becomes a concern (~1200 LOC currently). Not blocking.

## Overall verdict

**SHIP-AS-MERGED**. The diff is well-documented, addresses two real upstream bugs, ships with permanent regression infrastructure (kill switch + 3 probe scripts), and has an honest falsifiability path. The empirical-validation gap is acknowledged in ADR-099 § "Empirical-validation-attempt block" and does not block merge.
