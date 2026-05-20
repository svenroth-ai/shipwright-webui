# Requirements Traceability Matrix

Generated: 2026-05-20T08:43:11Z

## Requirements Coverage

| Requirement | Title | Priority | Verified By | Tests | Last Verified | Status |
|-------------|-------|----------|-------------|-------|---------------|--------|
| [FR-01.01](../../.shipwright/planning/01-adopted/spec.md#fr-0101) | Landing page. Lists every registered task across all project... | Must | evt-8063cac5, evt-e8374408, evt-50e36386, evt-218c0d5d +2 | 632/632 → 2042/2042 | 2026-05-18 (iter) | COVERED |
| [FR-01.02](../../.shipwright/planning/01-adopted/spec.md#fr-0102) | Three-pane layout: left FolderTree of the project root (giti... | Must | evt-67fc7571, evt-3d7bab8e, evt-63a24776, evt-672b7ac9 +4 | 640/640 → 2062/2062 | 2026-05-18 (iter) | COVERED |
| [FR-01.03](../../.shipwright/planning/01-adopted/spec.md#fr-0103) | CRUD for the project registry persisted at `~/.shipwright-we... | Must | evt-0c3127ae, evt-33b2e81f | 786/786 → 0/0 | 2026-05-14 (build) | FAIL |
| [FR-01.04](../../.shipwright/planning/01-adopted/spec.md#fr-0104) | Best-effort surface for pending Claude tool_use blocks (nota... | Must | evt-7c294eb7 | 2062/2062 | 2026-05-18 (iter) | COVERED |
| [FR-01.05](../../.shipwright/planning/01-adopted/spec.md#fr-0105) | Read-only view of Claude CLI version, the resolved profiles ... | Must | — | — | — | NOT VERIFIED |
| [FR-01.06](../../.shipwright/planning/01-adopted/spec.md#fr-0106) | Minimal placeholder page. Most settings now live inside the ... | Must | — | — | — | NOT VERIFIED |
| [FR-01.07](../../.shipwright/planning/01-adopted/spec.md#fr-0107) | Liveness probe used by `dev_server.py`, smoke tests, and the... | Must | — | — | — | NOT VERIFIED |
| [FR-01.08](../../.shipwright/planning/01-adopted/spec.md#fr-0108) | GET returns every persisted task from `sdk-sessions.json` wi... | Must | evt-50e36386, evt-b1f24f66, evt-40acd669 | 1780/1780 → 2042/2042 | 2026-05-18 (iter) | FAIL |
| [FR-01.09](../../.shipwright/planning/01-adopted/spec.md#fr-0109) | GET returns the full task row with derived state. PATCH allo... | Must | evt-40acd669 | 2042/2042 | 2026-05-18 (iter) | COVERED |
| [FR-01.10](../../.shipwright/planning/01-adopted/spec.md#fr-0110) | Returns the three-shell copy-command (PowerShell / cmd.exe /... | Must | evt-672b7ac9, evt-634b8c4a, evt-c9e4d4b4, evt-40d7b72c +1 | 1269/1269 → 1780/1780 | 2026-05-14 (iter) | COVERED |
| [FR-01.11](../../.shipwright/planning/01-adopted/spec.md#fr-0111) | Same shape as launch but for `--resume` of an existing sessi... | Must | — | — | — | NOT VERIFIED |
| [FR-01.12](../../.shipwright/planning/01-adopted/spec.md#fr-0112) | Reads `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` as a U... | Must | — | — | — | NOT VERIFIED |
| [FR-01.13](../../.shipwright/planning/01-adopted/spec.md#fr-0113) | Walks every tracked task's JSONL via `inbox-derive.ts` and r... | Must | evt-7c294eb7 | 2062/2062 | 2026-05-18 (iter) | COVERED |
| [FR-01.14](../../.shipwright/planning/01-adopted/spec.md#fr-0114) | Adds the toolUseId to the dismissed set so subsequent inbox ... | Must | — | — | — | NOT VERIFIED |
| [FR-01.15](../../.shipwright/planning/01-adopted/spec.md#fr-0115) | Marks the task as completed in the registry without spawning... | Must | evt-0f78d991 | 857/857 | 2026-05-15 (iter) | COVERED |
| [FR-01.16](../../.shipwright/planning/01-adopted/spec.md#fr-0116) | Resolves the merged action catalog for a project: `<project>... | Must | evt-50e36386 | 1780/1780 | 2026-05-14 (iter) | COVERED |
| [FR-01.17](../../.shipwright/planning/01-adopted/spec.md#fr-0117) | Spawns the project's `dev_server.command` (from its stack pr... | Must | — | — | — | NOT VERIFIED |
| [FR-01.18](../../.shipwright/planning/01-adopted/spec.md#fr-0118) | Read-only forwarder for `<project.path>/shipwright_run_confi... | Must | — | — | — | NOT VERIFIED |
| [FR-01.19](../../.shipwright/planning/01-adopted/spec.md#fr-0119) | Lazy-expand listing for the FolderTree component. Honors git... | Must | — | — | — | NOT VERIFIED |
| [FR-01.20](../../.shipwright/planning/01-adopted/spec.md#fr-0120) | Reads a single file under the project root with the same rea... | Must | — | — | — | NOT VERIFIED |
| [FR-01.21](../../.shipwright/planning/01-adopted/spec.md#fr-0121) | One-shot: writes an empty (but schema-valid) `.webui/actions... | Must | — | — | — | NOT VERIFIED |
| [FR-01.22](../../.shipwright/planning/01-adopted/spec.md#fr-0122) | Returns CLI version (refreshed on demand), profiles dir, sam... | Must | — | — | — | NOT VERIFIED |
| [FR-01.23](../../.shipwright/planning/01-adopted/spec.md#fr-0123) | Lists every stack profile from the resolved profiles dir (ov... | Must | — | — | — | NOT VERIFIED |
| [FR-01.24](../../.shipwright/planning/01-adopted/spec.md#fr-0124) | GET lists all registered projects. POST creates a new one (v... | Must | evt-b81d5d5e | 537/537 | 2026-05-01 (iter) | COVERED |
| [FR-01.25](../../.shipwright/planning/01-adopted/spec.md#fr-0125) | GET returns the project row. PATCH updates name / profile / ... | Must | — | — | — | NOT VERIFIED |
| [FR-01.26](../../.shipwright/planning/01-adopted/spec.md#fr-0126) | GET returns the current settings JSON. PUT replaces it (lock... | Must | — | — | — | NOT VERIFIED |
| [FR-01.27](../../.shipwright/planning/01-adopted/spec.md#fr-0127) | Settings page lets the user pick a registered project, see i... | Must | — | — | — | NOT VERIFIED |
| [FR-01.28](../../.shipwright/planning/01-adopted/spec.md#fr-0128) | TaskDetail center pane renders a Toggle-Tab `Transcript / Te... | Must | evt-672b7ac9, evt-634b8c4a, evt-c9e4d4b4, evt-40d7b72c +14 | 1269/1269 → 970/970 | 2026-05-18 (iter) | FAIL |
| [FR-01.29](../../.shipwright/planning/01-adopted/spec.md#fr-0129) | DOM `paste` listener (capture phase) on the xterm container ... | Must | evt-672b7ac9, evt-634b8c4a, evt-c9e4d4b4, evt-fcfee60e +2 | 1269/1269 → 970/970 | 2026-05-18 (iter) | COVERED |
| [FR-01.30](../../.shipwright/planning/01-adopted/spec.md#fr-0130) | New top-level `/triage` route + sidebar entry surfacing `<pr... | Must | evt-2d58b346, evt-eba3538b | 0/0 → 855/855 | 2026-05-15 (iter) | FAIL |
| [FR-01.31](../../.shipwright/planning/01-adopted/spec.md#fr-0131) | The dev servers default-bind loopback for safety; non-loopba... | Should | evt-b021ddde, evt-a160f564, evt-909d149c, evt-5c8a15ea | 7/7 → 1586/1586 | 2026-05-10 (iter) | COVERED |
| [FR-01.32](../../.shipwright/planning/01-adopted/spec.md#fr-0132) | `POST /api/external/tasks/:id/backlog` flips an In-Progress ... | Must | evt-218c0d5d, evt-c5df348e | 1994/1994 → 1985/1985 | 2026-05-17 (iter) | COVERED |

## Verification Timeline

| Event | Source | Type | FRs | Tests | Commit | Date |
|-------|--------|------|-----|-------|--------|------|
| VS Code .code-workspace auto-generated on POST /api/projects | iterate | feature | FR-01.24 | 537/537 | 2dd51ef | 2026-05-01 |
| task-notification rendering | iterate | bug |  | 624/624 | 789c05b | 2026-05-01 |
| system chips alignment + scroll polish | iterate | change | FR-01.01 | 632/632 | 20f9684 | 2026-05-01 |
| system chips alignment + scroll polish (merge) | iterate | change | FR-01.01 | 632/632 | 4e3e8ec | 2026-05-01 |
| virtualizer flicker fix | iterate | bug |  | 632/632 | e8fd466 | 2026-05-01 |
| virtualizer flicker fix (merge) | iterate | bug |  | 632/632 | ace3423 | 2026-05-01 |
| overflow-anchor virtualized carve-out (scroll-up flicker root cause) | iterate | bug |  | 634/634 | fb2c6a9 | 2026-05-01 |
| useTaskTranscript polling cascade fix (residual scroll-up flicker) | iterate | bug |  | 635/635 | c8bcecd | 2026-05-01 |
| filter null-rendering events out of virtualized transcript (ADR-065; rapid-scroll partial fix; slow-scroll deferred to follow-up) | iterate | bug | FR-01.02 | 640/640 | 9946325 | 2026-05-02 |
| Persistent virtualizer measurement cache + cold-cache warmup pass (5th attempt at slow-scroll jump; ADR-066) | iterate | bug | FR-01.02 | 657/657 | 8628745 | 2026-05-02 |
| Persistent virtualizer measurement cache + cold-cache warmup pass (5th attempt at slow-scroll jump; ADR-066) — merge to main | iterate | bug | FR-01.02 | 657/657 | 75caacd | 2026-05-02 |
| Embedded terminal launcher (xterm.js + node-pty + WebSocket image-paste flow) — Plan-D''-conform shell pane in TaskDetail; replaces external-terminal-only launches; closes Anthropic claude-cli image-paste gap (Issue #51244); ADR-067. | iterate | feature | FR-01.02, FR-01.10, FR-01.28 +1 | 1269/1269 | b3c4aa2 | 2026-05-03 |
| Embedded terminal launcher (ADR-067) — Phase 6 post-code-review hardening: writer-conn idempotency (CRITICAL); /append-gitignore 404 ordering; /paste-image writer-gate; Origin gate; second-attach envelope; toast-error UX; browser-level paste-event E2E. 1273/1273 tests green. | iterate | feature | FR-01.02, FR-01.10, FR-01.28 +1 | 1273/1273 | 13eae28 | 2026-05-03 |
| Embedded terminal launcher (ADR-067) — Phase 6.1 fixes after second external code-review pass + live integration smoke. CRITICAL: ESM require bug broke every WS upgrade; Vite proxy missing ws:true; header CTA missing webui:launch-copied dispatch. Plus task.cwd realpath validation, paste-image auto-spawn, Content-Length missing/invalid handling, empty-text-paste path, paste-image error toast, browser-level paste E2E. 1273 unit + 12 Playwright tests green against real Chromium + Hono + xterm + node-pty. | iterate | feature | FR-01.02, FR-01.10, FR-01.28 +1 | 1285/1285 | 29f49fb | 2026-05-04 |
| Embedded-terminal auto-launch + disk-backed scrollback persistence (ADR-068-A1) — clipboard-free one-click Launch via LaunchCoordinatorContext + WS data-frame; pty.onData appends to <scrollbackDir>/<taskId>.log via fs.appendFileSync with 3-state rotation; replay-on-attach with pty.pause/resume + chunked envelopes; new POST /clear-scrollback + Stop terminal session + Clear history modal; privacy disclosure footer. | iterate | feature | FR-01.10, FR-01.28, FR-01.02 | 1320/1320 | ad391d5 | 2026-05-04 |
| Post-v0.8 stabilization (Tier 0): AC-1 scrollback ANSI sanitizer + AC-3 per-conn pause refcount + writer-stuck watchdog. AC-2 deferred to follow-up. ADR-069. 1369/1369 unit tests green. | iterate | bug |  | 1369/1369 | 1620245 | 2026-05-05 |
| v0.8.2 polish — Spec 74 modal flake (AC-1) + xterm dark theme for Claude TUI legibility (AC-2) + Ctrl+V parity (AC-3) + image-paste latency reduction (AC-4) + awaiting-launch diag logs (AC-5) + paste-dir migration to .shipwright-webui/pastes/ (AC-6) + replay-only mode for done/launch_failed tasks (AC-7) + conditional disclosure footer (AC-8) + retention copy interpolation (AC-9). 1398/1398 unit + 33/33 e2e green. ADR-070. | iterate | bug | FR-01.28, FR-01.29 | 1398/1398 | 4003ea0 | 2026-05-06 |
| v0.8.2 follow-up: disclosure null-handling fix, Show-ignored toggle rename, Spec 79 live-browser smoke (5 tests covering AC-2/4/7/8/9). 1399/1399 unit + 37/37 e2e green. | iterate | bug | FR-01.28, FR-01.29 | 1399/1399 | 7ad0168 | 2026-05-06 |
| VITE_HOST opt-in for LAN/Tailscale dev-server access | iterate | feature | FR-01.31 | 7/7 | b1e43d8 | 2026-05-07 |
| HONO_HOST opt-in: backend default-binds loopback, opt-in for non-loopback | iterate | feature | FR-01.31 | 8/8 | 8a13a67 | 2026-05-07 |
| HONO_HOST opt-in: backend default-binds loopback, opt-in for non-loopback | iterate | feature | FR-01.31 | 8/8 | 777ebbd | 2026-05-07 |
| v0.8.9 replay-pushdown: live shell at viewport top after replay-on-attach (FR-01.28 v0.8.9 AC-1) | iterate | bug | FR-01.28 | 1500/1500 | 2b54c35 | 2026-05-09 |
| tsc-baseline-fix: retire 4 documented tsc baseline errors (3x cross-package imports + missing @types/proper-lockfile). server npm run build exits 0; install-windows.ps1 step [3/4] runs clean. Type mirrors under server/src/types/ + comment-aware drift-guard test. ADR-080. | iterate | bug |  | 1508/1508 | d063ded | 2026-05-09 |
| network-profile-flag: SHIPWRIGHT_NETWORK_PROFILE env-flag (local|tailscale|open) unifies Vite + Hono dev-server bind. Tailscale auto-detect via subprocess + env override. Closes Vite-proxy gap when Hono binds non-loopback. ADR-081. | iterate | feature | FR-01.31 | 1586/1586 | f28befd | 2026-05-10 |
| env-local-loading-fix: tsx --env-file-if-exists for server + loadEnv with envDir for Vite. Closes ADR-081 wiring gap. ADR-082. | iterate | bug |  | 1606/1606 | c406414 | 2026-05-10 |
| v0.9.2 embedded terminal mount races: 1500ms readOnly banner grace + safeFit/disposedRef/_renderService dimensions stub (ADR-084) | iterate | bug | FR-01.28 | 1631/1631 | ca607e8 | 2026-05-11 |
| v0.9.3 resume state-machine: scope active→idle JSONL-mtime decay to non-new-plain (ADR-085) | iterate | bug | FR-01.28 | 1636/1636 | c937225 | 2026-05-11 |
| v0.9.4 skip disk-scrollback replay on attach for new-plain tasks (Claude TUI byte-stacking corruption fix; ADR-086) | iterate | bug | FR-01.28 | 1636/1636 | 312549c | 2026-05-11 |
| evt-f4f7c7c5 | iterate | Iterate F (headless-terminal-refactor campaign): xterm.js client config Vorbild-Alignment — convertEol+allowProposedApi+scrollback flips plus WebglAddon load with try/catch fallback (ADR-093). Follow-on to ADR-092 targeting in-session status-pane redraw stacking. |  | 777/777 | 87e1d55 | 2026-05-12 |
| dynamic-stack-profiles: wizard step 2 renders from /api/profiles + bundled snapshot refresh (ADR-094) | iterate | change | FR-01.03 | 786/786 | 01121c7 | 2026-05-12 |
| Iterate G — Claude TUI flicker env + Resume button gating (ADR-095) | iterate-G | fix |  | 1707/1707 | 76828b1 | 2026-05-13 |
| Iterate H — Snapshot preservation on pty death + TaskCard Resume gating (ADR-096) | iterate | bug |  | 1717/1717 | cf6a883 | 2026-05-13 |
| Restore CLAUDE_CODE_NO_FLICKER=1 default (ADR-098 - Iterate J) | iterate-runner | fix |  | 1720/1720 | 84c4045 | 2026-05-13 |
| leadwright Phase 1 ExternalTask extension (13 optional fields) | iterate | feature | FR-01.01, FR-01.08, FR-01.10 +1 | 1780/1780 | fc52b87 | 2026-05-14 |
| server-side ?1006h re-emit in replay-snapshot envelope (Iterate K) | iterate-K-retro | fix |  | — | 980c713 | 2026-05-14 |
| Iterate K v1: 30s periodic clearTextureAtlas + onScroll | iterate-K-retro | fix |  | — | 7fe9f41 | 2026-05-14 |
| Iterate K v2: 10s periodic + term.refresh() after clear | iterate-K-retro | fix |  | — | c3979f4 | 2026-05-14 |
| Iterate K v3: conditional via onWriteParsed counter (skip when idle) | iterate-K-retro | fix |  | — | d9a0d68 | 2026-05-14 |
| Iterate K v4: skip atlas-clear in alt-screen buffer | iterate-K-retro | fix |  | — | 1085998 | 2026-05-14 |
| Iterate K v5: split main = clear+refresh, alt = refresh-only | iterate-K-retro | fix |  | — | b31834b | 2026-05-14 |
| Iterate K v6: burst-after-2s-quiet trigger via onWriteParsed | iterate-K-retro | fix |  | — | 000b1b6 | 2026-05-14 |
| Iterate K Vite WS proxy: swallow ECONNRESET/ECONNABORTED/EPIPE | iterate-K-retro | fix |  | — | 95366da | 2026-05-14 |
| Iterate K cherry-pick: D-e2e task-type matrix | iterate-K-retro | test |  | — | 0c9e517 | 2026-05-14 |
| Iterate K v7: pre-init lastWriteTime + post-mount-settle backstop | iterate-K-retro | fix |  | — | a09d76f | 2026-05-14 |
| Iterate K v8: DOM wheel listener (Tabby pattern) + 10-scenario systematic Playwright probe | iterate-K-retro | fix |  | — | 1d5cc62 | 2026-05-14 |
| Iterate K: ?atlasMaintenance=off kill switch + A/B regression probes (stills + video) | iterate-K-retro | chore |  | — | d496a51 | 2026-05-14 |
| Iterate K v9: post-launch-settle backstop (4s after consumeLaunch) for Resume-click-in-long-mounted-tab | iterate-K-retro | fix |  | — | 005e099 | 2026-05-14 |
| Merge PR #14: Iterate K v1-v9 (xterm.js 6.0 atlas-corruption workaround) | iterate-K-merge-retro | merge |  | — | 7d9c52b | 2026-05-14 |
| Iterate M (Resume CTA active-state followup) + ADR-099 v10 (post-replay maintenance) | iterate-M-retro | fix |  | — | b62f73e | 2026-05-15 |
| Merge pull request #17 from svenroth-ai/iterate/triage-tab | backfill-merge-retro | merge |  | — | 4daae49 | 2026-05-15 |
| Merge pull request #16 from svenroth-ai/iterate/post-merge-resume-gate-and-replay-smear | backfill-merge-retro | merge |  | — | da81309 | 2026-05-15 |
| docs(readme): add Triage tab section (FR-01.30, ADR-101) | backfill-retro | docs |  | — | 34e9032 | 2026-05-15 |
| feat(triage): WebUI Triage Tab + Promote bridge (FR-01.30, ADR-101) | backfill-retro | feature | FR-01.30 | — | eb2fc99 | 2026-05-15 |
| Merge pull request #15 from svenroth-ai/iterate/lead-foundation-task-schema | backfill-merge-retro | merge |  | — | 5d6064f | 2026-05-14 |
| feat(wizard): render stack-profile step dynamically from /api/profiles | backfill-retro | feature | FR-01.03 | — | 920d2ca | 2026-05-14 |
| Merge pull request #13 from svenroth-ai/docs/launch-flow-and-tooltip-alignment | backfill-merge-retro | merge |  | — | e8d1c1c | 2026-05-14 |
| docs(changelog): add two unreleased drops for CLAUDE.md alignment + Structure drift fix | backfill-retro | docs |  | — | 2c2d7db | 2026-05-14 |
| docs(claude-md): align WHAT/Architecture rules to embedded-terminal auto-execute + close Structure drift | backfill-retro | docs |  | — | b2d484a | 2026-05-14 |
| docs(client): drop stale "nothing copies" from Save-to-Backlog tooltip | backfill-retro | docs |  | — | 5c5b3d8 | 2026-05-14 |
| docs(guide): align launch flow to embedded-terminal auto-execute | backfill-retro | docs |  | — | a24652e | 2026-05-14 |
| Merge pull request #12 from svenroth-ai/iterate/codex-rescue-altscreen-rendering | backfill-merge-retro | merge |  | — | e797148 | 2026-05-14 |
| fix(terminal): WebGL load-order + rescaleOverlappingGlyphs (ADR-099) | backfill-retro | fix |  | — | b0747d0 | 2026-05-14 |
| Merge pull request #11 from svenroth-ai/iterate/resume-cta-active-state | backfill-merge-retro | merge |  | — | dcded0b | 2026-05-14 |
| feat(server,client): introduce altScreenActive — hide Resume while TUI is foregrounded | backfill-retro | feature | FR-01.28 | — | 305c9b1 | 2026-05-14 |
| fix(server): refine new-plain Resume gate — emit --resume when JSONL exists | backfill-retro | fix |  | — | e5549a5 | 2026-05-14 |
| fix(client): drop liveSession gating — Resume CTA always shows on idle/active | backfill-retro | fix |  | — | c3f403f | 2026-05-14 |
| feat(client): surface Resume CTA on state=active when pty is gone | backfill-retro | feature | FR-01.28 | — | b9daf4e | 2026-05-14 |
| Merge iterate/headless-J-restore-no-flicker-default (ADR-098 — restore NO_FLICKER default after empirical Claude #37283 finding) | backfill-merge-retro | merge |  | — | bdf9d4d | 2026-05-13 |
| Merge iterate/refresh-newissue-tooltips — NewIssueModal copy aligned to auto-execute embedded-terminal flow (ADR-068-A1) | backfill-merge-retro | merge |  | — | 5d47ea3 | 2026-05-13 |
| refactor(client): refresh NewIssueModal copy to match auto-execute flow | backfill-retro | change | FR-01.08 | — | d5be03f | 2026-05-13 |
| Merge iterate/xterm-6-upgrade (ADR-097 — xterm.js 5.5.0 → 6.0.0; amends ADR-088 pin + ADR-095 NO_FLICKER default) | backfill-merge-retro | merge |  | — | dfc96c2 | 2026-05-13 |
| test(e2e): migrate readXtermRows helper from DOM-locator to buffer-peek | backfill-retro | test |  | — | f09b669 | 2026-05-13 |
| refactor(client,server): upgrade xterm.js 5.5.0 -> 6.0.0 (ADR-097) | backfill-retro | change | FR-01.28 | — | bb44972 | 2026-05-13 |
| Merge iterate/headless-H-snapshot-preservation-taskcard-gating (ADR-096 — finalizeMirrorSnapshot preservation heuristic + TaskCard Resume gating) | backfill-merge-retro | merge |  | — | 91ecf0e | 2026-05-13 |
| Merge iterate/headless-G-flicker-env-and-resume-gating (ADR-095 — Claude TUI flicker env + Resume button gating) | backfill-merge-retro | merge |  | — | 45898ed | 2026-05-13 |
| Merge iterate/headless-F-xterm-config-vorbild-align (ADR-093 — xterm.js Vorbild-Alignment for in-session status-pane stacking fix) | backfill-merge-retro | merge |  | — | 0b6198a | 2026-05-13 |
| Merge iterate/headless-E-live-pty-snapshot-fix (ADR-092 — closes ADR-091 live-pty replay regression) | backfill-merge-retro | merge |  | — | 90b81d3 | 2026-05-12 |
| docs(server,test): sweep stale disk-first comment + tighten cursor axis assertion (E code-review follow-up) | backfill-retro | docs |  | — | 0052184 | 2026-05-12 |
| fix(server): live-pty replay via serialize-on-attach + snapshot-on-detach (ADR-092) | backfill-retro | fix |  | — | 32ad3f4 | 2026-05-12 |
| fix(server): mark @xterm/headless fixture as binary; pin LF-normalized size | backfill-retro | fix |  | — | 508b90f | 2026-05-12 |
| Merge iterate/headless-C-retire-compensations (ADR-087 — campaign headless-terminal-refactor C; supersedes ADR-069/077/079/086) | backfill-merge-retro | merge |  | — | a01fb0f | 2026-05-12 |
| Merge iterate/headless-B-snapshot-protocol (ADR-089 — campaign headless-terminal-refactor B) | backfill-merge-retro | merge |  | — | 31b5136 | 2026-05-12 |
| Merge iterate/headless-A-mirror-flag (ADR-088 — campaign headless-terminal-refactor A) | backfill-merge-retro | merge |  | — | d069ca2 | 2026-05-12 |
| docs(terminal): sweep stale chunked-replay references post-ADR-087 (campaign code-review follow-up) | backfill-retro | docs |  | — | 29bf0ad | 2026-05-12 |
| refactor(terminal): retire ADR-069/077/079/086 compensations; snapshot-only replay (ADR-087) | backfill-retro | change | FR-01.28 | — | 96522c4 | 2026-05-12 |
| feat(server,client): replay_snapshot envelope + flag flip + snapshot-store hardening (ADR-089) | backfill-retro | feature | FR-01.28 | — | 2c83152 | 2026-05-11 |
| feat(server): wire @xterm/headless mirror behind feature flag (ADR-088 Iterate A) | backfill-retro | feature | FR-01.28 | — | ac028fb | 2026-05-11 |
| Merge iterate/v0.9.4-skip-replay-newplain (ADR-086) | backfill-merge-retro | merge |  | — | 904bb82 | 2026-05-11 |
| Merge iterate/v0.9.3-resume-state-machine (ADR-085) | backfill-merge-retro | merge |  | — | 6fa6c4a | 2026-05-11 |
| Merge branch 'main' of https://github.com/svenroth-ai/shipwright-webui | backfill-merge-retro | merge |  | — | 9e6a7b7 | 2026-05-11 |
| Merge iterate/v0.9.2-embedded-terminal-mount-races (ADR-084) | backfill-merge-retro | merge |  | — | 77a1aa3 | 2026-05-11 |
| Merge pull request #10 from svenroth-ai/chore/security-workflow-v4-and-private-repo-support | backfill-merge-retro | merge |  | — | 3693a40 | 2026-05-11 |
| chore(security): sync security.yml from monorepo (codeql v4 + continue-on-error) | backfill-retro | chore |  | — | ea98b0f | 2026-05-11 |
| Merge pull request #9 from svenroth-ai/chore/scaffold-security-and-claude-review-workflows | backfill-merge-retro | merge |  | — | 33a410c | 2026-05-11 |
| chore(workflows): drop dormant security + claude-review workflows from monorepo templates | backfill-retro | chore |  | — | c2becc6 | 2026-05-11 |
| Merge iterate/v0.9.1-tailscale-ws-real-browser-fix | backfill-merge-retro | merge |  | — | c3340ab | 2026-05-11 |
| fix(server,test): wire boot-time Trusted-Origin policy into WS upgrade gate (ADR-083) | backfill-retro | fix |  | — | 7a11eaa | 2026-05-11 |
| Merge pull request #8 from svenroth-ai/fix/cli-compat-cross-platform-path | backfill-merge-retro | merge |  | — | e37a18b | 2026-05-11 |
| fix(cli-compat): use platform-aware path module in selfHealClaudePath | backfill-retro | fix |  | — | 8ccd028 | 2026-05-11 |
| fix(server): wire SHIPWRIGHT_NETWORK_PROFILE into Trusted-Origin policy | backfill-retro | fix |  | — | 62104e2 | 2026-05-10 |
| fix(client): accept MagicDNS hostnames in Vite allowedHosts for tailscale profile | backfill-retro | fix |  | — | 76b66f5 | 2026-05-10 |
| docs(guide): document SHIPWRIGHT_NETWORK_PROFILE + .env.local workflow | backfill-retro | docs |  | — | e3857d7 | 2026-05-10 |
| triage-card-styling — white-surface cards + wizard-matched dialogs | iterate | change | FR-01.30 | 855/855 | 3653d6d | 2026-05-15 |
| close-task-redirect — Close task in TaskDetail header now redirects to the task board | iterate | bug | FR-01.15 | 857/857 | 0741a6c | 2026-05-15 |
| terminal-smear-reset — replay-snapshot remount smear fix (term.write callback) + WS reset banner | iterate | bug | FR-01-embedded-terminal | 1885/1885 | 038a616 | 2026-05-15 |
| evt-70d06e02 | iterate | change |  | — | 038a616 | 2026-05-15 |
| terminal-smear-interleave — replay drain gate eliminates the embedded-terminal reattach smear (Bug B); ADR-099 WebGL atlas machinery removed | iterate | bug |  | 892/892 | 0da4701 | 2026-05-16 |
| Remove Resume-CTA activity gate; one-shot inject guard; Copy Resume command; fix Copy session UUID | iterate | change | FR-01.28 | 1948/1948 | f606f54 | 2026-05-16 |
| Production build copies non-TS runtime assets into dist/ (fixes /actions HTTP 500) | iterate | bug |  | 1069/1069 | 6ce1a04 | 2026-05-16 |
| Remove orphaned Resume-CTA liveness-gate code (getLastPtyDataAt/isAltBufferActive/altScreenActive/lastPtyDataAt) — dead since PR #29; eliminates a flaky CI test | iterate | change |  | 1935/1935 | 94e9367 | 2026-05-17 |
| Resume guard survives a browser reload — ptyReused ready-envelope flag arms the one-shot inject guard on a reused pty | iterate | bug |  | 1939/1940 | 0e850b8 | 2026-05-17 |
| move-to-backlog — POST /api/external/tasks/:id/backlog + Move-to-Backlog menu items + draft-sticky transcript guard + Resume-vs-Launch fix | iterate | feature | FR-01.01, FR-01.32 | 1994/1994 | 8e6e1e5 | 2026-05-17 |
| move-to-backlog — POST /api/external/tasks/:id/backlog + Move-to-Backlog menu items + draft-sticky transcript guard + Resume-vs-Launch fix (rebased onto origin/main 2bb4157) | iterate | feature | FR-01.01, FR-01.32 | 1985/1985 | 3a15f77 | 2026-05-17 |
| edit-task-dialog: Edit Task dialog with lifecycle-gated field editability | iterate | feature | FR-01.01, FR-01.08, FR-01.09 | 2042/2042 | 43f2119 | 2026-05-18 |
| terminal cursor flicker on remount — restore DECTCEM (?25) cursor visibility in headless-mirror replay snapshots | iterate | bug |  | 2045/2045 | f2cfd7f | 2026-05-18 |
| terminal keyboard copy/paste with multi-line paste fidelity | iterate | feature | FR-01.28, FR-01.29 | 970/970 | 51261a0 | 2026-05-18 |
| fix launch command dropping the persisted task description on Resume / non-modal launches | iterate | bug |  | 1123/1123 | 7cce153 | 2026-05-18 |
| inbox-terminal-prompts: surface waiting terminal pickers + focus terminal on Inbox click | iterate | feature | FR-01.02, FR-01.04, FR-01.13 | 2062/2062 | 44c1914 | 2026-05-18 |
| fix --name double-quoting in bundled launch templates via the {task.session_name} placeholder | iterate | bug |  | 1152/1152 | 78759fe | 2026-05-18 |
| fix triage promote: carry item.detail into the promoted task description | iterate | bug |  | 1155/1155 | 484828c | 2026-05-19 |
| triage promote carries the brief into the launched run (actionId + newline flatten) | iterate | bug |  | 1156/1156 | 9855e3e | 2026-05-19 |
| Inbox card markdown rendering + fade-clip + spacing | iterate | change |  | 979/979 | ada1646 | 2026-05-19 |
| adopt oxlint as the project linter + env-isolate the server CORS test | iterate | change |  | 2135/2135 | 100e05f | 2026-05-19 |

## Coverage Summary

| Metric | Value |
|--------|-------|
| Total splits built | 0 |
| Build sections | 0 |
| Iterate changes | 53 |
| Requirements total | 32 |
| Requirements verified | 16/32 |
| Must-have verified | 15/31 |

### Not Verified

- [FR-01.05](../../.shipwright/planning/01-adopted/spec.md) (Must): Read-only view of Claude CLI version, the resolved profiles directory, the launc...
- [FR-01.06](../../.shipwright/planning/01-adopted/spec.md) (Must): Minimal placeholder page. Most settings now live inside the user's Claude client...
- [FR-01.07](../../.shipwright/planning/01-adopted/spec.md) (Must): Liveness probe used by `dev_server.py`, smoke tests, and the install-windows aut...
- [FR-01.11](../../.shipwright/planning/01-adopted/spec.md) (Must): Same shape as launch but for `--resume` of an existing session into a new task r...
- [FR-01.12](../../.shipwright/planning/01-adopted/spec.md) (Must): Reads `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` as a UTF-8-safe byte range...
- [FR-01.14](../../.shipwright/planning/01-adopted/spec.md) (Must): Adds the toolUseId to the dismissed set so subsequent inbox derivations skip it....
- [FR-01.17](../../.shipwright/planning/01-adopted/spec.md) (Must): Spawns the project's `dev_server.command` (from its stack profile) with `shell: ...
- [FR-01.18](../../.shipwright/planning/01-adopted/spec.md) (Must): Read-only forwarder for `<project.path>/shipwright_run_config.json`. Per-row fau...
- [FR-01.19](../../.shipwright/planning/01-adopted/spec.md) (Must): Lazy-expand listing for the FolderTree component. Honors gitignore (mtime-cached...
- [FR-01.20](../../.shipwright/planning/01-adopted/spec.md) (Must): Reads a single file under the project root with the same realpath-based path gua...
- [FR-01.21](../../.shipwright/planning/01-adopted/spec.md) (Must): One-shot: writes an empty (but schema-valid) `.webui/actions.json` under the pro...
- [FR-01.22](../../.shipwright/planning/01-adopted/spec.md) (Must): Returns CLI version (refreshed on demand), profiles dir, sample copy-commands, o...
- [FR-01.23](../../.shipwright/planning/01-adopted/spec.md) (Must): Lists every stack profile from the resolved profiles dir (override → monorepo → ...
- [FR-01.25](../../.shipwright/planning/01-adopted/spec.md) (Must): GET returns the project row. PATCH updates name / profile / color. DELETE remove...
- [FR-01.26](../../.shipwright/planning/01-adopted/spec.md) (Must): GET returns the current settings JSON. PUT replaces it (lockfile-guarded). Stub ...
- [FR-01.27](../../.shipwright/planning/01-adopted/spec.md) (Must): Settings page lets the user pick a registered project, see its current actions-s...
| Total review findings | 0 |
| Unresolved findings | 0 |

