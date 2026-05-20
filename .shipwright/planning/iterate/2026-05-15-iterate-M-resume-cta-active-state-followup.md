# Iterate M — Resume CTA active-state followup + ADR-099 v10 (post-replay maintenance)

- **Run ID:** iterate-2026-05-15-M-resume-cta-active-state-followup
- **Branch:** `iterate/post-merge-resume-gate-and-replay-smear` (PR #16, awaiting UAT)
- **ADR:** [ADR-099](../../agent_docs/decision_log.md#adr-099) (v10 row added) — Iterate M itself has no dedicated ADR; documented here as a focused follow-up to Iterate L (resume-cta-active-state) which was empirically falsified by ADR-098.
- **Status:** Spec written PROSPECTIVELY relative to the v10 / Iterate M commit (`28daae1`); empirical evidence (live curl output, two UAT quotes) was collected pre-commit and is preserved verbatim in the commit message + PR body.

## Problem

Two distinct bugs reported by Sven 2026-05-14 against a fresh task created in a fresh project:

### Bug 1 — Resume CTA appears too early on TaskBoard return

> "Resume kommt zu schnell. Das Terminal ist noch da und der Resume Knopf kommt in der ersten Sekunde wenn man zurück zum Board geht. aber alles ist noch gut. Kein Powershell, kein idle nichts. der kommt zu früh."

**Root cause**: ADR-098 (Iterate J, merged earlier today 2026-05-14) restored `CLAUDE_CODE_NO_FLICKER=1` as default-on, which makes Claude render in MAIN buffer rather than alt-screen. **Iterate L's** TaskCard + TaskDetailHeader gate `task.altScreenActive !== true` therefore ALWAYS passes during active Claude streaming. The "Claude foreground ⇔ alt-screen" assumption was falsified without anyone noticing because the Iterate L UAT loop (April) ran when NO_FLICKER was opt-in.

**Empirical evidence** (live curl against the user's task at UAT time):
```json
{
  "state": "active",
  "liveSession": true,
  "altScreenActive": false,    ← stays false the whole time
  "firstJsonlObservedAt": "2026-05-14T21:44:47.554Z"
}
```

### Bug 2 — Re-mount after navigate-back triggers heavy flickering + left smearing

> "Claude fängt an zu arbeiten und streamen. kein flickering, kein Smearing. Dann gehe ich aus dem task raus ins board und sofort wieder zurück. Extremes flickern und auch starkes verschmieren links."

**Root cause**: the `replay_snapshot` write in `EmbeddedTerminal.tsx onReplaySnapshot` callback is a large chunk (typically 50–200 KiB of cell-state on long sessions); v6's burst-trigger fires ONCE at the start of `term.write(data)` (because `lastWriteTime` was pre-initialized to before-quiet-window per v7), but the REST of the snapshot — plus immediately-following live-pty bytes — accumulates fresh atlas corruption with no further maintenance until v7's post-mount-settle at +3 s or the 10 s periodic interval.

## Approach

### Iterate M (Bug 1)

New compound signal **`isPtyForegroundActive(task, now=Date.now())`**:
```
liveSession === true
  && firstJsonlObservedAt
  && lastPtyDataAt != null
  && (now - lastPtyDataAt) < 15_000
```

True while some foreground process (Claude in main-buffer, vim, htop, interactive script, …) is plausibly engaged in EITHER buffer mode; false after 15 s of silence (covers Claude-exited-bare-shell recovery).

Matrix:
```
(idle | active) + altScreenActive=true OR ptyForegroundActive(task)
                                              → no CTA (in use)
(idle | active) + neither                     → Resume
```

Server-side: new `lastPtyDataAt: number | null` field on `PtyEntry`, bumped on every `pty.onData` chunk. Exposed via new `PtyManager.getLastPtyDataAt(taskId)` accessor → `withLiveSession()` augmentation → `/api/external/tasks` responses.

Client-side: `isPtyForegroundActive` helper exported from `TaskDetailHeader.tsx` (alongside `PTY_RECENT_ACTIVITY_MS = 15_000`), shared by `TaskCard.tsx` for symmetry. `ctaFor()` refactored to take the full task.

### ADR-099 v10 (Bug 2)

In `EmbeddedTerminal.tsx onReplaySnapshot` callback, right after `term.scrollToBottom()`:
```ts
setTimeout(() => safeAtlasMaintenanceRef.current?.(), 0);
```

The `setTimeout(0)` (microtask-after-browser-paint) deferral lets xterm finish committing the writes to the renderer BEFORE the atlas clear, eliminating the race that produced the "left smearing" pattern.

## Files

### Server (MODIFIED)
- `server/src/terminal/pty-manager.ts` (+~35 LOC)
  - `PtyEntry` field `lastPtyDataAt: number | null`
  - `pty.onData` bump
  - New `getLastPtyDataAt(taskId)` accessor
- `server/src/external/routes.ts` (+~30 LOC)
  - `ptyManager` interface field `getLastPtyDataAt?(taskId)` (optional for test back-compat)
  - `withLiveSession()` augmentation with `lastPtyDataAt: number | null`
- `server/src/terminal/pty-mirror-integration.test.ts` (+~95 LOC, 5 tests)
  - cold-pty null
  - first-chunk bump near-now
  - monotonic on subsequent chunks
  - null after kill
  - buffer-type-independent (alt + normal both bump)

### Client (MODIFIED)
- `client/src/lib/externalApi.ts` (+~25 LOC)
  - `ExternalTask.lastPtyDataAt?: number | null` field + doc-comment
- `client/src/components/external/TaskDetailHeader.tsx` (+~50 LOC)
  - Export `PTY_RECENT_ACTIVITY_MS = 15_000`
  - Export `isPtyForegroundActive(task, now)` helper
  - Refactor `ctaFor()` to take full task
- `client/src/components/external/TaskCard.tsx` (+~25 LOC)
  - Import `isPtyForegroundActive` from TaskDetailHeader
  - Update Resume button gate
- `client/src/components/terminal/EmbeddedTerminal.tsx` (+~25 LOC)
  - v10 `setTimeout(() => safeAtlasMaintenanceRef.current?.(), 0)` in `onReplaySnapshot` callback
- `client/src/components/external/TaskDetailHeader.test.tsx` (+~110 LOC, 9 tests)
  - Compound-gate matrix at header surface
  - Direct unit tests for `isPtyForegroundActive` helper (boundary, null branches, 15 s edge)
- `client/src/components/external/TaskCard.test.tsx` (+~80 LOC, 7 tests)
  - Compound-gate matrix at TaskCard surface

### Docs
- `CHANGELOG-unreleased.d/Fixed/iterate-M-resume-cta-active-state-followup_001.md` (NEW)
- `CHANGELOG-unreleased.d/Fixed/iterate-K-atlas-corruption-workaround_003.md` (NEW)

## Work breakdown (executed in-session)

1. **Diagnosis** (curl /api/external/tasks/<id> → altScreenActive=false confirmed; trace ADR-098 → Iterate L falsification)
2. **Branch** `iterate/post-merge-resume-gate-and-replay-smear` off main
3. **Server** PtyEntry field + onData bump + getLastPtyDataAt accessor
4. **Server** withLiveSession augmentation + interface field
5. **Client types** ExternalTask field
6. **Client** isPtyForegroundActive helper + ctaFor refactor
7. **Client** TaskCard gate update
8. **Client** v10 setTimeout in onReplaySnapshot
9. **Tests** server +5, client TaskCard +7, client TaskDetailHeader +9
10. **Verification** typecheck (both clean), vitest (client 834/834, server 972/972)
11. **CHANGELOG fragments** for Bug 1 + Bug 2
12. **Commit** `28daae1` + push + PR #16 (no auto-merge)

## Verification

- Client typecheck: clean
- Server typecheck: clean
- Client vitest: 834/834 pass (was 818; +16 new — all additive, no Iterate L regressions)
- Server vitest: 972/972 pass (was 966; +6 new — all additive)
- All pre-existing Iterate L tests backward-compatible

## Falsifiability

- Iterate M is falsified if `lastPtyDataAt` proves unreliable as a Claude-foreground proxy — e.g. a use-case emerges where the pty has data within 15 s but Claude is NOT the foreground (some background daemon writing). Default-on Resume CTA would then be a worse UX than the current "always show Resume during streaming" — escalate to JSONL-mtime polling or a Claude-specific signal.
- ADR-099 v10 is falsified if smearing is observed even with the v10 timer firing — would indicate the maintenance pass is happening but failing to repaint correctly, pointing back to xterm.js#5847 directly.

## Cross-references

- **Iterate L** (April 2026) — established `altScreenActive` as Claude-foreground proxy; falsified by ADR-098
- **ADR-098** (2026-05-13) — restored `CLAUDE_CODE_NO_FLICKER=1` default-on, the inadvertent falsifier of Iterate L
- **ADR-099 v1-v9** — Iterate K atlas-corruption workaround chronicle; v10 row appended in the same ADR for continuity
- **PR #14** (merged) — Iterate K v1-v9, kill switch + scenarios probe + A/B probes
- **PR #16** (open) — Iterate M + ADR-099 v10
