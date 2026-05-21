# Test Evidence Report

Generated: 2026-05-21T06:28:54Z

## Summary

| Metric | Value |
|--------|-------|
| Total test checkpoints | 124 |
| Total unit tests (latest) | 2189/2189 |
| New tests from iterations | +10 |

## Test Progression

| # | Event | Source | New Tests | Suite Total | Result | Date |
|---|-------|--------|-----------|-------------|--------|------|
| 1 | triage-launch-surface-webui (launchPayload + Fix-now) | iterate | +0 | 2189/2189 | PASS | 2026-05-20 |
| 2 | adopt oxlint as the project linter + env-isolate the server CORS test | iterate | +0 | 2135/2135 | PASS | 2026-05-19 |
| 3 | Inbox card markdown rendering + fade-clip + spacing | iterate | +0 | 979/979 | PASS | 2026-05-19 |
| 4 | triage promote carries the brief into the launched run (actionId + newline flatten) | iterate | +0 | 1156/1156 | PASS | 2026-05-19 |
| 5 | fix triage promote: carry item.detail into the promoted task description | iterate | +0 | 1155/1155 | PASS | 2026-05-19 |
| 6 | fix --name double-quoting in bundled launch templates via the {task.session_name} placeholder | iterate | +0 | 1152/1152 | PASS | 2026-05-18 |
| 7 | inbox-terminal-prompts: surface waiting terminal pickers + focus terminal on Inbox click | iterate | +0 | 2062/2062 | PASS | 2026-05-18 |
| 8 | fix launch command dropping the persisted task description on Resume / non-modal launches | iterate | +0 | 1123/1123 | PASS | 2026-05-18 |
| 9 | terminal keyboard copy/paste with multi-line paste fidelity | iterate | +0 | 970/970 | PASS | 2026-05-18 |
| 10 | terminal cursor flicker on remount — restore DECTCEM (?25) cursor visibility in headless-mirror replay snapshots | iterate | +0 | 2045/2045 | PASS | 2026-05-18 |
| 11 | edit-task-dialog: Edit Task dialog with lifecycle-gated field editability | iterate | +0 | 2042/2042 | PASS | 2026-05-18 |
| 12 | move-to-backlog — POST /api/external/tasks/:id/backlog + Move-to-Backlog menu items + draft-sticky transcript guard + Resume-vs-Launch fix (rebased onto origin/main afb4dc1) | iterate | +0 | 1985/1985 | PASS | 2026-05-17 |
| 13 | move-to-backlog — POST /api/external/tasks/:id/backlog + Move-to-Backlog menu items + draft-sticky transcript guard + Resume-vs-Launch fix | iterate | +0 | 1994/1994 | PASS | 2026-05-17 |
| 14 | Resume guard survives a browser reload — ptyReused ready-envelope flag arms the one-shot inject guard on a reused pty | iterate | +0 | 1939/1940 | FAIL | 2026-05-17 |
| 15 | Remove orphaned Resume-CTA liveness-gate code (getLastPtyDataAt/isAltBufferActive/altScreenActive/lastPtyDataAt) — dead since PR #29; eliminates a flaky CI test | iterate | +0 | 1935/1935 | PASS | 2026-05-17 |
| 16 | Production build copies non-TS runtime assets into dist/ (fixes /actions HTTP 500) | iterate | +0 | 1069/1069 | PASS | 2026-05-16 |
| 17 | Remove Resume-CTA activity gate; one-shot inject guard; Copy Resume command; fix Copy session UUID | iterate | +0 | 1948/1948 | PASS | 2026-05-16 |
| 18 | terminal-smear-interleave — replay drain gate eliminates the embedded-terminal reattach smear (Bug B); ADR-099 WebGL atlas machinery removed | iterate | +0 | 892/892 | PASS | 2026-05-16 |
| 19 | evt-70d06e02 | iterate | +0 | — | — | 2026-05-15 |
| 20 | terminal-smear-reset — replay-snapshot remount smear fix (term.write callback) + WS reset banner | iterate | +0 | 1885/1885 | PASS | 2026-05-15 |
| 21 | close-task-redirect — Close task in TaskDetail header now redirects to the task board | iterate | +0 | 857/857 | PASS | 2026-05-15 |
| 22 | triage-card-styling — white-surface cards + wizard-matched dialogs | iterate | +0 | 855/855 | PASS | 2026-05-15 |
| 23 | docs(guide): document SHIPWRIGHT_NETWORK_PROFILE + .env.local workflow | backfill-retro | — | — | — | 2026-05-10 |
| 24 | fix(client): accept MagicDNS hostnames in Vite allowedHosts for tailscale profile | backfill-retro | — | — | — | 2026-05-10 |
| 25 | fix(server): wire SHIPWRIGHT_NETWORK_PROFILE into Trusted-Origin policy | backfill-retro | — | — | — | 2026-05-10 |
| 26 | fix(cli-compat): use platform-aware path module in selfHealClaudePath | backfill-retro | — | — | — | 2026-05-11 |
| 27 | Merge pull request #8 from svenroth-ai/fix/cli-compat-cross-platform-path | backfill-merge-retro | — | — | — | 2026-05-11 |
| 28 | fix(server,test): wire boot-time Trusted-Origin policy into WS upgrade gate (ADR-083) | backfill-retro | — | — | — | 2026-05-11 |
| 29 | Merge iterate/v0.9.1-tailscale-ws-real-browser-fix | backfill-merge-retro | — | — | — | 2026-05-11 |
| 30 | chore(workflows): drop dormant security + claude-review workflows from monorepo templates | backfill-retro | — | — | — | 2026-05-11 |
| 31 | Merge pull request #9 from svenroth-ai/chore/scaffold-security-and-claude-review-workflows | backfill-merge-retro | — | — | — | 2026-05-11 |
| 32 | chore(security): sync security.yml from monorepo (codeql v4 + continue-on-error) | backfill-retro | — | — | — | 2026-05-11 |
| 33 | Merge pull request #10 from svenroth-ai/chore/security-workflow-v4-and-private-repo-support | backfill-merge-retro | — | — | — | 2026-05-11 |
| 34 | Merge iterate/v0.9.2-embedded-terminal-mount-races (ADR-084) | backfill-merge-retro | — | — | — | 2026-05-11 |
| 35 | Merge branch 'main' of https://github.com/svenroth-ai/shipwright-webui | backfill-merge-retro | — | — | — | 2026-05-11 |
| 36 | Merge iterate/v0.9.3-resume-state-machine (ADR-085) | backfill-merge-retro | — | — | — | 2026-05-11 |
| 37 | Merge iterate/v0.9.4-skip-replay-newplain (ADR-086) | backfill-merge-retro | — | — | — | 2026-05-11 |
| 38 | feat(server): wire @xterm/headless mirror behind feature flag (ADR-088 Iterate A) | backfill-retro | — | — | — | 2026-05-11 |
| 39 | feat(server,client): replay_snapshot envelope + flag flip + snapshot-store hardening (ADR-089) | backfill-retro | — | — | — | 2026-05-11 |
| 40 | refactor(terminal): retire ADR-069/077/079/086 compensations; snapshot-only replay (ADR-087) | backfill-retro | — | — | — | 2026-05-12 |
| 41 | docs(terminal): sweep stale chunked-replay references post-ADR-087 (campaign code-review follow-up) | backfill-retro | — | — | — | 2026-05-12 |
| 42 | Merge iterate/headless-A-mirror-flag (ADR-088 — campaign headless-terminal-refactor A) | backfill-merge-retro | — | — | — | 2026-05-12 |
| 43 | Merge iterate/headless-B-snapshot-protocol (ADR-089 — campaign headless-terminal-refactor B) | backfill-merge-retro | — | — | — | 2026-05-12 |
| 44 | Merge iterate/headless-C-retire-compensations (ADR-087 — campaign headless-terminal-refactor C; supersedes ADR-069/077/079/086) | backfill-merge-retro | — | — | — | 2026-05-12 |
| 45 | fix(server): mark @xterm/headless fixture as binary; pin LF-normalized size | backfill-retro | — | — | — | 2026-05-12 |
| 46 | fix(server): live-pty replay via serialize-on-attach + snapshot-on-detach (ADR-092) | backfill-retro | — | — | — | 2026-05-12 |
| 47 | docs(server,test): sweep stale disk-first comment + tighten cursor axis assertion (E code-review follow-up) | backfill-retro | — | — | — | 2026-05-12 |
| 48 | Merge iterate/headless-E-live-pty-snapshot-fix (ADR-092 — closes ADR-091 live-pty replay regression) | backfill-merge-retro | — | — | — | 2026-05-12 |
| 49 | Merge iterate/headless-F-xterm-config-vorbild-align (ADR-093 — xterm.js Vorbild-Alignment for in-session status-pane stacking fix) | backfill-merge-retro | — | — | — | 2026-05-13 |
| 50 | Merge iterate/headless-G-flicker-env-and-resume-gating (ADR-095 — Claude TUI flicker env + Resume button gating) | backfill-merge-retro | — | — | — | 2026-05-13 |
| 51 | Merge iterate/headless-H-snapshot-preservation-taskcard-gating (ADR-096 — finalizeMirrorSnapshot preservation heuristic + TaskCard Resume gating) | backfill-merge-retro | — | — | — | 2026-05-13 |
| 52 | refactor(client,server): upgrade xterm.js 5.5.0 -> 6.0.0 (ADR-097) | backfill-retro | — | — | — | 2026-05-13 |
| 53 | test(e2e): migrate readXtermRows helper from DOM-locator to buffer-peek | backfill-retro | — | — | — | 2026-05-13 |
| 54 | Merge iterate/xterm-6-upgrade (ADR-097 — xterm.js 5.5.0 → 6.0.0; amends ADR-088 pin + ADR-095 NO_FLICKER default) | backfill-merge-retro | — | — | — | 2026-05-13 |
| 55 | refactor(client): refresh NewIssueModal copy to match auto-execute flow | backfill-retro | — | — | — | 2026-05-13 |
| 56 | Merge iterate/refresh-newissue-tooltips — NewIssueModal copy aligned to auto-execute embedded-terminal flow (ADR-068-A1) | backfill-merge-retro | — | — | — | 2026-05-13 |
| 57 | Merge iterate/headless-J-restore-no-flicker-default (ADR-098 — restore NO_FLICKER default after empirical Claude #37283 finding) | backfill-merge-retro | — | — | — | 2026-05-13 |
| 58 | feat(client): surface Resume CTA on state=active when pty is gone | backfill-retro | — | — | — | 2026-05-14 |
| 59 | fix(client): drop liveSession gating — Resume CTA always shows on idle/active | backfill-retro | — | — | — | 2026-05-14 |
| 60 | fix(server): refine new-plain Resume gate — emit --resume when JSONL exists | backfill-retro | — | — | — | 2026-05-14 |
| 61 | feat(server,client): introduce altScreenActive — hide Resume while TUI is foregrounded | backfill-retro | — | — | — | 2026-05-14 |
| 62 | Merge pull request #11 from svenroth-ai/iterate/resume-cta-active-state | backfill-merge-retro | — | — | — | 2026-05-14 |
| 63 | fix(terminal): WebGL load-order + rescaleOverlappingGlyphs (ADR-099) | backfill-retro | — | — | — | 2026-05-14 |
| 64 | Merge pull request #12 from svenroth-ai/iterate/codex-rescue-altscreen-rendering | backfill-merge-retro | — | — | — | 2026-05-14 |
| 65 | docs(guide): align launch flow to embedded-terminal auto-execute | backfill-retro | — | — | — | 2026-05-14 |
| 66 | docs(client): drop stale "nothing copies" from Save-to-Backlog tooltip | backfill-retro | — | — | — | 2026-05-14 |
| 67 | docs(claude-md): align WHAT/Architecture rules to embedded-terminal auto-execute + close Structure drift | backfill-retro | — | — | — | 2026-05-14 |
| 68 | docs(changelog): add two unreleased drops for CLAUDE.md alignment + Structure drift fix | backfill-retro | — | — | — | 2026-05-14 |
| 69 | Merge pull request #13 from svenroth-ai/docs/launch-flow-and-tooltip-alignment | backfill-merge-retro | — | — | — | 2026-05-14 |
| 70 | feat(wizard): render stack-profile step dynamically from /api/profiles | backfill-retro | — | — | — | 2026-05-14 |
| 71 | Merge pull request #15 from svenroth-ai/iterate/lead-foundation-task-schema | backfill-merge-retro | — | — | — | 2026-05-14 |
| 72 | feat(triage): WebUI Triage Tab + Promote bridge (FR-01.30, ADR-101) | backfill-retro | — | — | — | 2026-05-15 |
| 73 | docs(readme): add Triage tab section (FR-01.30, ADR-101) | backfill-retro | — | — | — | 2026-05-15 |
| 74 | Merge pull request #16 from svenroth-ai/iterate/post-merge-resume-gate-and-replay-smear | backfill-merge-retro | — | — | — | 2026-05-15 |
| 75 | Merge pull request #17 from svenroth-ai/iterate/triage-tab | backfill-merge-retro | — | — | — | 2026-05-15 |
| 76 | Iterate M (Resume CTA active-state followup) + ADR-099 v10 (post-replay maintenance) | iterate-M-retro | — | — | — | 2026-05-15 |
| 77 | Merge PR #14: Iterate K v1-v9 (xterm.js 6.0 atlas-corruption workaround) | iterate-K-merge-retro | — | — | — | 2026-05-14 |
| 78 | Iterate K v9: post-launch-settle backstop (4s after consumeLaunch) for Resume-click-in-long-mounted-tab | iterate-K-retro | — | — | — | 2026-05-14 |
| 79 | Iterate K: ?atlasMaintenance=off kill switch + A/B regression probes (stills + video) | iterate-K-retro | — | — | — | 2026-05-14 |
| 80 | Iterate K v8: DOM wheel listener (Tabby pattern) + 10-scenario systematic Playwright probe | iterate-K-retro | — | — | — | 2026-05-14 |
| 81 | Iterate K v7: pre-init lastWriteTime + post-mount-settle backstop | iterate-K-retro | — | — | — | 2026-05-14 |
| 82 | Iterate K cherry-pick: D-e2e task-type matrix | iterate-K-retro | — | — | — | 2026-05-14 |
| 83 | Iterate K Vite WS proxy: swallow ECONNRESET/ECONNABORTED/EPIPE | iterate-K-retro | — | — | — | 2026-05-14 |
| 84 | Iterate K v6: burst-after-2s-quiet trigger via onWriteParsed | iterate-K-retro | — | — | — | 2026-05-14 |
| 85 | Iterate K v5: split main = clear+refresh, alt = refresh-only | iterate-K-retro | — | — | — | 2026-05-14 |
| 86 | Iterate K v4: skip atlas-clear in alt-screen buffer | iterate-K-retro | — | — | — | 2026-05-14 |
| 87 | Iterate K v3: conditional via onWriteParsed counter (skip when idle) | iterate-K-retro | — | — | — | 2026-05-14 |
| 88 | Iterate K v2: 10s periodic + term.refresh() after clear | iterate-K-retro | — | — | — | 2026-05-14 |
| 89 | Iterate K v1: 30s periodic clearTextureAtlas + onScroll | iterate-K-retro | — | — | — | 2026-05-14 |
| 90 | server-side ?1006h re-emit in replay-snapshot envelope (Iterate K) | iterate-K-retro | — | — | — | 2026-05-14 |
| 91 | leadwright Phase 1 ExternalTask extension (13 optional fields) | iterate | +0 | 1780/1780 | PASS | 2026-05-14 |
| 92 | Restore CLAUDE_CODE_NO_FLICKER=1 default (ADR-098 - Iterate J) | iterate-runner | +1720 | 1720/1720 | PASS | 2026-05-13 |
| 93 | Iterate H — Snapshot preservation on pty death + TaskCard Resume gating (ADR-096) | iterate | +10 | 1717/1717 | PASS | 2026-05-13 |
| 94 | Iterate G — Claude TUI flicker env + Resume button gating (ADR-095) | iterate-G | +1707 | 1707/1707 | PASS | 2026-05-13 |
| 95 | dynamic-stack-profiles: wizard step 2 renders from /api/profiles + bundled snapshot refresh (ADR-094) | iterate | +0 | 786/786 | PASS | 2026-05-12 |
| 96 | Iterate F headless-terminal-refactor: xterm.js convertEol+allowProposedApi+scrollback alignment + WebglAddon try/catch fallback; follow-on to ADR-092 for in-session status-pane redraw stacking (ADR-093) | iterate | +0 | 777/777 | PASS | 2026-05-12 |
| 97 | v0.9.4 skip disk-scrollback replay on attach for new-plain tasks (Claude TUI byte-stacking corruption fix; ADR-086) | iterate | +0 | 1636/1636 | PASS | 2026-05-11 |
| 98 | v0.9.3 resume state-machine: scope active→idle JSONL-mtime decay to non-new-plain (ADR-085) | iterate | +0 | 1636/1636 | PASS | 2026-05-11 |
| 99 | v0.9.2 embedded terminal mount races: 1500ms readOnly banner grace + safeFit/disposedRef/_renderService dimensions stub (ADR-084) | iterate | +0 | 1631/1631 | PASS | 2026-05-11 |
| 100 | env-local-loading-fix: tsx --env-file-if-exists for server + loadEnv with envDir for Vite. Closes ADR-081 wiring gap. ADR-082. | iterate | +0 | 1606/1606 | PASS | 2026-05-10 |
| 101 | network-profile-flag: SHIPWRIGHT_NETWORK_PROFILE env-flag (local/tailscale/open) unifies Vite + Hono dev-server bind. Tailscale auto-detect via subprocess + env override. Closes Vite-proxy gap when Hono binds non-loopback. ADR-081. | iterate | +0 | 1586/1586 | PASS | 2026-05-10 |
| 102 | tsc-baseline-fix: retire 4 documented tsc baseline errors (3x cross-package imports + missing @types/proper-lockfile). server npm run build exits 0; install-windows.ps1 step [3/4] runs clean. Type mirrors under server/src/types/ + comment-aware drift-guard test. ADR-080. | iterate | +0 | 1508/1508 | PASS | 2026-05-09 |
| 103 | v0.8.9 replay-pushdown: live shell at viewport top after replay-on-attach (FR-01.28 v0.8.9 AC-1) | iterate | +0 | 1500/1500 | PASS | 2026-05-09 |
| 104 | HONO_HOST opt-in: backend default-binds loopback, opt-in for non-loopback | iterate | +0 | 8/8 | PASS | 2026-05-07 |
| 105 | HONO_HOST opt-in: backend default-binds loopback, opt-in for non-loopback | iterate | +0 | 8/8 | PASS | 2026-05-07 |
| 106 | VITE_HOST opt-in for LAN/Tailscale dev-server access | iterate | +0 | 7/7 | PASS | 2026-05-07 |
| 107 | v0.8.2 follow-up: disclosure null-handling fix, Show-ignored toggle rename, Spec 79 live-browser smoke (5 tests covering AC-2/4/7/8/9). 1399/1399 unit + 37/37 e2e green. | iterate | +0 | 1399/1399 | PASS | 2026-05-06 |
| 108 | v0.8.2 polish — Spec 74 modal flake (AC-1) + xterm dark theme for Claude TUI legibility (AC-2) + Ctrl+V parity (AC-3) + image-paste latency reduction (AC-4) + awaiting-launch diag logs (AC-5) + paste-dir migration to .shipwright-webui/pastes/ (AC-6) + replay-only mode for done/launch_failed tasks (AC-7) + conditional disclosure footer (AC-8) + retention copy interpolation (AC-9). 1398/1398 unit + 33/33 e2e green. ADR-070. | iterate | +0 | 1398/1398 | PASS | 2026-05-06 |
| 109 | Post-v0.8 stabilization (Tier 0): AC-1 scrollback ANSI sanitizer + AC-3 per-conn pause refcount + writer-stuck watchdog. AC-2 deferred to follow-up. ADR-069. 1369/1369 unit tests green. | iterate | +0 | 1369/1369 | PASS | 2026-05-05 |
| 110 | Embedded-terminal auto-launch + disk-backed scrollback persistence (ADR-068-A1) — clipboard-free one-click Launch via LaunchCoordinatorContext + WS data-frame; pty.onData appends to <scrollbackDir>/<taskId>.log via fs.appendFileSync with 3-state rotation; replay-on-attach with pty.pause/resume + chunked envelopes; new POST /clear-scrollback + Stop terminal session + Clear history modal; privacy disclosure footer. | iterate | +0 | 1320/1320 | PASS | 2026-05-04 |
| 111 | Embedded terminal launcher (ADR-067) — Phase 6.1 fixes after second external code-review pass + live integration smoke. CRITICAL: ESM require bug broke every WS upgrade; Vite proxy missing ws:true; header CTA missing webui:launch-copied dispatch. Plus task.cwd realpath validation, paste-image auto-spawn, Content-Length missing/invalid handling, empty-text-paste path, paste-image error toast, browser-level paste E2E. 1273 unit + 12 Playwright tests green against real Chromium + Hono + xterm + node-pty. | iterate | +0 | 1285/1285 | PASS | 2026-05-04 |
| 112 | Embedded terminal launcher (ADR-067) — Phase 6 post-code-review hardening: writer-conn idempotency (CRITICAL); /append-gitignore 404 ordering; /paste-image writer-gate; Origin gate; second-attach envelope; toast-error UX; browser-level paste-event E2E. 1273/1273 tests green. | iterate | +0 | 1273/1273 | PASS | 2026-05-03 |
| 113 | Embedded terminal launcher (xterm.js + node-pty + WebSocket image-paste flow) — Plan-D''-conform shell pane in TaskDetail; replaces external-terminal-only launches; closes Anthropic claude-cli image-paste gap (Issue #51244); ADR-067. | iterate | +0 | 1269/1269 | PASS | 2026-05-03 |
| 114 | Persistent virtualizer measurement cache + cold-cache warmup pass (5th attempt at slow-scroll jump; ADR-066) — merge to main | iterate | +0 | 657/657 | PASS | 2026-05-02 |
| 115 | Persistent virtualizer measurement cache + cold-cache warmup pass (5th attempt at slow-scroll jump; ADR-066) | iterate | +0 | 657/657 | PASS | 2026-05-02 |
| 116 | filter null-rendering events out of virtualized transcript (ADR-065; rapid-scroll partial fix; slow-scroll deferred to follow-up) | iterate | +0 | 640/640 | PASS | 2026-05-02 |
| 117 | useTaskTranscript polling cascade fix (residual scroll-up flicker) | iterate | +0 | 635/635 | PASS | 2026-05-01 |
| 118 | overflow-anchor virtualized carve-out (scroll-up flicker root cause) | iterate | +0 | 634/634 | PASS | 2026-05-01 |
| 119 | virtualizer flicker fix (merge) | iterate | +0 | 632/632 | PASS | 2026-05-01 |
| 120 | virtualizer flicker fix | iterate | +0 | 632/632 | PASS | 2026-05-01 |
| 121 | system chips alignment + scroll polish (merge) | iterate | +0 | 632/632 | PASS | 2026-05-01 |
| 122 | system chips alignment + scroll polish | iterate | +0 | 632/632 | PASS | 2026-05-01 |
| 123 | task-notification rendering | iterate | +0 | 624/624 | PASS | 2026-05-01 |
| 124 | VS Code .code-workspace auto-generated on POST /api/projects | iterate | +0 | 537/537 | PASS | 2026-05-01 |

