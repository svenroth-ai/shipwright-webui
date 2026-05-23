# Project Activity Dashboard
> Updated: 2026-05-22 23:11 UTC | Session: a54ea378-a0cd-404e-b95d-91919fa66dd3 | Run: iterate-2026-05-23-terminal-selection-uxd

## Recent Changes (64 iterations)

| Type | Description | Tests | Commit | FRs | Date |
|------|-------------|-------|--------|-----|------|
| change | spec.md: append FR-01.28 acceptance criteria for terminal-selection-uxd | 65/65 | 46f9138 | FR-01.28 | 2026-05-22 |
| change | VS Code-aligned terminal selection + copy-on-mouseup + mouse-mode hint | 65/65 | 9e1559b | FR-01.28 | 2026-05-22 |
| change | compliance documentation hygiene Phase 0f (F4-F7) | 0/0 | f4d52fd | compliance | 2026-05-22 |
| bug | triage Fix-now pre-selects the triage item's project in NewIssueModal | 2198/2198 | 32b7320 | FR-01.30 | 2026-05-22 |
| bug | SPA fallback for /triage, /inbox & friends (Hono server) | 1174/1174 | 3141866 | infra | 2026-05-22 |
| bug | VERIFICATION: bug+change-type — should pass | 0/0 | c502254 | tooling | 2026-05-21 |
| feature | VERIFICATION: with affected-frs — should pass | 0/0 | c502254 | FR-01.01 | 2026-05-21 |
| change | triage Fix-now opens NewIssueModal pre-populated + namespace 4 phase slashes (+ FR-01.30 spec follow-up) | 2193/2193 | 4ca5be2 | FR-01.30 | 2026-05-21 |
| change | triage Fix-now opens NewIssueModal pre-populated + namespace 4 phase slashes | 2193/2193 | aa1788c | FR-01.30 | 2026-05-21 |
| bug | fix-terminal-flicker-on-closed-task | 2184/2184 | dac635f |  | 2026-05-21 |
| feature | triage-launch-surface-webui (launchPayload + Fix-now) | 2189/2189 | 290263e | FR-01.30 | 2026-05-20 |
| change | adopt oxlint as the project linter + env-isolate the server CORS test | 2135/2135 | e6683d6 | tooling | 2026-05-19 |
| change | Inbox card markdown rendering + fade-clip + spacing | 979/979 | 9b91499 | FR-01.13 | 2026-05-19 |
| bug | triage promote carries the brief into the launched run (actionId + newline flatten) | 1156/1156 | 3936dbd | FR-01.30 | 2026-05-19 |
| bug | fix triage promote: carry item.detail into the promoted task description | 1155/1155 | 3c99c69 | FR-01.30 | 2026-05-19 |
| bug | fix --name double-quoting in bundled launch templates via the {task.session_name} placeholder | 1152/1152 | ae2d014 | FR-01.10 | 2026-05-18 |
| feature | inbox-terminal-prompts: surface waiting terminal pickers + focus terminal on Inbox click | 2062/2062 | e4309a5 | FR-01.02, FR-01.04, FR-01.13 | 2026-05-18 |
| bug | fix launch command dropping the persisted task description on Resume / non-modal launches | 1123/1123 | d097820 | FR-01.10, FR-01.11 | 2026-05-18 |
| feature | terminal keyboard copy/paste with multi-line paste fidelity | 970/970 | 086b72c | FR-01.28, FR-01.29 | 2026-05-18 |
| bug | terminal cursor flicker on remount — restore DECTCEM (?25) cursor visibility in headless-mirror replay snapshots | 2045/2045 | 3612407 | FR-01.28 | 2026-05-18 |
| feature | edit-task-dialog: Edit Task dialog with lifecycle-gated field editability | 2042/2042 | 21e2941 | FR-01.01, FR-01.08, FR-01.09 | 2026-05-18 |
| feature | move-to-backlog — POST /api/external/tasks/:id/backlog + Move-to-Backlog menu items + draft-sticky transcript guard + Resume-vs-Launch fix (rebased onto origin/main afb4dc1) | 1985/1985 | 0610032 | FR-01.01, FR-01.32 | 2026-05-17 |
| feature | move-to-backlog — POST /api/external/tasks/:id/backlog + Move-to-Backlog menu items + draft-sticky transcript guard + Resume-vs-Launch fix | 1994/1994 | 8e6e1e5 | FR-01.01, FR-01.32 | 2026-05-17 |
| bug | Resume guard survives a browser reload — ptyReused ready-envelope flag arms the one-shot inject guard on a reused pty | 1939/1940 | 23f4a38 | FR-01.11, FR-01.28 | 2026-05-17 |
| change | Remove orphaned Resume-CTA liveness-gate code (getLastPtyDataAt/isAltBufferActive/altScreenActive/lastPtyDataAt) — dead since PR #29; eliminates a flaky CI test | 1935/1935 | 641f639 | FR-01.11 | 2026-05-17 |
| bug | Production build copies non-TS runtime assets into dist/ (fixes /actions HTTP 500) | 1069/1069 | ffdbe80 | infra | 2026-05-16 |
| change | Remove Resume-CTA activity gate; one-shot inject guard; Copy Resume command; fix Copy session UUID | 1948/1948 | a520293 | FR-01.28 | 2026-05-16 |
| bug | terminal-smear-interleave — replay drain gate eliminates the embedded-terminal reattach smear (Bug B); ADR-099 WebGL atlas machinery removed | 892/892 | 316c056 | FR-01.28 | 2026-05-16 |
| change | — | 0/0 | 038a616 | tooling | 2026-05-15 |
| bug | terminal-smear-reset — replay-snapshot remount smear fix (term.write callback) + WS reset banner | 1885/1885 | 038a616 | FR-01-embedded-terminal | 2026-05-15 |
| bug | close-task-redirect — Close task in TaskDetail header now redirects to the task board | 857/857 | bf6db41 | FR-01.15 | 2026-05-15 |
| change | triage-card-styling — white-surface cards + wizard-matched dialogs | 855/855 | 5e94742 | FR-01.30 | 2026-05-15 |
| feature | leadwright Phase 1 ExternalTask extension (13 optional fields) | 1780/1780 | c70f848 | FR-01.01, FR-01.08, FR-01.10 | 2026-05-14 |
| bug | Iterate H — Snapshot preservation on pty death + TaskCard Resume gating (ADR-096) | +10 new, 1717/1717 | 17d75c9 | FR-01.28, FR-01.11 | 2026-05-13 |
| change | dynamic-stack-profiles: wizard step 2 renders from /api/profiles + bundled snapshot refresh (ADR-094) | 786/786 | 134a2e2 | FR-01.03 | 2026-05-12 |
| change | Iterate F headless-terminal-refactor: xterm.js convertEol+allowProposedApi+scrollback alignment + WebglAddon try/catch fallback; follow-on to ADR-092 for in-session status-pane redraw stacking (ADR-093) | 777/777 | 6f715fc | FR-01.28 | 2026-05-12 |
| bug | v0.9.4 skip disk-scrollback replay on attach for new-plain tasks (Claude TUI byte-stacking corruption fix; ADR-086) | 1636/1636 | fbfb449 | FR-01.28 | 2026-05-11 |
| bug | v0.9.3 resume state-machine: scope active→idle JSONL-mtime decay to non-new-plain (ADR-085) | 1636/1636 | 4bb3799 | FR-01.28 | 2026-05-11 |
| bug | v0.9.2 embedded terminal mount races: 1500ms readOnly banner grace + safeFit/disposedRef/_renderService dimensions stub (ADR-084) | 1631/1631 | 1cdeb9b | FR-01.28 | 2026-05-11 |
| bug | env-local-loading-fix: tsx --env-file-if-exists for server + loadEnv with envDir for Vite. Closes ADR-081 wiring gap. ADR-082. | 1606/1606 | 4479736 | FR-01.31 | 2026-05-10 |
| feature | network-profile-flag: SHIPWRIGHT_NETWORK_PROFILE env-flag (local/tailscale/open) unifies Vite + Hono dev-server bind. Tailscale auto-detect via subprocess + env override. Closes Vite-proxy gap when Hono binds non-loopback. ADR-081. | 1586/1586 | 6827d97 | FR-01.31 | 2026-05-10 |
| bug | tsc-baseline-fix: retire 4 documented tsc baseline errors (3x cross-package imports + missing @types/proper-lockfile). server npm run build exits 0; install-windows.ps1 step [3/4] runs clean. Type mirrors under server/src/types/ + comment-aware drift-guard test. ADR-080. | 1508/1508 | 3ab3ad9 | tooling | 2026-05-09 |
| bug | v0.8.9 replay-pushdown: live shell at viewport top after replay-on-attach (FR-01.28 v0.8.9 AC-1) | 1500/1500 | 98e8c98 | FR-01.28 | 2026-05-09 |
| feature | HONO_HOST opt-in: backend default-binds loopback, opt-in for non-loopback | 8/8 | 6504911 | FR-01.31 | 2026-05-07 |
| feature | HONO_HOST opt-in: backend default-binds loopback, opt-in for non-loopback | 8/8 | 825cdcf | FR-01.31 | 2026-05-07 |
| feature | VITE_HOST opt-in for LAN/Tailscale dev-server access | 7/7 | 0881461 | FR-01.31 | 2026-05-07 |
| bug | v0.8.2 follow-up: disclosure null-handling fix, Show-ignored toggle rename, Spec 79 live-browser smoke (5 tests covering AC-2/4/7/8/9). 1399/1399 unit + 37/37 e2e green. | 1399/1399 | c62e759 | FR-01.28, FR-01.29 | 2026-05-06 |
| bug | v0.8.2 polish — Spec 74 modal flake (AC-1) + xterm dark theme for Claude TUI legibility (AC-2) + Ctrl+V parity (AC-3) + image-paste latency reduction (AC-4) + awaiting-launch diag logs (AC-5) + paste-dir migration to .shipwright-webui/pastes/ (AC-6) + replay-only mode for done/launch_failed tasks (AC-7) + conditional disclosure footer (AC-8) + retention copy interpolation (AC-9). 1398/1398 unit + 33/33 e2e green. ADR-070. | 1398/1398 | d492d3a | FR-01.28, FR-01.29 | 2026-05-06 |
| bug | Post-v0.8 stabilization (Tier 0): AC-1 scrollback ANSI sanitizer + AC-3 per-conn pause refcount + writer-stuck watchdog. AC-2 deferred to follow-up. ADR-069. 1369/1369 unit tests green. | 1369/1369 | 69d2da3 | FR-01.28 | 2026-05-05 |
| feature | Embedded-terminal auto-launch + disk-backed scrollback persistence (ADR-068-A1) — clipboard-free one-click Launch via LaunchCoordinatorContext + WS data-frame; pty.onData appends to <scrollbackDir>/<taskId>.log via fs.appendFileSync with 3-state rotation; replay-on-attach with pty.pause/resume + chunked envelopes; new POST /clear-scrollback + Stop terminal session + Clear history modal; privacy disclosure footer. | 1320/1320 | 8d48225 | FR-01.10, FR-01.28, FR-01.02 | 2026-05-04 |
| feature | Embedded terminal launcher (ADR-067) — Phase 6.1 fixes after second external code-review pass + live integration smoke. CRITICAL: ESM require bug broke every WS upgrade; Vite proxy missing ws:true; header CTA missing webui:launch-copied dispatch. Plus task.cwd realpath validation, paste-image auto-spawn, Content-Length missing/invalid handling, empty-text-paste path, paste-image error toast, browser-level paste E2E. 1273 unit + 12 Playwright tests green against real Chromium + Hono + xterm + node-pty. | 1285/1285 | 1517e2e | FR-01.02, FR-01.10, FR-01.28 | 2026-05-04 |
| feature | Embedded terminal launcher (ADR-067) — Phase 6 post-code-review hardening: writer-conn idempotency (CRITICAL); /append-gitignore 404 ordering; /paste-image writer-gate; Origin gate; second-attach envelope; toast-error UX; browser-level paste-event E2E. 1273/1273 tests green. | 1273/1273 | ffca237 | FR-01.02, FR-01.10, FR-01.28 | 2026-05-03 |
| feature | Embedded terminal launcher (xterm.js + node-pty + WebSocket image-paste flow) — Plan-D''-conform shell pane in TaskDetail; replaces external-terminal-only launches; closes Anthropic claude-cli image-paste gap (Issue #51244); ADR-067. | 1269/1269 | c8f64e7 | FR-01.02, FR-01.10, FR-01.28 | 2026-05-03 |
| bug | Persistent virtualizer measurement cache + cold-cache warmup pass (5th attempt at slow-scroll jump; ADR-066) — merge to main | 657/657 | 22f8750 | FR-01.02 | 2026-05-02 |
| bug | Persistent virtualizer measurement cache + cold-cache warmup pass (5th attempt at slow-scroll jump; ADR-066) | 657/657 | 023bf16 | FR-01.02 | 2026-05-02 |
| bug | filter null-rendering events out of virtualized transcript (ADR-065; rapid-scroll partial fix; slow-scroll deferred to follow-up) | 640/640 | f741fb9 | FR-01.02 | 2026-05-02 |
| bug | useTaskTranscript polling cascade fix (residual scroll-up flicker) | 635/635 | c8bcecd | FR-01.28 | 2026-05-01 |
| bug | overflow-anchor virtualized carve-out (scroll-up flicker root cause) | 634/634 | 9595939 | FR-01.28 | 2026-05-01 |
| bug | virtualizer flicker fix (merge) | 632/632 | b2ab205 | FR-01.28 | 2026-05-01 |
| bug | virtualizer flicker fix | 632/632 | a4d1182 | FR-01.28 | 2026-05-01 |
| change | system chips alignment + scroll polish (merge) | 632/632 | 3af0669 | FR-01.01 | 2026-05-01 |
| change | system chips alignment + scroll polish | 632/632 | 3e45bd5 | FR-01.01 | 2026-05-01 |
| bug | task-notification rendering | 624/624 | b69e1e0 | FR-01.01 | 2026-05-01 |
| feature | VS Code .code-workspace auto-generated on POST /api/projects | 537/537 | a31594e | FR-01.24 | 2026-05-01 |

## Test Status
Last run: 2026-05-23 | Unit: 64/64 | E2E: 2/2 | Smoke: passed | (iterate)

## Pipeline

| Phase | Status | Completed |
|-------|--------|-----------|
| project | — | — |
| design | — | — |
| plan | — | — |
| build | — | — |
| test | — | — |
| changelog | complete | 2026-05-03 |
| compliance | — | — |
| deploy | — | — |
