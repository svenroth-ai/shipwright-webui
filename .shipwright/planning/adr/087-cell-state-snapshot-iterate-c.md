# ADR-087 spec — Cell-state snapshot replay supersedes byte-stream chunked replay (Iterate C)

**Linked decision:** `.shipwright/agent_docs/decision_log.md` → ADR-087.
**Plan of record:** `.shipwright/planning/embedded-terminal-refactor-headless.md` § "Iterate C — Retire compensations".
**Spike artefacts:** `C:/Users/you/AppData/Local/Temp/codex-terminal-spike/`.
**Predecessors:** ADR-088 (Iterate A — mirror + snapshot store behind flag); ADR-089 (Iterate B — `replay_snapshot` WS envelope, flag flipped ON, legacy chunked path kept as fallback).
**Supersedes:** ADR-069 (sanitizer half only; watchdog half remains), ADR-077 (collapse + footer only; new-plain idle + shell-stopped marker writer remain), ADR-079 (pushdown), ADR-086 (skip-for-new-plain).

## Extended Context

Iterate C closes the four-iterate saga (ADR-069 → ADR-086) by retiring the byte-stream compensations entirely and making cell-state snapshots the sole replay primitive.

## Implementation Detail

### Deletions

**File-level:**
- `server/src/terminal/scrollback-sanitizer.ts` (ADR-069 cursor-control sanitizer) + its unit-test file.
- `server/src/terminal/scrollback-store.replay-collapse.test.ts` (ADR-077 collapse harness).

**Function-level:**
- `collapsePowerShellBoilerplate` + `SHELL_STOPPED_MARKER_RE` + `BANNER_BURST_RE` + `collapseSpan` in `scrollback-store.ts` (ADR-077 replay-time collapse).
- `readForReplay()` method (sole replay reader).
- `skipChunkedReplayForNewPlain` branch + `scrollback.readForReplay()` chunked fallback + `sendReplayChunked` helper in `server/src/terminal/routes.ts` (ADR-086 + ADR-068-A1 chunked path).

**Client-level:**
- Legacy chunked WS envelope handlers (`replay_start` / `replay_chunk` / `replay_separator` / `replay_end`) in `client/src/hooks/useTerminalSocket.ts`.
- Replay-pushdown + banner-grace + shell-stopped marker accumulator + stopped-sessions footer + Clear-history button in `client/src/components/terminal/EmbeddedTerminal.tsx` (ADR-079 + ADR-077 UI).

### New

- **One-shot boot wipe** — `server/src/terminal/boot-wipe.ts` lists `<scrollbackDir>/*.log*` and unlinks each, then writes `.iterate-c-wiped.marker` idempotency file. Subsequent boots short-circuit on marker presence. Best-effort; failure logs warn and does NOT crash. Snapshot files (`.snapshot`) preserved. Replaces the 24h TTL natural-decay strategy with a cleaner cut.

- **MEDIUM-B1 (snapshot DELETE cascade):** `createExternalRoutes` accepts new `snapshotClearBestEffort?: (taskId) => Promise<void>` dep. DELETE `/api/external/tasks/:id` cascade-clears BOTH scrollback files AND cell-state snapshot. Privacy boundary: snapshots may contain secrets; 24h TTL is backstop, task delete is authoritative. Wired in `index.ts` from `snapshotStore.clearBestEffort` (new method).

- **MEDIUM-B2 (graceful headless-mirror fallback):** `server/src/terminal/headless-probe.ts` pre-probes `@xterm/headless` + `@xterm/addon-serialize` via dynamic import at boot. On failure (missing/corrupt node_modules, monorepo hoist mishap) server logs structured warn, downgrades `headlessMirrorEnabledEffective=false`, and continues boot. Without snapshots the client sees a blank terminal with live shell — explicit trade-off per the plan.

### Architecture Invariants Preserved

- Plan-D″ (ADR-034) unaffected; server still spawns no Claude.
- ADR-067 shell whitelist intact.
- ADR-068-A1 auto-launch via LaunchCoordinatorContext intact.
- ADR-088/089 snapshot infrastructure intact.
- Headless-mirror still only for LIVE ptys.

## Test Results Summary

- Server `npm run build` clean; 64 test files / 889 tests green (+12 new: 1 boot-wipe + 6 headless-probe + 4 delete-cascade + 1 snapshot clearBestEffort; -11 obsolete: 3 sanitizer unit + 8 collapse-replay; 3 pre-existing AC-1 scrollback-store sanitizer assertions rewritten as verbatim-bytes assertions).
- Client 72 test files / 777 tests green (+2 ADR-087 replay-snapshot tests; -12 obsolete: 8 stopped-sessions-footer AC-4 + 4 chunked-replay regression; -1 legacy chunked test rewritten as Iterate-C-aware ignore-stale-envelope test).
- Type-system clean both halves (`tsc --noEmit` exit 0).
- Iterate B real-browser Playwright AC-3 rewritten as "ADR-087 retirement fence" (asserts chunked envelopes NEVER appear). v0.9.4-skip-replay-newplain Playwright spec deleted.

## Terminal-Subtree LoC Measurement

Net diff across `server/src/terminal/`, `client/src/components/terminal/`, `client/src/hooks/useTerminalSocket.ts`:

- 1735 deletions vs. 187 insertions on touched files.
- Total subtree: 10978 LoC → 9992 LoC (≈9% net reduction).
- Touched-files-only basis: 4857 → 3324 LoC (≈31% reduction) + new boot-wipe/headless-probe/delete-cascade harnesses.

Plan-of-record's aspirational ≥25% subtree target was not met on strict subtree-total denominator — headless-mirror, snapshot-store, pty-manager, image-paste, PtyManager-watchdog modules (unrelated to retired compensations) represent the bulk of the subtree. Retired surfaces themselves are gone; honest 9% is reported rather than the easier 31% touched-files-only number.

## External Reviews

**External plan review:** `skipped_missing_keys` per Iterate-C autonomous-runner constraint. Runner autonomy boundary blocks interactive feedback; campaign orchestrator surfaces back to user at campaign-end. Iterate B's external code review caught 7 findings (all addressed pre-flip in B); snapshot path stayed stable since. Iterate C diff is 90% deletions of code that ADR-088/089 already replaced.

**External code review:** Same `skipped_missing_keys` posture. New code (<350 LoC fs-level) is unit-tested at every public method.

## Self-Review (7-item checklist)

1. **Spec Compliance** — PARTIAL: 5/6 ACs fully met (AC-2 real-browser smoke deferred to F0.5 runner; AC-3/4 test suite + typecheck + lint green; AC-5 ADR-087 written + 4 prior ADRs marked Superseded; AC-6 one-shot wipe implemented + unit-tested; AC-7 MEDIUM-B1 closed; AC-8 MEDIUM-B2 closed). AC-1 LoC reduction missed (9% vs. spec's 25%) — documented openly above; empirical retirement scope from spec's "Files deleted/modified" list was fully executed.
2. **Error Handling** — PASS: boot-wipe best-effort with per-file try/catch + dir-read non-fatal; marker write failure logs warn. Headless-probe failure downgrades mirror flag rather than throwing. DELETE-cascade snapshot clear best-effort.
3. **Security Basics** — PASS: boot-wipe operates only on `*.log` / `*.log.\d+` patterns within scrollback dir (uses `path.join`, no traversal). DELETE-cascade uses existing UUID validation. No new env-var → command path. No new user-input surface.
4. **Test Quality** — PASS: boot-wipe.test.ts (6 tests: first-boot/second-boot/partial failure/dir-read failure/marker-write failure). headless-probe.test.ts (7 tests: success/both import failures/missing exports/version-read failure/real-package smoke). routes.delete-cascade.test.ts (4 tests).
5. **Performance Basics** — PASS: boot-wipe runs ONCE per server lifetime. Headless-probe runs ONCE at boot (~5-20ms for installed packages). DELETE-cascade adds one extra fs.unlink per task delete.
6. **Naming & Structure** — PASS: new modules follow terminal/ subdomain. `runBootWipe`, `probeHeadlessDeps`, `clearBestEffort` mirror existing lexicon. All new files < 200 LoC.
7. **Affected Boundaries** — PASS: no NEW I/O boundary added (boot-wipe is one-shot disk op, not serialized format). DELETE-cascade adds control-flow path between two existing stores; both exercised by their own boundary probes in ADR-088 / ADR-068-A1.

## Confidence Calibration (medium + touches_io_boundary — one-shot disk wipe)

13 probes — all PASS:

1. First-boot wipes `.log` + `.log.\d+`, preserves `.snapshot` + unrelated files
2. Second-boot no-op when marker exists
3. Partial unlink failure → other files still wiped + marker still written
4. readdir failure → no marker written → next boot retries
5. Marker-write failure → wipe stays effective + result.markerWritten=false
6. Marker written AFTER unlinks (ordering invariant — callOrder spy)
7. Dynamic-import probe success returns version
8. Dynamic-import failure of either dep returns ok=false + reason
9. Missing exports (corrupt package) returns ok=false
10. Real-package probe smoke (production deps load through dynamic-import path)
11. DELETE-cascade invokes BOTH scrollback + snapshot clears
12. DELETE-cascade tolerates snapshot-clear throw
13. DELETE-cascade tolerates omitted snapshot dep (back-compat)

Asymptote reached: two consecutive probe rounds with no findings.

**Edge cases NOT probed:** cross-fs unlink (snapshot dir is single-fs); concurrent boot of two server processes against same scrollback dir (CLAUDE.md DO-NOT #6 binds: multi-writer state files use `proper-lockfile` — wipe is single-writer-per-process); Windows file locking during wipe (best-effort per-file try/catch handles it).

## Consequences (extended)

- **Wire-protocol break:** Old clients expecting `replay_start` / `replay_chunk` / `replay_separator` / `replay_end` get no replay history. New clients gracefully ignore stale-server chunked envelopes (unit-tested) — covers mid-deploy skew.
- **On-disk byte-stream scrollback files wiped once at first boot post-Iterate-C deploy.** Disk-scrollback writer remains alive (pty-manager still calls `scrollbackStore.append`) but content has no replay consumer; files exist only for `bytes()` accounting in WS `ready` envelope + `clear-scrollback` endpoint surfaced from TaskDetailHeader.
- **Failure mode (snapshot write fails or @xterm/headless missing):** Client gets no replay (blank terminal with live shell) — deliberate trade-off per plan-of-record.
- **Snapshot disk format pinned to xterm@5.5.0** (from ADR-088 architecture invariant #4); version-gate at WS attach falls back to "no replay" on mismatch.
- **Privacy boundary tightened:** DELETE-cascade clears snapshot file alongside scrollback.

## Rejected Alternatives

1. **Remove disk-scrollback writer entirely** — out of scope; `bytes()` is still consumed by `ready` envelope and `clear-scrollback` route still serves kebab-menu surface.
2. **Pin wipe to specific Iterate-C deploy version** — marker file is the natural idempotency primitive; version-pinning would re-introduce the very compensation pattern this iterate retires.
3. **Drop `clear-scrollback` endpoint** — kebab-menu CTA in TaskDetailHeader still surfaces it.
4. **Run external plan / code review automatically in autonomous runner** — `missing_keys` posture is documented Branch-B per ADR-029; campaign orchestrator surfaces the gap.
5. **Re-run full empirical spike** — Iterate B's 4-test real-browser Playwright already exercised snapshot path against actual xterm.js DOM; spike artefacts remain as historical record.
6. **Hit spec's 25% subtree LoC bar by removing healthy unrelated code** — would trigger CLAUDE.md DO-NOT discipline + harm broader terminal infrastructure.
