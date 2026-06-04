# Project Activity Dashboard
> Updated: 2026-06-04 12:06 UTC | Session: 92ee50e1-0420-40a6-a052-88b69374e8c9 | Run: iterate-2026-06-04-campaign-step-launch

## Recent Changes (111 iterations)

| Type | Description | Tests | Commit | FRs | Date |
|------|-------------|-------|--------|-----|------|
| feature | One-click Launch (Cx) button to launch a single campaign sub-iterate via /shipwright-iterate "<specPath>" built server-side from {slug,stepId}; replaces the per-step Copy-launch clipboard button. Direct launch for ordinary steps, confirm dialog for risky ones. | 0/0 |  | FR-01.36 | 2026-06-04 |
| bug | Parse the campaign Sub-Iterates table by column header and strip Markdown emphasis from cells, so bold step IDs (**C1**) and extra Repo/Depends-on columns no longer null the spec path and disable the board per-step Copy-launch button. | 0/0 |  | bug | 2026-06-04 |
| feature | Add a formatting toolbar to the SmartViewer markdown editor (FR-01.34 WYSIWYG UX completion) | 0/0 |  | FR-01.35 | 2026-06-04 |
| change | iterate finalization | 0/0 |  |  | 2026-06-03 |
| feature | SmartViewer inline video playback (mp4/m4v/webm/ogv/ogg/mov) via a new Range-capable /media streaming route, kept separate from the atomic /file route. | 0/0 |  | FR-01.02 | 2026-06-03 |
| feature | Second Campaigns-lane action: opens a TaskDetail terminal auto-running /shipwright-iterate --campaign <slug> --autonomous, gated by a confirm dialog + risky-step warning. | 0/0 |  | FR-01.33 | 2026-06-03 |
| feature | SmartViewer in-app Markdown rich editor (TipTap) + first project-file write surface: PUT /file with content-hash If-Match optimistic concurrency, mandatory pre-save diff + warn banner. | 0/0 |  | FR-01.35 | 2026-06-03 |
| feature | Triage 'Start Campaign' action (ADR-148): POST /api/campaigns/:slug/start flips draft->active via core/campaign-write.ts (atomic, lock-protected); triage items enriched with campaignSlug/campaignStatus via injected dep (triage.ts imports no campaign module); modal renders Start Campaign/Go-to-board/none + demotes Fix-now; navigates to board. Narrow relaxation of WebUI read-only-on-campaign-state. | 0/0 |  | FR-01.33 | 2026-06-03 |
| change | campaign-store reads top-level lifecycle status (status.json/frontmatter); selectActiveCampaigns shows iff active, legacy falls back to done<total | 0/0 |  | FR-01.33 | 2026-06-03 |
| change | CampaignLaneCard collapsible (default collapsed, persisted per-slug) + description disclosure + TaskBoardPage lane height-cap | 0/0 |  | FR-01.33 | 2026-06-03 |
| change | All-Projects create-menu cascade complete: project-first + New / Plain Claude; modal scoped to chosen project (fixes action/schema mismatch). 1416 client vitest + AC1-AC6 real-browser E2E green. | 0/0 |  |  | 2026-06-02 |
| feature | Read-only Campaigns lane on TaskBoardPage + GET /api/campaigns/:projectId | 0/0 |  | FR-01.33 | 2026-06-02 |
| bug | Gate terminal idle-ceiling on client attachment so a watched session is never reaped; raise detached-grace 30min->12h; resume data-loss note on the ADR-104 reset banner. | 0/0 | 47f7450 | fix | 2026-06-02 |
| change | WS liveness keepalive complete; PR pending | 0/0 |  |  | 2026-05-31 |
| feature | POST /api/external/tasks/:id/reopen flips done->draft (counterpart of /backlog), session preserved; TaskCardMenu hosts the isDone-gated Re-open item | 0/0 | 7600526 |  | 2026-05-31 |
| change | SmartViewer pop-out opens a centered in-app modal (Radix Dialog) instead of window.open to a new browser tab; popOut threaded SmartViewer->MarkdownRenderer to suppress the nested control; /preview route retained. | 0/0 |  | FR-03.34 | 2026-05-31 |
| change | page-chrome cleanup: remove Diagnostics Launchers section and align Triage header to Inbox/Projects | 1331/1331 |  |  | 2026-05-30 |
| change | PR card bubble parity + open/merged status badge via gh pr view | 1335/1335 |  | FR-01.02 | 2026-05-30 |
| change | SmartViewer document rendering (comments/frontmatter/anchors/in-pane nav) + pop-out + page scroll | 1345/1345 |  | FR-03.34 | 2026-05-30 |
| bug | Render mode/pr-link/stop-hook JSONL events + intent-based useAutoScroll detach | 0/0 | 7573e84 | FR-01.02 | 2026-05-28 |
| bug | TaskCard + TaskDetailHeader rendered a Build pill for iterate tasks whose title started with Fix (regex match in derivePhaseFromTitle). Centralised the resolution policy in resolveTaskPhase so new-iterate always resolves to the iterate phase when no override is persisted. | 0/0 | ce60cf7 | bug | 2026-05-27 |
| change | ADR-103 retirement candidate #1: extract WebSocket upgrade body from server/src/terminal/routes.ts (1013 -> 620 LOC) into ws-upgrade-handler.ts as a single cohesive buildWsHandlers(ctx: ValidatedWsUpgradeContext) function. deriveTerminalReset moved to terminal-reset.ts to break the import cycle. routes.ts retains synchronous reject-the-upgrade validations + HTTP route handlers + spawn-env factory. 29 new lifecycle/parse-table unit tests; F0.5 Node-side WS probe pass; full server vitest suite (1342 tests) green. | 0/0 | a662027 | refactor | 2026-05-27 |
| bug | Fix prewarm race that armed the one-shot auto-launch guard on first WS attach | 1274/1274 | ff6a6d2 | infra | 2026-05-26 |
| change | iterate finalization | 0/0 |  |  | 2026-05-26 |
| change | Commit C2 API contract sweep as tracked vitest suite (baseline JSON + PROBE_TABLE in-memory probes + 3 meta-tests; regression-guards external/routes.ts touch-ups in CI) | 1279/1279 | f56b6bb | tooling | 2026-05-26 |
| change | C5 EmbeddedTerminal-split E2E backfill (auto-execute + ptyReused regression fence) | 20/20 | 63c46b2 | tooling | 2026-05-26 |
| change | NEW .github/PULL_REQUEST_TEMPLATE.md (Superpowers anti-slop framing) + README Acknowledgments block (companion to shipwright PR #105) | 0/0 | 935cc39 | docs | 2026-05-26 |
| change | Split NewIssueModal.tsx (1516 LOC) into NewIssueModal/ directory with dispatcher + ModalShell + 5 mode-specific body components + shared useNewIssueForm hook (3 slices). Both bloat baseline entries removed. | 1124/1124 | f98fbf6 | tooling | 2026-05-26 |
| change | Campaign C / C6 — Split TaskDetailHeader.tsx (1015 LOC) into 222-LOC shell + 7 sub-components. | 0/0 | 2cd7aa3 | tooling | 2026-05-26 |
| change | iterate finalization | 0/0 |  |  | 2026-05-25 |
| Accept pty-manager.ts as deep module; flip baseline entry from grandfathered to exception with ADR-101 | — | +14 new, 14/14 | 247325b | compliance | 2026-05-25 |
| Verify CLAUDE.md is already <= 300 LOC and not in bloat baseline; document Phase-0f organic outcome. | Sub-iterate C1 (verification) of Campaign 2026-05-25-bloat-cleanup-C-webui. CLAUDE.md is 197 LOC on origin/main and not in shipwright_bloat_baseline.json — Phase 0f compliance-hygiene cleanup (PR #55, commit f4d52fd) organically delivered the target. Reframed C1 as Verification Iterate: pytest probe (2 assertions) + ADR-100 + existing client doc-sync vitest guard (20 cases). No edit to CLAUDE.md. | +2 new, 22/22 | b1e66f4 | docs | 2026-05-25 |
| change | Backfill 14 work_completed events for chore/docs commits between v0.14.0 and v0.16.0 that bypassed the iterate flow | 0/0 | 5e086aa | compliance | 2026-05-23 |
| bug | doc-sync meta-test follows Phase 0f file-map move | 1066/1066 | bde108f | tooling | 2026-05-23 |
| change | chore(launch-prep): publish .shipwright/ SDLC documentation | 0/0 | 2265e39 | docs | 2026-05-23 |
| change | chore(launch-prep): scrub local paths, Tailscale host and IP | 0/0 | b476762 | docs | 2026-05-23 |
| change | chore(launch-prep): drop stale skill-compliance docs, fix doc path refs | 0/0 | cad4ac9 | docs | 2026-05-23 |
| change | docs(governance): add CODE_OF_CONDUCT, CONTRIBUTING, SECURITY policy | 0/0 | ab6e099 | docs | 2026-05-23 |
| change | chore(compliance): refresh commit SHAs after history rewrite | 0/0 | 265f923 | compliance | 2026-05-23 |
| change | chore(compliance): auto-regenerated artefacts include launch-prep commits | 0/0 | 0644173 | compliance | 2026-05-23 |
| change | chore(events): backfill affected_frs for 18 prior iterates (Phase 0a) | 0/0 | 34886a8 | compliance | 2026-05-23 |
| change | chore(events): backfill change_type for 4 non-FR iterates (Phase 0a) | 0/0 | e1c6a98 | compliance | 2026-05-23 |
| change | chore(compliance): auto-regenerated artefacts include Phase 0a backfill | 0/0 | d07573d | compliance | 2026-05-23 |
| change | chore(events): fix two malformed dashboard rows | 0/0 | eaeeb45 | compliance | 2026-05-23 |
| change | docs(adr): add Part I + Part II banners to decision_log (Phase 0b) | 0/0 | 6385930 | docs | 2026-05-23 |
| change | docs(adr): slim down ADR-087/088 + extract details to planning/adr (Phase 0c, PR #47) | 0/0 | c9b662b | docs | 2026-05-23 |
| change | docs(claude-md): strip Iterate annotations + slim DO-NOT guards (Phase 0e, PR #49) | 0/0 | c8a28d1 | docs | 2026-05-23 |
| change | docs(test-status): record Phase 0d FAIL-row dismissals (PR #50) | 0/0 | de956bc | compliance | 2026-05-23 |
| change | iterate finalization | 0/0 |  |  | 2026-05-23 |
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
Last run: 2026-06-04 | Unit: 1504/1504 | Smoke: n/a | (iterate)

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
