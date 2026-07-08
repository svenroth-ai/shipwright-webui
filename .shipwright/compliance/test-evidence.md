# Test Evidence Report

Generated: 2026-07-06T11:13:39.104420+00:00

## Summary

| Metric | Value |
|--------|-------|
| Total test checkpoints | 263 |
| Total unit tests (latest full suite) | 3524/3524 (2026-07-06) |
| New tests from iterations | +26 |

## Test Progression

| # | Event | Source | Layer | New Tests | Suite Total | Result | Date |
|---|-------|--------|-------|-----------|-------------|--------|------|
| 1 | Add macOS/Linux production rebuild+restart scripts (scripts/start-server-production.sh + scripts/stop-server.sh) mirroring the Windows .ps1 1:1 (install+build both halves before killing the old server; double ~/.claude.json self-heal around the restart). Pin *.sh to eol=lf so Windows-authored scripts cannot ship CRLF. Document the macOS one-step helper in docs/guide.md (sections 7 and 10) and README.md. | [iterate](traceability-matrix.md#evt-13edd7c6) | — | +0 | — | — | 2026-07-06 |
| 2 | The New Task, Iterate, Pipeline and custom-project dialogs now tuck the extra fields, parameters and command preview under a gray 'More options' bar that starts closed, so creating a task is simpler. | [iterate](traceability-matrix.md#evt-083b2011) | unit | +0 | 1819/1819 | PASS | 2026-07-06 |
| 3 | Deleting a project now also deletes its tasks, so the confusing 'Unassigned' entry no longer stays behind after you delete a project. | [iterate](traceability-matrix.md#evt-34ca637d) | unit | +0 | 3524/3524 | PASS | 2026-07-06 |
| 4 | The Add Project dialog no longer shows a Paste button; its hint now tells you to copy the folder path and paste it into the box yourself. | [iterate](traceability-matrix.md#evt-22daf83f) | unit | +0 | 1812/1812 | PASS | 2026-07-06 |
| 5 | Normalise paste-artifact surrounding quotes on filesystem paths (project.path / task.cwd) at the input boundary so the FR-01.10 launch command cd prefix is correctly single-quoted on macOS/Linux instead of the broken double-escaped cd. | [iterate](traceability-matrix.md#evt-dd0e4c80) | — | +0 | — | — | 2026-07-06 |
| 6 | Fixed the embedded terminal so long task titles no longer smear the input line. | [iterate](traceability-matrix.md#evt-7586ed62) | mixed | +0 | 1817/1817 | PASS | 2026-07-01 |
| 7 | Updated developer and build-tool dependencies to clear the security scanner's flagged advisories; the shipped application's own libraries were never affected and how the app behaves is unchanged. | [iterate](traceability-matrix.md#evt-11f1d162) | unit | +0 | 3500/3500 | PASS | 2026-06-30 |
| 8 | Remove webui .github/workflows/scorecard.yml + the Added changelog drop. Keep the A+C grade work + the methodology citation. Token-permissions + open vulns + pinned-deps tracked as triage. | [iterate](traceability-matrix.md#evt-53efed82) | — | +0 | — | — | 2026-06-30 |
| 9 | Regenerate compliance with the updated plugin (honesty gate + 29148/12207/SSDF anchors); add native scorecard.yml. Grade stays A99 — webui has no traceability decline. | [iterate](traceability-matrix.md#evt-3af4f8e4) | — | +0 | — | — | 2026-06-30 |
| 10 | E2E hardening: Task-Board header pill + graceful-absence coverage for FR-01.43 | [iterate](traceability-matrix.md#evt-a01aca38) | mixed | +0 | 1809/1809 | PASS | 2026-06-30 |
| 11 | compliance Grade badge + detail modal in WebUI | [iterate](traceability-matrix.md#evt-d3c61a35) | mixed | +0 | 3497/3497 | PASS | 2026-06-30 |
| 12 | Suppress 130 Semgrep audit-rule false positives via a root .semgrepignore (test/e2e/POC/docs) + inline nosemgrep on 8 production FP lines (pty-manager spawn ADR-067, bidi-injection-defense regex, trusted-config RegExp compiles, loopback ws); converge the compliance dashboard, GitHub code-scanning, and triage on the real near-zero finding count. | [iterate](traceability-matrix.md#evt-041ea085) | — | +0 | — | — | 2026-06-29 |
| 13 | Reconcile detective-audit B7/D3/G2/H2 post-v0.21.0: backfill event for dd7f7468 (PR #168 safeFit refactor), amend evt-2646f4da to reaffirm FR-01.42, register mobile/images conventional-commit scopes, tighten 4 bloat-baseline current LOC values. | [iterate](traceability-matrix.md#evt-51a24cfd) | — | +0 | — | — | 2026-06-29 |
| 14 | refactor(terminal): extract safeFit into safe-fit.ts to keep useTerminalResize under 300 LOC (PR #168, B7 backfill — LOC-discipline follow-up to #167 ADR-084, behavior-preserving) | [iterate](traceability-matrix.md#evt-82ac5b20) | — | +0 | — | — | 2026-06-29 |
| 15 | Light the WebUI Control-Grade Security dimension: with the dep-CVE fixes (#180) merged, the fresh main security.yml scan (#28336942429) reports 0 high/critical; refresh_ci_security (AR-10 SARIF-ingestion fallback, monorepo #291) ingests it into the tracked ci-security.json and the dashboard regenerates with Security marked OK -> Control Grade A (99/100), all 7 measurable dimensions green. | [iterate](traceability-matrix.md#evt-b6abca8d) | — | +0 | — | — | 2026-06-28 |
| 16 | Bump 7 dependencies to their Trivy-fixed versions to clear the security.yml high+medium dependency CVEs (incl. shell-quote command-injection CVE-2026-9277, react-router, hono, ws): client react-router-dom->7.18 / mermaid->11.16 / dompurify->3.4.11 / uuid->11.1.1; server hono->4.12.27 / shell-quote->1.9.0 / ws->8.21.0 (npm overrides for the transitive ones). Full suite 3464/3464 green; client+server builds clean. Lets the WebUI Control-Grade Security dimension light at 0 high/critical once re-scanned + re-ingested. | [iterate](traceability-matrix.md#evt-5d0470bb) | unit | +0 | 3464/3464 | PASS | 2026-06-28 |
| 17 | Regenerate WebUI compliance with the now-current plugin (cc1 BP-1 traced-credit, cc2 BP-2 reconciliation, cc3 AR-05 RTM Reconciled column) + reconcile: re-ran the full suite (server 1671 + client 1793 = 3464/3464 green), re-verifying the 12 behavior-touched-but-unreconciled FRs and linking that fresh verification here per BP-2 (spec_impact=none, no behavior change). Lifts the honest WebUI Control Grade from a stale-plugin B89 to A. AR-10 CI-security wiring deferred to a follow-up. | [iterate](traceability-matrix.md#evt-a8bec2dd) | unit | +0 | 3464/3464 | PASS | 2026-06-28 |
| 18 | BP-1 webui traceability backfill: classified all 245 work events (tagged 69 previously-untagged events to FRs or an explicit none_reason; closed 5 NOT-VERIFIED FRs (Group A: FR-01.05/.06/.23/.25/.27) by linking the existing work event whose changes exercised them) and freshly verified the 9 remaining NOT-VERIFIED foundational endpoints (Group B: FR-01.07/.14/.17/.18/.19/.20/.21/.22/.26) by re-running their existing route tests (server 1671 + client 1793 = 3464/3464 green) and linking that verification here. | [iterate](traceability-matrix.md#evt-944c534d) | unit | +0 | 3464/3464 | PASS | 2026-06-28 |
| 19 | CodeQL noise reduction + qCmd cmd.exe quoting fix | [iterate](traceability-matrix.md#evt-667baa47) | unit | +0 | 3463/3463 | PASS | 2026-06-27 |
| 20 | mobile modal touch-safety: iOS focus-zoom + footer 44px button symmetry | [iterate](traceability-matrix.md#evt-31471e05) | mixed | +0 | 1789/1789 | PASS | 2026-06-27 |
| 21 | Repaint the embedded terminal on every WebGL texture-atlas mutation (onChangeTextureAtlas + onAddTextureAtlasCanvas + onRemoveTextureAtlasCanvas) so cells no longer keep stale atlas coordinates after a mid-stream atlas regeneration; fixes the wrong-letter glyph corruption that previously needed a manual resize. | [iterate](traceability-matrix.md#evt-42ea8ea6) | — | +0 | — | — | 2026-06-27 |
| 22 | Disable DragOverlay drop animation so a dragged board card no longer flips back to its origin on drop | [iterate](traceability-matrix.md#evt-be31e6ba) | mixed | +0 | 1780/1780 | PASS | 2026-06-23 |
| 23 | Diagnostic: runtime renderer override (terminal-renderer.ts) read by xtermAddons.ts -- ?terminalRenderer=dom / localStorage skips the WebGL addon (DOM renderer) to A/B whether WebGL is the smear root cause on a real GPU. Default unchanged (webgl). | [iterate](traceability-matrix.md#evt-8b9af61b) | — | +0 | — | — | 2026-06-23 |
| 24 | Reopen a Done card dragged/menu-moved out of the Done column so it lands unlocked instead of stranded done+locked | [iterate](traceability-matrix.md#evt-6642b747) | mixed | +0 | 3444/3444 | PASS | 2026-06-23 |
| 25 | Embedded terminal: data-independent trailing repaint (activation-repaint.ts) clears the stale display:none->block WebGL frame on an IDLE Transcript->Terminal switch / focus restore, closing the no-data gap ADR-202 data-driven settle window left | [iterate](traceability-matrix.md#evt-939af5c3) | — | +0 | — | — | 2026-06-22 |
| 26 | Mobile/touch terminal UX: condense phone header, white-bordered touch keys, buffer-first touch-scroll at resume picker, data-driven settle-repaint for input-area smear | [iterate](traceability-matrix.md#evt-4c6d051c) | mixed | +0 | 1762/1762 | PASS | 2026-06-20 |
| 27 | start-server-production.ps1 and install-windows.ps1 run npm install before npm run build so a newly-merged dependency (@dnd-kit/core) no longer breaks the production build; autostart no longer swallows npm errors. | [iterate](traceability-matrix.md#evt-a73ab76b) | — | +0 | — | — | 2026-06-18 |
| 28 | Embedded terminal WS now reconnects on tab refocus + has a client liveness heartbeat (app-level ping/pong) so a silently-dead socket after sleep/Tailscale partition is detected and recovered instead of a stale frozen frame. | [iterate](traceability-matrix.md#evt-01f600fb) | — | +0 | — | — | 2026-06-18 |
| 29 | Task-board drag-and-drop with the board column decoupled from session state (sticky boardColumn override, schema v4, POST /tasks/:id/column, accessible Move-to menu + keydown-guard fix). | [iterate](traceability-matrix.md#evt-2646f4da) | — | +0 | — | — | 2026-06-17 |
| 30 | sync vendored gate copies to monorepo fail-closed fixes | [iterate](traceability-matrix.md#evt-c38be8a4) | unit | +0 | 75/75 | PASS | 2026-06-17 |
| 31 | launch-prep README Beta badge, issue templates & tooling | [iterate](traceability-matrix.md#evt-cf5f9f11) | — | +0 | — | — | 2026-06-17 |
| 32 | launch-prep PII scrub & repo hygiene | [iterate](traceability-matrix.md#evt-4dd9f8c2) | — | +0 | — | — | 2026-06-17 |
| 33 | editor HTML link corruption on save (FR-01.34) | [iterate](traceability-matrix.md#evt-85988543) | mixed | +0 | 1700/1700 | PASS | 2026-06-16 |
| 34 | Touch-scroll replicates the mouse/trackpad: a finger-pan dispatches a synthetic pixel-mode WheelEvent on term.element so xterm encodes the same mouse-report Claude already consumes for the mouse wheel, instead of arrow keys that Claude interpreted as input-history navigation. Supersedes ADR-132. Client-only. | [iterate](traceability-matrix.md#evt-7884a2bc) | — | +0 | — | — | 2026-06-15 |
| 35 | Fix read-only narrow replay corruption: useReplayDrainGate resizes the terminal to the snapshot cols/rows before term.write so a wide snapshot reconstructs faithfully in a narrow reader (no character interleaving). Client-only. | [iterate](traceability-matrix.md#evt-6a4edaa8) | — | +0 | — | — | 2026-06-15 |
| 36 | Phone-header polish (FR-01.41 follow-up): top-bar project dropdown content-width (not full-width); All-Projects + New cascade replaced on phone by a flat downward drill-down (ProjectCreatePhoneMenu) so the side submenu no longer overflows off-screen. Desktop/tablet unchanged. | [iterate](traceability-matrix.md#evt-442a0736) | — | +0 | — | — | 2026-06-15 |
| 37 | Trailing repaint after terminal reflow — fixes Claude input box rendering broken/wrapped/with a floating title cell after a window/monitor width change (follow-up to PR #146) | [iterate](traceability-matrix.md#evt-f46beb11) | mixed | +0 | 1672/1672 | PASS | 2026-06-15 |
| 38 | Mobile/tablet layout polish (FR-01.41): phone header — project dropdown moved into the top bar via MobileTopBarSlot portal, status filter collapsed to a funnel-icon multi-select menu (BoardStatusFilter); compact band — List launch icon-only, Projects Path column hidden, icon-rail count badge overlaid, board lanes flexible to fit all three. Desktop unchanged. | [iterate](traceability-matrix.md#evt-2caa2427) | — | +0 | — | — | 2026-06-15 |
| 39 | Repaint embedded terminal on window focus / visibility regain — fixes WebGL stale-frame smear that previously only a manual resize healed | [iterate](traceability-matrix.md#evt-c97442f3) | mixed | +0 | 1668/1668 | PASS | 2026-06-14 |
| 40 | Tablet-view polish: bidirectional sidebar rail collapse, bottom safe-area inset, greedy list Title column, terminal touch-action:none | [iterate](traceability-matrix.md#evt-7619adfd) | mixed | +0 | 1652/1652 | PASS | 2026-06-14 |
| 41 | Self-heal ~/.claude.json a second time at deploy END (post server-up), not only at Step 0 | [iterate](traceability-matrix.md#evt-0ea5c081) | unit | +0 | 38/38 | PASS | 2026-06-14 |
| 42 | Compliance detective-audit reconcile (D3/G2/H1): G2 add 'responsive' commit scope to audit_config.json g2_stoplist; D3 reaffirm promised FR-01.38/FR-01.39 via event_amended on the tablet/phone responsive iterate events (their own work_completed omitted affected_frs); H1 grandfather client/src/components/terminal/EmbeddedTerminal.tsx (311>300, ADR-097 deep module) in shipwright_bloat_baseline.json. No product code touched; D3/G2/H1 re-run FAIL->PASS. | [iterate](traceability-matrix.md#evt-efee2359) | — | +0 | — | — | 2026-06-14 |
| 43 | Reusable ActionsConfigRow (hideProjectHeader) rendered in ProjectSettingsDialog; upload.ts passes slash_command to dryRunTemplate (fixes 500); removed stale Launcher preferences card. | [iterate](traceability-matrix.md#evt-72678829) | — | +0 | — | — | 2026-06-14 |
| 44 | Phone responsive view (<768px), iterate 2 of 2: sidebar overlay drawer (Radix Dialog) below 768px; on-screen TerminalKeyBar for touch devices (Esc/Tab/Ctrl-C/arrows/Enter, writes to the pty via the existing socket.send writer frame, mode-aware CSI/SS3 arrows, writer re-check, soft-keyboard-safe); list+Projects table reflow; modal 44px touch targets; iOS safe-area + interactive-widget=resizes-content + dvh. Reuses the FR-01.38 foundation; tablet+desktop byte-identical. | [iterate](traceability-matrix.md#evt-58483137) | — | +0 | — | — | 2026-06-14 |
| 45 | Tablet responsive view (≤1023px): useIsCompactViewport SSoT; sidebar rail; board swipe carousel + list lg:-gating + campaign card hardening; task-detail persistent-PanelGroup compact Files/Session/Viewer tabs (terminal never unmounts across breakpoint); desktop ≥1024px byte-identical. Phone deferred to iterate-2. | [iterate](traceability-matrix.md#evt-536db1b3) | — | +0 | — | — | 2026-06-14 |
| 46 | Tighten shipwright_bloat_baseline.json ceiling for server/src/terminal/routes.ts (current 620 -> 509) to match post-#135 size; ADR-103 exception retained | [iterate](traceability-matrix.md#evt-a2555bc5) | unit | +0 | 1637/1637 | PASS | 2026-06-14 |
| 47 | Deploy-time self-heal of a truncation-tail-corrupt ~/.claude.json: new ops helper scripts/repair-claude-json.mjs + start-server-production.ps1 step 0 | [iterate](traceability-matrix.md#evt-fa461ee7) | unit | +0 | 24/24 | PASS | 2026-06-14 |
| 48 | buildSpawnEnv strips inherited CLAUDE_CODE_CHILD_SESSION/SESSION_ID/ENTRYPOINT/CLAUDECODE so embedded-terminal claude launches top-level and writes its <uuid>.jsonl; fixes empty Transcripts tab when the server was started from inside a Claude session. | [iterate](traceability-matrix.md#evt-1ddcfe3e) | — | +0 | — | — | 2026-06-13 |
| 49 | Correct stale .webui/actions.json -> .shipwright-webui/actions.json in live spec.md FR descriptions + acceptance criteria (post-v0.17.0 rename); regenerate traceability matrix. | [iterate](traceability-matrix.md#evt-e1825369) | — | +0 | — | — | 2026-06-13 |
| 50 | Thorough guide.md correctness audit vs code/ADRs/RTM (3 sub-agents): fix §6.1 menu location + Plain Claude sibling, §9.3 validation/placeholder/modal_fields drift, add §6.9 Campaigns lane + §6.10 file-editor docs; align server+client package.json version to 0.18.0. | [iterate](traceability-matrix.md#evt-634409d3) | — | +0 | — | — | 2026-06-13 |
| 51 | docs install audit: README production single-process install + guide §4/§7/§8 fixes + Makefile lint help/target + CLAUDE.md structure verify | [iterate](traceability-matrix.md#evt-0ceb5d70) | — | +0 | — | — | 2026-06-13 |
| 52 | Reconcile post-v0.18.0 detective audit F5: document the convention-impact drop iterate-2026-06-12-automerge-pr-review-alignment under conventions.md (## Convention Updates). B7 (commit 82021094) and G2 (scopes review/actions, then agent-docs) were already resolved on origin/main by PR #127/#129; F5 had migrated to this drop. | [iterate](traceability-matrix.md#evt-a3235e14) | unit | +0 | 1/1 | PASS | 2026-06-13 |
| 53 | Flat Campaigns-lane card (remove heavy shadow) + fix List-view right-column clipping | [iterate](traceability-matrix.md#evt-b52512c5) | mixed | +0 | 1611/1611 | PASS | 2026-06-12 |
| 54 | compliance G2/H1/H2 bloat-baseline reconcile | [iterate](traceability-matrix.md#evt-0928faf6) | unit | +0 | 1609/1609 | PASS | 2026-06-12 |
| 55 | Condense agent_docs (architecture.md + conventions.md) to ADR-anchored pointers; fix structural drift + a launchPayload ADR mislabel | [iterate](traceability-matrix.md#evt-e2c221a0) | — | +0 | — | — | 2026-06-12 |
| 56 | Reconcile post-v0.18.0 detective audit: backfill PR #124 (commit 8202109) missing work_completed event (B7) + register the actions/review conventional-commit scopes in audit_config.json g2_stoplist (G2). F5 was a stale-local-main false positive (PASS on origin/main). | [iterate](traceability-matrix.md#evt-fdbd3b9b) | unit | +0 | 3/3 | PASS | 2026-06-12 |
| 57 | Backfill (B7 reconciliation): WebUI side of routing idle-main triage status flips to the per-tree outbox (mirror of triage.py mark_status TRACKED-PREFERRED residence). shouldRouteToOutbox(projectRoot) = origin remote AND HEAD==default branch, git-probed via spawnSync, failing safe to tracked on any git error. PR #124 (commit 8202109) merged WITHOUT an F5b work_completed event or F6 Run-ID footer; this event is reconstructed from the commit to close the B7 gap. | [iterate](traceability-matrix.md#evt-b29aafce) | — | +0 | — | — | 2026-06-11 |
| 58 | Manual dismiss/restore (webui-owned board quittance) for Campaigns-board cards; selectVisible/selectDismissed partition + show-dismissed toggle; dismissed-campaigns-store + 2 POST routes + dismissed annotation. | [iterate](traceability-matrix.md#evt-3436d224) | — | +0 | — | — | 2026-06-12 |
| 59 | Migrate .github/workflows/claude-review.yml to pr-review.yml: an OpenRouter-backed Tier-3 reviewer (vendored pr_review.py + pr_review_lib.py + prompts under scripts/ci/, logic byte-identical to monorepo B4.5 Phase 2) gated by a decide-job tier filter (external author / sensitive paths .github/workflows,scripts/hooks,scripts/ci / needs-review label). Drops @anthropic-ai/claude-code + ANTHROPIC_API_KEY + the dead develop trigger. Adds an offline selftest job running 72 vendored tests. | [iterate](traceability-matrix.md#evt-6e8fbec8) | — | +0 | — | — | 2026-06-12 |
| 60 | Optional slash_command on custom actions so {task.initial_prompt} fuses slash+description into one positional; fail-loud schema validation. | [iterate](traceability-matrix.md#evt-06308665) | — | +0 | — | — | 2026-06-11 |
| 61 | Project Campaigns-board status from the tracked shipwright_events.jsonl (overlay event-confirmed completions onto dir-sourced campaigns; synthesize derivedFromEvents campaigns when the dir is absent) so gitignored campaigns surface progress on a deployed board | [iterate](traceability-matrix.md#evt-f9efd836) | — | +0 | — | — | 2026-06-11 |
| 62 | Pending-delivery badge for outbox-only triage items: GET /api/triage pendingDelivery enrichment (core/triage-enrich.ts) parity-gated against the real triage_cli.py list --json; amber badge in card+modal; CTAs unchanged; route anti-ratchet extraction 763->725. | [iterate](traceability-matrix.md#evt-0533f6ef) | — | +0 | — | — | 2026-06-10 |
| 63 | Force a full-viewport WebGL repaint on the terminal scroll input (term.onScroll + passive wheel listener, rAF-coalesced + 150ms trailing) to fix table smear (stale glyphs the partial dirty-row refresh skips). | [iterate](traceability-matrix.md#evt-620dfb6f) | — | +0 | — | — | 2026-06-09 |
| 64 | Campaigns board surfaces the live loop_state.json-derived in_progress sub-iterate as a per-step overlay on GET /api/campaigns (readLoopRunState, read once), so an autonomous build shows real-time progress instead of sitting at done/total=0/N. Only pending->in_progress; done/total/nextPending invariant. Webui-only, independent of the monorepo producer status.json write (trg-9edbab4d). | [iterate](traceability-matrix.md#evt-cb165e16) | — | +0 | — | — | 2026-06-09 |
| 65 | WebUI server-side triage reader unions tracked + per-tree gitignored outbox (two-pass, Python-parity); status flips residence-derived to avoid tracked main drift. Codex Q6 deployment verified; .gitignore outbox line propagated via self-heal. | [iterate](traceability-matrix.md#evt-88bd107e) | — | +0 | — | — | 2026-06-08 |
| 66 | Campaign attached-run guard: detect a live autonomous run (loop_state.json in_progress unit OR status.json in_progress step) and prevent a second orchestrator — client launch CTAs disable+relabel Run attached AND the server launch branches return 409 campaign_run_already_attached. | [iterate](traceability-matrix.md#evt-c59f2257) | — | +0 | — | — | 2026-06-08 |
| 67 | force full-viewport refresh after terminal replay-drain settle (clean render on open) | [iterate](traceability-matrix.md#evt-9e9290da) | unit | +0 | 1557/1557 | PASS | 2026-06-07 |
| 68 | Fix following ADR-131 / PR #110 (diagnosis). attachTouchScroll gains optional sendData callback; routeScroll helper reads term.buffer.active.type and routes alt-buffer pan to Cursor-Up/Down keystrokes via sendData (the TUI scrolls itself) and normal-buffer pan to term.scrollLines as before. EmbeddedTerminal.tsx:215 wires sendData to socket.send (same WS path term.onData uses). | [iterate](traceability-matrix.md#evt-8169fc3f) | — | +0 | — | — | 2026-06-07 |
| 69 | Diagnosis-only iterate. Added 3 vitest cases (real @xterm/xterm in jsdom) that empirically confirm DECSET 1049 flips buffer to alternate, scrollLines is no-op in alt-buffer, and current attachTouchScroll calls scrollLines unconditionally. PR #61 mock pattern could not model buffer-type semantics. No production code touched. | [iterate](traceability-matrix.md#evt-f6973f9d) | — | +0 | — | — | 2026-06-07 |
| 70 | Campaigns lane: hide done==total campaigns even on a stale active lifecycle | [iterate](traceability-matrix.md#evt-eceb87ba) | unit | +0 | 1550/1550 | PASS | 2026-06-05 |
| 71 | Event-log backfill (campaign sub-iterate A): record work_completed events for 10 pre-existing event-less direct commits (ci/security/docs/chore + 1 feat FR-01.33) so B7 (every commit accountable) clears; closes the B7 half of trg-2bce4cc6 | [iterate](traceability-matrix.md#evt-6202ed81) | — | +0 | — | — | 2026-06-05 |
| 72 | ci(security): checkout at fetch-depth 1 | [iterate](traceability-matrix.md#evt-b6f04b98) | — | +0 | — | — | 2026-06-05 |
| 73 | feat(triage): Start Campaign action — draft->active + board nav (ADR-148) | [iterate](traceability-matrix.md#evt-30ec6f25) | — | +0 | — | — | 2026-06-05 |
| 74 | ci: pin create-or-update-comment to SHA + gitleaks integrity | [iterate](traceability-matrix.md#evt-36a1e967) | — | +0 | — | — | 2026-06-05 |
| 75 | docs(ci): correct stale upload-sarif @v3 comment to @v4 | [iterate](traceability-matrix.md#evt-8c073fc7) | — | +0 | — | — | 2026-06-05 |
| 76 | ci(security): activate Security Scan on PRs + weekly | [iterate](traceability-matrix.md#evt-b1e04af8) | — | +0 | — | — | 2026-06-05 |
| 77 | ci(security): add CodeQL workflow | [iterate](traceability-matrix.md#evt-b45fa0b7) | — | +0 | — | — | 2026-06-05 |
| 78 | chore(campaign): mark 2026-05-25-bloat-cleanup-C-webui complete | [iterate](traceability-matrix.md#evt-0794f1fc) | — | +0 | — | — | 2026-06-05 |
| 79 | fix(ci): gate server type-check + correct security gate | [iterate](traceability-matrix.md#evt-717fd00d) | — | +0 | — | — | 2026-06-05 |
| 80 | fix(security): remediate vitest CVE-2026-47429 | [iterate](traceability-matrix.md#evt-8cfdb9ba) | — | +0 | — | — | 2026-06-05 |
| 81 | chore(security): allowlist sidekiq-secret false positive | [iterate](traceability-matrix.md#evt-3517a3e4) | — | +0 | — | — | 2026-06-05 |
| 82 | webui audit data/config reconcile (campaign C4): add legit scopes (board/campaigns/smartviewer/media/campaign) to g2_stoplist + event_amended FR links for reopen(FR-01.32)/create-menu(FR-01.01)/FR-01.34 same-event delivery | [iterate](traceability-matrix.md#evt-1f7088ec) | — | +0 | — | — | 2026-06-05 |
| 83 | One-click Launch (Cx) button to launch a single campaign sub-iterate via /shipwright-iterate "<specPath>" built server-side from {slug,stepId}; replaces the per-step Copy-launch clipboard button. Direct launch for ordinary steps, confirm dialog for risky ones. | [iterate](traceability-matrix.md#evt-e873eced) | — | +0 | — | — | 2026-06-04 |
| 84 | Parse the campaign Sub-Iterates table by column header and strip Markdown emphasis from cells, so bold step IDs (**C1**) and extra Repo/Depends-on columns no longer null the spec path and disable the board per-step Copy-launch button. | [iterate](traceability-matrix.md#evt-1429122a) | — | +0 | — | — | 2026-06-04 |
| 85 | Add a formatting toolbar to the SmartViewer markdown editor (FR-01.34 WYSIWYG UX completion) | [iterate](traceability-matrix.md#evt-6c3e0953) | — | +0 | — | — | 2026-06-04 |
| 86 | iterate finalization | [iterate](traceability-matrix.md#evt-eaebb2b4) | — | +0 | — | — | 2026-06-03 |
| 87 | SmartViewer inline video playback (mp4/m4v/webm/ogv/ogg/mov) via a new Range-capable /media streaming route, kept separate from the atomic /file route. | [iterate](traceability-matrix.md#evt-7c37c8cc) | — | +0 | — | — | 2026-06-03 |
| 88 | Second Campaigns-lane action: opens a TaskDetail terminal auto-running /shipwright-iterate --campaign <slug> --autonomous, gated by a confirm dialog + risky-step warning. | [iterate](traceability-matrix.md#evt-7da49dda) | — | +0 | — | — | 2026-06-03 |
| 89 | SmartViewer in-app Markdown rich editor (TipTap) + first project-file write surface: PUT /file with content-hash If-Match optimistic concurrency, mandatory pre-save diff + warn banner. | [iterate](traceability-matrix.md#evt-6985e15b) | — | +0 | — | — | 2026-06-03 |
| 90 | Triage 'Start Campaign' action (ADR-148): POST /api/campaigns/:slug/start flips draft->active via core/campaign-write.ts (atomic, lock-protected); triage items enriched with campaignSlug/campaignStatus via injected dep (triage.ts imports no campaign module); modal renders Start Campaign/Go-to-board/none + demotes Fix-now; navigates to board. Narrow relaxation of WebUI read-only-on-campaign-state. | [iterate](traceability-matrix.md#evt-156ca7b5) | — | +0 | — | — | 2026-06-03 |
| 91 | campaign-store reads top-level lifecycle status (status.json/frontmatter); selectActiveCampaigns shows iff active, legacy falls back to done<total | [iterate](traceability-matrix.md#evt-1c746044) | — | +0 | — | — | 2026-06-03 |
| 92 | CampaignLaneCard collapsible (default collapsed, persisted per-slug) + description disclosure + TaskBoardPage lane height-cap | [iterate](traceability-matrix.md#evt-0e15ddd7) | — | +0 | — | — | 2026-06-03 |
| 93 | All-Projects create-menu cascade complete: project-first + New / Plain Claude; modal scoped to chosen project (fixes action/schema mismatch). 1416 client vitest + AC1-AC6 real-browser E2E green. | [iterate](traceability-matrix.md#evt-fc7459c4) | — | +0 | — | — | 2026-06-02 |
| 94 | Read-only Campaigns lane on TaskBoardPage + GET /api/campaigns/:projectId | [iterate](traceability-matrix.md#evt-177f8389) | — | +0 | — | — | 2026-06-02 |
| 95 | Gate terminal idle-ceiling on client attachment so a watched session is never reaped; raise detached-grace 30min->12h; resume data-loss note on the ADR-104 reset banner. | [iterate](traceability-matrix.md#evt-f0f196d7) | — | +0 | — | — | 2026-06-02 |
| 96 | WS liveness keepalive complete; PR pending | [iterate](traceability-matrix.md#evt-3445c91e) | — | +0 | — | — | 2026-05-31 |
| 97 | POST /api/external/tasks/:id/reopen flips done->draft (counterpart of /backlog), session preserved; TaskCardMenu hosts the isDone-gated Re-open item | [iterate](traceability-matrix.md#evt-83b9b73f) | — | +0 | — | — | 2026-05-31 |
| 98 | SmartViewer pop-out opens a centered in-app modal (Radix Dialog) instead of window.open to a new browser tab; popOut threaded SmartViewer->MarkdownRenderer to suppress the nested control; /preview route retained. | [iterate](traceability-matrix.md#evt-ecef8b79) | — | +0 | — | — | 2026-05-31 |
| 99 | page-chrome cleanup: remove Diagnostics Launchers section and align Triage header to Inbox/Projects | [iterate](traceability-matrix.md#evt-b2bdc9ae) | mixed | +0 | 1331/1331 | PASS | 2026-05-30 |
| 100 | PR card bubble parity + open/merged status badge via gh pr view | [iterate](traceability-matrix.md#evt-2aa8923c) | mixed | +0 | 1335/1335 | PASS | 2026-05-30 |
| 101 | SmartViewer document rendering (comments/frontmatter/anchors/in-pane nav) + pop-out + page scroll | [iterate](traceability-matrix.md#evt-bc6ec43f) | mixed | +0 | 1345/1345 | PASS | 2026-05-30 |
| 102 | Render mode/pr-link/stop-hook JSONL events + intent-based useAutoScroll detach | [iterate](traceability-matrix.md#evt-126ed67f) | — | +0 | — | — | 2026-05-28 |
| 103 | TaskCard + TaskDetailHeader rendered a Build pill for iterate tasks whose title started with Fix (regex match in derivePhaseFromTitle). Centralised the resolution policy in resolveTaskPhase so new-iterate always resolves to the iterate phase when no override is persisted. | [iterate](traceability-matrix.md#evt-18779597) | — | +0 | — | — | 2026-05-27 |
| 104 | ADR-103 retirement candidate #1: extract WebSocket upgrade body from server/src/terminal/routes.ts (1013 -> 620 LOC) into ws-upgrade-handler.ts as a single cohesive buildWsHandlers(ctx: ValidatedWsUpgradeContext) function. deriveTerminalReset moved to terminal-reset.ts to break the import cycle. routes.ts retains synchronous reject-the-upgrade validations + HTTP route handlers + spawn-env factory. 29 new lifecycle/parse-table unit tests; F0.5 Node-side WS probe pass; full server vitest suite (1342 tests) green. | [iterate](traceability-matrix.md#evt-ecf57fd9) | — | +0 | — | — | 2026-05-27 |
| 105 | Fix prewarm race that armed the one-shot auto-launch guard on first WS attach | [iterate](traceability-matrix.md#evt-ceed7566) | mixed | +0 | 1274/1274 | PASS | 2026-05-26 |
| 106 | iterate finalization | [iterate](traceability-matrix.md#evt-dd475015) | — | +0 | — | — | 2026-05-26 |
| 107 | Commit C2 API contract sweep as tracked vitest suite (baseline JSON + PROBE_TABLE in-memory probes + 3 meta-tests; regression-guards external/routes.ts touch-ups in CI) | [iterate](traceability-matrix.md#evt-711a2d15) | mixed | +0 | 1279/1279 | PASS | 2026-05-26 |
| 108 | C5 EmbeddedTerminal-split E2E backfill (auto-execute + ptyReused regression fence) | [iterate](traceability-matrix.md#evt-503ee853) | mixed | +0 | 20/20 | PASS | 2026-05-26 |
| 109 | NEW .github/PULL_REQUEST_TEMPLATE.md (Superpowers anti-slop framing) + README Acknowledgments block (companion to shipwright PR #105) | [iterate](traceability-matrix.md#evt-490d6b9f) | — | +0 | — | — | 2026-05-26 |
| 110 | Split NewIssueModal.tsx (1516 LOC) into NewIssueModal/ directory with dispatcher + ModalShell + 5 mode-specific body components + shared useNewIssueForm hook (3 slices). Both bloat baseline entries removed. | [iterate](traceability-matrix.md#evt-348e51b8) | unit | +0 | 1124/1124 | PASS | 2026-05-26 |
| 111 | Campaign C / C6 — Split TaskDetailHeader.tsx (1015 LOC) into 222-LOC shell + 7 sub-components. | [iterate](traceability-matrix.md#evt-b1759173) | — | +0 | — | — | 2026-05-26 |
| 112 | iterate finalization | [iterate](traceability-matrix.md#evt-91e68d98) | — | +0 | — | — | 2026-05-25 |
| 113 | evt-956e1c71 | [iterate](traceability-matrix.md#evt-956e1c71) | unit | +14 | 14/14 | PASS | 2026-05-25 |
| 114 | Sub-iterate C1 (verification) of Campaign 2026-05-25-bloat-cleanup-C-webui. CLAUDE.md is 197 LOC on origin/main and not in shipwright_bloat_baseline.json — Phase 0f compliance-hygiene cleanup (PR #55, commit f4d52fd) organically delivered the target. Reframed C1 as Verification Iterate: pytest probe (2 assertions) + ADR-100 + existing client doc-sync vitest guard (20 cases). No edit to CLAUDE.md. | [iterate](traceability-matrix.md#evt-425538a1) | unit | +2 | 22/22 | PASS | 2026-05-25 |
| 115 | Backfill 14 work_completed events for chore/docs commits between v0.14.0 and v0.16.0 that bypassed the iterate flow | [iterate](traceability-matrix.md#evt-994b3a6e) | — | +0 | — | — | 2026-05-23 |
| 116 | doc-sync meta-test follows Phase 0f file-map move | [iterate](traceability-matrix.md#evt-efb0e1e3) | unit | +0 | 1066/1066 | PASS | 2026-05-23 |
| 117 | chore(launch-prep): publish .shipwright/ SDLC documentation | [iterate](traceability-matrix.md#evt-5be61962) | — | +0 | — | — | 2026-05-23 |
| 118 | chore(launch-prep): scrub local paths, Tailscale host and IP | [iterate](traceability-matrix.md#evt-9da1a669) | — | +0 | — | — | 2026-05-23 |
| 119 | chore(launch-prep): drop stale skill-compliance docs, fix doc path refs | [iterate](traceability-matrix.md#evt-0e23fcba) | — | +0 | — | — | 2026-05-23 |
| 120 | docs(governance): add CODE_OF_CONDUCT, CONTRIBUTING, SECURITY policy | [iterate](traceability-matrix.md#evt-370f608f) | — | +0 | — | — | 2026-05-23 |
| 121 | chore(compliance): refresh commit SHAs after history rewrite | [iterate](traceability-matrix.md#evt-74fbd5d2) | — | +0 | — | — | 2026-05-23 |
| 122 | chore(compliance): auto-regenerated artefacts include launch-prep commits | [iterate](traceability-matrix.md#evt-0b62ee17) | — | +0 | — | — | 2026-05-23 |
| 123 | chore(events): backfill affected_frs for 18 prior iterates (Phase 0a) | [iterate](traceability-matrix.md#evt-ca9624a1) | — | +0 | — | — | 2026-05-23 |
| 124 | chore(events): backfill change_type for 4 non-FR iterates (Phase 0a) | [iterate](traceability-matrix.md#evt-ebf5d36a) | — | +0 | — | — | 2026-05-23 |
| 125 | chore(compliance): auto-regenerated artefacts include Phase 0a backfill | [iterate](traceability-matrix.md#evt-2578ce68) | — | +0 | — | — | 2026-05-23 |
| 126 | chore(events): fix two malformed dashboard rows | [iterate](traceability-matrix.md#evt-b6aa615c) | — | +0 | — | — | 2026-05-23 |
| 127 | docs(adr): add Part I + Part II banners to decision_log (Phase 0b) | [iterate](traceability-matrix.md#evt-8c5ef43b) | — | +0 | — | — | 2026-05-23 |
| 128 | docs(adr): slim down ADR-087/088 + extract details to planning/adr (Phase 0c, PR #47) | [iterate](traceability-matrix.md#evt-f71e1d72) | — | +0 | — | — | 2026-05-23 |
| 129 | docs(claude-md): strip Iterate annotations + slim DO-NOT guards (Phase 0e, PR #49) | [iterate](traceability-matrix.md#evt-b30cae9e) | — | +0 | — | — | 2026-05-23 |
| 130 | docs(test-status): record Phase 0d FAIL-row dismissals (PR #50) | [iterate](traceability-matrix.md#evt-b2af341a) | — | +0 | — | — | 2026-05-23 |
| 131 | iterate finalization | [iterate](traceability-matrix.md#evt-e7894010) | — | +0 | — | — | 2026-05-23 |
| 132 | compliance documentation hygiene Phase 0f (F4-F7) | [iterate](traceability-matrix.md#evt-980292eb) | — | +0 | — | — | 2026-05-22 |
| 133 | triage Fix-now pre-selects the triage item's project in NewIssueModal | [iterate](traceability-matrix.md#evt-86356188) | unit | +0 | 2198/2198 | PASS | 2026-05-22 |
| 134 | SPA fallback for /triage, /inbox & friends (Hono server) | [iterate](traceability-matrix.md#evt-663ee6f3) | unit | +0 | 1174/1174 | PASS | 2026-05-22 |
| 135 | VERIFICATION: bug+change-type — should pass | [iterate](traceability-matrix.md#evt-6ca6247c) | — | +0 | — | — | 2026-05-21 |
| 136 | VERIFICATION: with affected-frs — should pass | [iterate](traceability-matrix.md#evt-904b92f3) | — | +0 | — | — | 2026-05-21 |
| 137 | triage Fix-now opens NewIssueModal pre-populated + namespace 4 phase slashes (+ FR-01.30 spec follow-up) | [iterate](traceability-matrix.md#evt-4af079b7) | mixed | +0 | 2193/2193 | PASS | 2026-05-21 |
| 138 | triage Fix-now opens NewIssueModal pre-populated + namespace 4 phase slashes | [iterate](traceability-matrix.md#evt-f7dbb0e8) | mixed | +0 | 2193/2193 | PASS | 2026-05-21 |
| 139 | fix-terminal-flicker-on-closed-task | [iterate](traceability-matrix.md#evt-a6586f12) | mixed | +0 | 2184/2184 | PASS | 2026-05-21 |
| 140 | triage-launch-surface-webui (launchPayload + Fix-now) | [iterate](traceability-matrix.md#evt-45adf0de) | mixed | +0 | 2189/2189 | PASS | 2026-05-20 |
| 141 | adopt oxlint as the project linter + env-isolate the server CORS test | [iterate](traceability-matrix.md#evt-0036a610) | unit | +0 | 2135/2135 | PASS | 2026-05-19 |
| 142 | Inbox card markdown rendering + fade-clip + spacing | [iterate](traceability-matrix.md#evt-3d1274f6) | mixed | +0 | 979/979 | PASS | 2026-05-19 |
| 143 | triage promote carries the brief into the launched run (actionId + newline flatten) | [iterate](traceability-matrix.md#evt-058d9da0) | mixed | +0 | 1156/1156 | PASS | 2026-05-19 |
| 144 | fix triage promote: carry item.detail into the promoted task description | [iterate](traceability-matrix.md#evt-d508eaff) | unit | +0 | 1155/1155 | PASS | 2026-05-19 |
| 145 | fix --name double-quoting in bundled launch templates via the {task.session_name} placeholder | [iterate](traceability-matrix.md#evt-223eadce) | unit | +0 | 1152/1152 | PASS | 2026-05-18 |
| 146 | inbox-terminal-prompts: surface waiting terminal pickers + focus terminal on Inbox click | [iterate](traceability-matrix.md#evt-7c294eb7) | mixed | +0 | 2062/2062 | PASS | 2026-05-18 |
| 147 | fix launch command dropping the persisted task description on Resume / non-modal launches | [iterate](traceability-matrix.md#evt-fb2b90ee) | unit | +0 | 1123/1123 | PASS | 2026-05-18 |
| 148 | terminal keyboard copy/paste with multi-line paste fidelity | [iterate](traceability-matrix.md#evt-a2176c74) | mixed | +0 | 970/970 | PASS | 2026-05-18 |
| 149 | terminal cursor flicker on remount — restore DECTCEM (?25) cursor visibility in headless-mirror replay snapshots | [iterate](traceability-matrix.md#evt-46a2b722) | unit | +0 | 2045/2045 | PASS | 2026-05-18 |
| 150 | edit-task-dialog: Edit Task dialog with lifecycle-gated field editability | [iterate](traceability-matrix.md#evt-40acd669) | mixed | +0 | 2042/2042 | PASS | 2026-05-18 |
| 151 | move-to-backlog — POST /api/external/tasks/:id/backlog + Move-to-Backlog menu items + draft-sticky transcript guard + Resume-vs-Launch fix (rebased onto origin/main afb4dc1) | [iterate](traceability-matrix.md#evt-c5df348e) | mixed | +0 | 1985/1985 | PASS | 2026-05-17 |
| 152 | move-to-backlog — POST /api/external/tasks/:id/backlog + Move-to-Backlog menu items + draft-sticky transcript guard + Resume-vs-Launch fix | [iterate](traceability-matrix.md#evt-218c0d5d) | mixed | +0 | 1994/1994 | PASS | 2026-05-17 |
| 153 | Resume guard survives a browser reload — ptyReused ready-envelope flag arms the one-shot inject guard on a reused pty | [iterate](traceability-matrix.md#evt-c65151e1) | mixed | +0 | 1939/1940 | PASS (1 skipped) | 2026-05-17 |
| 154 | Remove orphaned Resume-CTA liveness-gate code (getLastPtyDataAt/isAltBufferActive/altScreenActive/lastPtyDataAt) — dead since PR #29; eliminates a flaky CI test | [iterate](traceability-matrix.md#evt-4e316884) | unit | +0 | 1935/1935 | PASS | 2026-05-17 |
| 155 | Production build copies non-TS runtime assets into dist/ (fixes /actions HTTP 500) | [iterate](traceability-matrix.md#evt-47dcdcdf) | unit | +0 | 1069/1069 | PASS | 2026-05-16 |
| 156 | Remove Resume-CTA activity gate; one-shot inject guard; Copy Resume command; fix Copy session UUID | [iterate](traceability-matrix.md#evt-326d21d3) | unit | +0 | 1948/1948 | PASS | 2026-05-16 |
| 157 | terminal-smear-interleave — replay drain gate eliminates the embedded-terminal reattach smear (Bug B); ADR-099 WebGL atlas machinery removed | [iterate](traceability-matrix.md#evt-6eaeb99e) | mixed | +0 | 892/892 | PASS | 2026-05-16 |
| 158 | evt-70d06e02 | [iterate](traceability-matrix.md#evt-70d06e02) | — | +0 | — | — | 2026-05-15 |
| 159 | terminal-smear-reset — replay-snapshot remount smear fix (term.write callback) + WS reset banner | [iterate](traceability-matrix.md#evt-6927da85) | unit | +0 | 1885/1885 | PASS | 2026-05-15 |
| 160 | close-task-redirect — Close task in TaskDetail header now redirects to the task board | [iterate](traceability-matrix.md#evt-0f78d991) | unit | +0 | 857/857 | PASS | 2026-05-15 |
| 161 | triage-card-styling — white-surface cards + wizard-matched dialogs | [iterate](traceability-matrix.md#evt-eba3538b) | mixed | +0 | 855/855 | PASS | 2026-05-15 |
| 162 | docs(guide): document SHIPWRIGHT_NETWORK_PROFILE + .env.local workflow | backfill-retro | — | — | — | — | 2026-05-10 |
| 163 | fix(client): accept MagicDNS hostnames in Vite allowedHosts for tailscale profile | backfill-retro | — | — | — | — | 2026-05-10 |
| 164 | fix(server): wire SHIPWRIGHT_NETWORK_PROFILE into Trusted-Origin policy | backfill-retro | — | — | — | — | 2026-05-10 |
| 165 | fix(cli-compat): use platform-aware path module in selfHealClaudePath | backfill-retro | — | — | — | — | 2026-05-11 |
| 166 | Merge pull request #8 from svenroth-ai/fix/cli-compat-cross-platform-path | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 167 | fix(server,test): wire boot-time Trusted-Origin policy into WS upgrade gate (ADR-083) | backfill-retro | — | — | — | — | 2026-05-11 |
| 168 | Merge iterate/v0.9.1-tailscale-ws-real-browser-fix | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 169 | chore(workflows): drop dormant security + claude-review workflows from monorepo templates | backfill-retro | — | — | — | — | 2026-05-11 |
| 170 | Merge pull request #9 from svenroth-ai/chore/scaffold-security-and-claude-review-workflows | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 171 | chore(security): sync security.yml from monorepo (codeql v4 + continue-on-error) | backfill-retro | — | — | — | — | 2026-05-11 |
| 172 | Merge pull request #10 from svenroth-ai/chore/security-workflow-v4-and-private-repo-support | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 173 | Merge iterate/v0.9.2-embedded-terminal-mount-races (ADR-084) | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 174 | Merge branch 'main' of https://github.com/svenroth-ai/shipwright-webui | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 175 | Merge iterate/v0.9.3-resume-state-machine (ADR-085) | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 176 | Merge iterate/v0.9.4-skip-replay-newplain (ADR-086) | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 177 | feat(server): wire @xterm/headless mirror behind feature flag (ADR-088 Iterate A) | backfill-retro | — | — | — | — | 2026-05-11 |
| 178 | feat(server,client): replay_snapshot envelope + flag flip + snapshot-store hardening (ADR-089) | backfill-retro | — | — | — | — | 2026-05-11 |
| 179 | refactor(terminal): retire ADR-069/077/079/086 compensations; snapshot-only replay (ADR-087) | backfill-retro | — | — | — | — | 2026-05-12 |
| 180 | docs(terminal): sweep stale chunked-replay references post-ADR-087 (campaign code-review follow-up) | backfill-retro | — | — | — | — | 2026-05-12 |
| 181 | Merge iterate/headless-A-mirror-flag (ADR-088 — campaign headless-terminal-refactor A) | backfill-merge-retro | — | — | — | — | 2026-05-12 |
| 182 | Merge iterate/headless-B-snapshot-protocol (ADR-089 — campaign headless-terminal-refactor B) | backfill-merge-retro | — | — | — | — | 2026-05-12 |
| 183 | Merge iterate/headless-C-retire-compensations (ADR-087 — campaign headless-terminal-refactor C; supersedes ADR-069/077/079/086) | backfill-merge-retro | — | — | — | — | 2026-05-12 |
| 184 | fix(server): mark @xterm/headless fixture as binary; pin LF-normalized size | backfill-retro | — | — | — | — | 2026-05-12 |
| 185 | fix(server): live-pty replay via serialize-on-attach + snapshot-on-detach (ADR-092) | backfill-retro | — | — | — | — | 2026-05-12 |
| 186 | docs(server,test): sweep stale disk-first comment + tighten cursor axis assertion (E code-review follow-up) | backfill-retro | — | — | — | — | 2026-05-12 |
| 187 | Merge iterate/headless-E-live-pty-snapshot-fix (ADR-092 — closes ADR-091 live-pty replay regression) | backfill-merge-retro | — | — | — | — | 2026-05-12 |
| 188 | Merge iterate/headless-F-xterm-config-vorbild-align (ADR-093 — xterm.js Vorbild-Alignment for in-session status-pane stacking fix) | backfill-merge-retro | — | — | — | — | 2026-05-13 |
| 189 | Merge iterate/headless-G-flicker-env-and-resume-gating (ADR-095 — Claude TUI flicker env + Resume button gating) | backfill-merge-retro | — | — | — | — | 2026-05-13 |
| 190 | Merge iterate/headless-H-snapshot-preservation-taskcard-gating (ADR-096 — finalizeMirrorSnapshot preservation heuristic + TaskCard Resume gating) | backfill-merge-retro | — | — | — | — | 2026-05-13 |
| 191 | refactor(client,server): upgrade xterm.js 5.5.0 -> 6.0.0 (ADR-097) | backfill-retro | — | — | — | — | 2026-05-13 |
| 192 | test(e2e): migrate readXtermRows helper from DOM-locator to buffer-peek | backfill-retro | — | — | — | — | 2026-05-13 |
| 193 | Merge iterate/xterm-6-upgrade (ADR-097 — xterm.js 5.5.0 → 6.0.0; amends ADR-088 pin + ADR-095 NO_FLICKER default) | backfill-merge-retro | — | — | — | — | 2026-05-13 |
| 194 | refactor(client): refresh NewIssueModal copy to match auto-execute flow | backfill-retro | — | — | — | — | 2026-05-13 |
| 195 | Merge iterate/refresh-newissue-tooltips — NewIssueModal copy aligned to auto-execute embedded-terminal flow (ADR-068-A1) | backfill-merge-retro | — | — | — | — | 2026-05-13 |
| 196 | Merge iterate/headless-J-restore-no-flicker-default (ADR-098 — restore NO_FLICKER default after empirical Claude #37283 finding) | backfill-merge-retro | — | — | — | — | 2026-05-13 |
| 197 | feat(client): surface Resume CTA on state=active when pty is gone | backfill-retro | — | — | — | — | 2026-05-14 |
| 198 | fix(client): drop liveSession gating — Resume CTA always shows on idle/active | backfill-retro | — | — | — | — | 2026-05-14 |
| 199 | fix(server): refine new-plain Resume gate — emit --resume when JSONL exists | backfill-retro | — | — | — | — | 2026-05-14 |
| 200 | feat(server,client): introduce altScreenActive — hide Resume while TUI is foregrounded | backfill-retro | — | — | — | — | 2026-05-14 |
| 201 | Merge pull request #11 from svenroth-ai/iterate/resume-cta-active-state | backfill-merge-retro | — | — | — | — | 2026-05-14 |
| 202 | fix(terminal): WebGL load-order + rescaleOverlappingGlyphs (ADR-099) | backfill-retro | — | — | — | — | 2026-05-14 |
| 203 | Merge pull request #12 from svenroth-ai/iterate/codex-rescue-altscreen-rendering | backfill-merge-retro | — | — | — | — | 2026-05-14 |
| 204 | docs(guide): align launch flow to embedded-terminal auto-execute | backfill-retro | — | — | — | — | 2026-05-14 |
| 205 | docs(client): drop stale "nothing copies" from Save-to-Backlog tooltip | backfill-retro | — | — | — | — | 2026-05-14 |
| 206 | docs(claude-md): align WHAT/Architecture rules to embedded-terminal auto-execute + close Structure drift | backfill-retro | — | — | — | — | 2026-05-14 |
| 207 | docs(changelog): add two unreleased drops for CLAUDE.md alignment + Structure drift fix | backfill-retro | — | — | — | — | 2026-05-14 |
| 208 | Merge pull request #13 from svenroth-ai/docs/launch-flow-and-tooltip-alignment | backfill-merge-retro | — | — | — | — | 2026-05-14 |
| 209 | feat(wizard): render stack-profile step dynamically from /api/profiles | backfill-retro | — | — | — | — | 2026-05-14 |
| 210 | Merge pull request #15 from svenroth-ai/iterate/lead-foundation-task-schema | backfill-merge-retro | — | — | — | — | 2026-05-14 |
| 211 | feat(triage): WebUI Triage Tab + Promote bridge (FR-01.30, ADR-101) | backfill-retro | — | — | — | — | 2026-05-15 |
| 212 | docs(readme): add Triage tab section (FR-01.30, ADR-101) | backfill-retro | — | — | — | — | 2026-05-15 |
| 213 | Merge pull request #16 from svenroth-ai/iterate/post-merge-resume-gate-and-replay-smear | backfill-merge-retro | — | — | — | — | 2026-05-15 |
| 214 | Merge pull request #17 from svenroth-ai/iterate/triage-tab | backfill-merge-retro | — | — | — | — | 2026-05-15 |
| 215 | Iterate M (Resume CTA active-state followup) + ADR-099 v10 (post-replay maintenance) | iterate-M-retro | — | — | — | — | 2026-05-15 |
| 216 | Merge PR #14: Iterate K v1-v9 (xterm.js 6.0 atlas-corruption workaround) | iterate-K-merge-retro | — | — | — | — | 2026-05-14 |
| 217 | Iterate K v9: post-launch-settle backstop (4s after consumeLaunch) for Resume-click-in-long-mounted-tab | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 218 | Iterate K: ?atlasMaintenance=off kill switch + A/B regression probes (stills + video) | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 219 | Iterate K v8: DOM wheel listener (Tabby pattern) + 10-scenario systematic Playwright probe | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 220 | Iterate K v7: pre-init lastWriteTime + post-mount-settle backstop | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 221 | Iterate K cherry-pick: D-e2e task-type matrix | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 222 | Iterate K Vite WS proxy: swallow ECONNRESET/ECONNABORTED/EPIPE | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 223 | Iterate K v6: burst-after-2s-quiet trigger via onWriteParsed | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 224 | Iterate K v5: split main = clear+refresh, alt = refresh-only | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 225 | Iterate K v4: skip atlas-clear in alt-screen buffer | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 226 | Iterate K v3: conditional via onWriteParsed counter (skip when idle) | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 227 | Iterate K v2: 10s periodic + term.refresh() after clear | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 228 | Iterate K v1: 30s periodic clearTextureAtlas + onScroll | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 229 | server-side ?1006h re-emit in replay-snapshot envelope (Iterate K) | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 230 | leadwright Phase 1 ExternalTask extension (13 optional fields) | [iterate](traceability-matrix.md#evt-50e36386) | unit | +0 | 1780/1780 | PASS | 2026-05-14 |
| 231 | Restore CLAUDE_CODE_NO_FLICKER=1 default (ADR-098 - Iterate J) | iterate-runner | unit | +1720 | 1720/1720 | PASS | 2026-05-13 |
| 232 | Iterate H — Snapshot preservation on pty death + TaskCard Resume gating (ADR-096) | [iterate](traceability-matrix.md#evt-34871d4b) | unit | +10 | 1717/1717 | PASS | 2026-05-13 |
| 233 | Iterate G — Claude TUI flicker env + Resume button gating (ADR-095) | iterate-G | unit | +1707 | 1707/1707 | PASS | 2026-05-13 |
| 234 | dynamic-stack-profiles: wizard step 2 renders from /api/profiles + bundled snapshot refresh (ADR-094) | [iterate](traceability-matrix.md#evt-0c3127ae) | mixed | +0 | 786/786 | PASS | 2026-05-12 |
| 235 | Iterate F headless-terminal-refactor: xterm.js convertEol+allowProposedApi+scrollback alignment + WebglAddon try/catch fallback; follow-on to ADR-092 for in-session status-pane redraw stacking (ADR-093) | [iterate](traceability-matrix.md#evt-f4f7c7c5) | unit | +0 | 777/777 | PASS | 2026-05-12 |
| 236 | v0.9.4 skip disk-scrollback replay on attach for new-plain tasks (Claude TUI byte-stacking corruption fix; ADR-086) | [iterate](traceability-matrix.md#evt-ad7e40be) | mixed | +0 | 1636/1636 | PASS | 2026-05-11 |
| 237 | v0.9.3 resume state-machine: scope active→idle JSONL-mtime decay to non-new-plain (ADR-085) | [iterate](traceability-matrix.md#evt-6c0184ba) | mixed | +0 | 1636/1636 | PASS | 2026-05-11 |
| 238 | v0.9.2 embedded terminal mount races: 1500ms readOnly banner grace + safeFit/disposedRef/_renderService dimensions stub (ADR-084) | [iterate](traceability-matrix.md#evt-a797af95) | mixed | +0 | 1631/1631 | PASS | 2026-05-11 |
| 239 | env-local-loading-fix: tsx --env-file-if-exists for server + loadEnv with envDir for Vite. Closes ADR-081 wiring gap. ADR-082. | [iterate](traceability-matrix.md#evt-44b89157) | unit | +0 | 1606/1606 | PASS | 2026-05-10 |
| 240 | network-profile-flag: SHIPWRIGHT_NETWORK_PROFILE env-flag (local/tailscale/open) unifies Vite + Hono dev-server bind. Tailscale auto-detect via subprocess + env override. Closes Vite-proxy gap when Hono binds non-loopback. ADR-081. | [iterate](traceability-matrix.md#evt-5c8a15ea) | unit | +0 | 1586/1586 | PASS | 2026-05-10 |
| 241 | tsc-baseline-fix: retire 4 documented tsc baseline errors (3x cross-package imports + missing @types/proper-lockfile). server npm run build exits 0; install-windows.ps1 step [3/4] runs clean. Type mirrors under server/src/types/ + comment-aware drift-guard test. ADR-080. | [iterate](traceability-matrix.md#evt-ea0d6033) | unit | +0 | 1508/1508 | PASS | 2026-05-09 |
| 242 | v0.8.9 replay-pushdown: live shell at viewport top after replay-on-attach (FR-01.28 v0.8.9 AC-1) | [iterate](traceability-matrix.md#evt-89ce2e8a) | mixed | +0 | 1500/1500 | PASS | 2026-05-09 |
| 243 | HONO_HOST opt-in: backend default-binds loopback, opt-in for non-loopback | [iterate](traceability-matrix.md#evt-909d149c) | unit | +0 | 8/8 | PASS | 2026-05-07 |
| 244 | HONO_HOST opt-in: backend default-binds loopback, opt-in for non-loopback | [iterate](traceability-matrix.md#evt-a160f564) | unit | +0 | 8/8 | PASS | 2026-05-07 |
| 245 | VITE_HOST opt-in for LAN/Tailscale dev-server access | [iterate](traceability-matrix.md#evt-b021ddde) | unit | +0 | 7/7 | PASS | 2026-05-07 |
| 246 | v0.8.2 follow-up: disclosure null-handling fix, Show-ignored toggle rename, Spec 79 live-browser smoke (5 tests covering AC-2/4/7/8/9). 1399/1399 unit + 37/37 e2e green. | [iterate](traceability-matrix.md#evt-39a716fa) | mixed | +0 | 1399/1399 | PASS | 2026-05-06 |
| 247 | v0.8.2 polish — Spec 74 modal flake (AC-1) + xterm dark theme for Claude TUI legibility (AC-2) + Ctrl+V parity (AC-3) + image-paste latency reduction (AC-4) + awaiting-launch diag logs (AC-5) + paste-dir migration to .shipwright-webui/pastes/ (AC-6) + replay-only mode for done/launch_failed tasks (AC-7) + conditional disclosure footer (AC-8) + retention copy interpolation (AC-9). 1398/1398 unit + 33/33 e2e green. ADR-070. | [iterate](traceability-matrix.md#evt-fcfee60e) | mixed | +0 | 1398/1398 | PASS | 2026-05-06 |
| 248 | Post-v0.8 stabilization (Tier 0): AC-1 scrollback ANSI sanitizer + AC-3 per-conn pause refcount + writer-stuck watchdog. AC-2 deferred to follow-up. ADR-069. 1369/1369 unit tests green. | [iterate](traceability-matrix.md#evt-cb4d9fa6) | unit | +0 | 1369/1369 | PASS | 2026-05-05 |
| 249 | Embedded-terminal auto-launch + disk-backed scrollback persistence (ADR-068-A1) — clipboard-free one-click Launch via LaunchCoordinatorContext + WS data-frame; pty.onData appends to <scrollbackDir>/<taskId>.log via fs.appendFileSync with 3-state rotation; replay-on-attach with pty.pause/resume + chunked envelopes; new POST /clear-scrollback + Stop terminal session + Clear history modal; privacy disclosure footer. | [iterate](traceability-matrix.md#evt-40d7b72c) | unit | +0 | 1320/1320 | PASS | 2026-05-04 |
| 250 | Embedded terminal launcher (ADR-067) — Phase 6.1 fixes after second external code-review pass + live integration smoke. CRITICAL: ESM require bug broke every WS upgrade; Vite proxy missing ws:true; header CTA missing webui:launch-copied dispatch. Plus task.cwd realpath validation, paste-image auto-spawn, Content-Length missing/invalid handling, empty-text-paste path, paste-image error toast, browser-level paste E2E. 1273 unit + 12 Playwright tests green against real Chromium + Hono + xterm + node-pty. | [iterate](traceability-matrix.md#evt-c9e4d4b4) | mixed | +0 | 1285/1285 | PASS | 2026-05-04 |
| 251 | Embedded terminal launcher (ADR-067) — Phase 6 post-code-review hardening: writer-conn idempotency (CRITICAL); /append-gitignore 404 ordering; /paste-image writer-gate; Origin gate; second-attach envelope; toast-error UX; browser-level paste-event E2E. 1273/1273 tests green. | [iterate](traceability-matrix.md#evt-634b8c4a) | unit | +0 | 1273/1273 | PASS | 2026-05-03 |
| 252 | Embedded terminal launcher (xterm.js + node-pty + WebSocket image-paste flow) — Plan-D''-conform shell pane in TaskDetail; replaces external-terminal-only launches; closes Anthropic claude-cli image-paste gap (Issue #51244); ADR-067. | [iterate](traceability-matrix.md#evt-672b7ac9) | unit | +0 | 1269/1269 | PASS | 2026-05-03 |
| 253 | Persistent virtualizer measurement cache + cold-cache warmup pass (5th attempt at slow-scroll jump; ADR-066) — merge to main | [iterate](traceability-matrix.md#evt-63a24776) | unit | +0 | 657/657 | PASS | 2026-05-02 |
| 254 | Persistent virtualizer measurement cache + cold-cache warmup pass (5th attempt at slow-scroll jump; ADR-066) | [iterate](traceability-matrix.md#evt-3d7bab8e) | unit | +0 | 657/657 | PASS | 2026-05-02 |
| 255 | filter null-rendering events out of virtualized transcript (ADR-065; rapid-scroll partial fix; slow-scroll deferred to follow-up) | [iterate](traceability-matrix.md#evt-67fc7571) | unit | +0 | 640/640 | PASS | 2026-05-02 |
| 256 | useTaskTranscript polling cascade fix (residual scroll-up flicker) | [iterate](traceability-matrix.md#evt-c36275c2) | unit | +0 | 635/635 | PASS | 2026-05-01 |
| 257 | overflow-anchor virtualized carve-out (scroll-up flicker root cause) | [iterate](traceability-matrix.md#evt-f6239468) | unit | +0 | 634/634 | PASS | 2026-05-01 |
| 258 | virtualizer flicker fix (merge) | [iterate](traceability-matrix.md#evt-1d82d470) | unit | +0 | 632/632 | PASS | 2026-05-01 |
| 259 | virtualizer flicker fix | [iterate](traceability-matrix.md#evt-2b5c611e) | unit | +0 | 632/632 | PASS | 2026-05-01 |
| 260 | system chips alignment + scroll polish (merge) | [iterate](traceability-matrix.md#evt-e8374408) | unit | +0 | 632/632 | PASS | 2026-05-01 |
| 261 | system chips alignment + scroll polish | [iterate](traceability-matrix.md#evt-8063cac5) | unit | +0 | 632/632 | PASS | 2026-05-01 |
| 262 | task-notification rendering | [iterate](traceability-matrix.md#evt-2ab2142e) | unit | +0 | 624/624 | PASS | 2026-05-01 |
| 263 | VS Code .code-workspace auto-generated on POST /api/projects | [iterate](traceability-matrix.md#evt-b81d5d5e) | unit | +0 | 537/537 | PASS | 2026-05-01 |

## Full Suite Runs

_Synthesized from per-iterate **unit** results — Integration / pgTAP / E2E / Smoke read `—` because no `test_run` events (the only source of a full layer breakdown) are recorded; an empty column means the breakdown is unavailable, not that a layer failed._

| Run | Trigger | Unit | Integration | pgTAP | E2E | Smoke | Date |
|-----|---------|------|-------------|-------|-----|-------|------|
| 1 | iterate | 1331/1331 | — | — | — | — | 2026-05-30 |
| 2 | iterate | 1550/1550 | — | — | — | — | 2026-06-05 |
| 3 | iterate | 1557/1557 | — | — | — | — | 2026-06-07 |
| 4 | iterate | 3/3 | — | — | — | — | 2026-06-12 |
| 5 | iterate | 1609/1609 | — | — | — | — | 2026-06-12 |
| 6 | iterate | 1611/1611 | — | — | — | — | 2026-06-12 |
| 7 | iterate | 1/1 | — | — | — | — | 2026-06-13 |
| 8 | iterate | 24/24 | — | — | — | — | 2026-06-14 |
| 9 | iterate | 1637/1637 | — | — | — | — | 2026-06-14 |
| 10 | iterate | 38/38 | — | — | — | — | 2026-06-14 |
| 11 | iterate | 1652/1652 | — | — | — | — | 2026-06-14 |
| 12 | iterate | 1668/1668 | — | — | — | — | 2026-06-14 |
| 13 | iterate | 1672/1672 | — | — | — | — | 2026-06-15 |
| 14 | iterate | 1700/1700 | — | — | — | — | 2026-06-16 |
| 15 | iterate | 75/75 | — | — | — | — | 2026-06-17 |
| 16 | iterate | 1762/1762 | — | — | — | — | 2026-06-20 |
| 17 | iterate | 3444/3444 | — | — | — | — | 2026-06-23 |
| 18 | iterate | 1780/1780 | — | — | — | — | 2026-06-23 |
| 19 | iterate | 1789/1789 | — | — | — | — | 2026-06-27 |
| 20 | iterate | 3463/3463 | — | — | — | — | 2026-06-27 |
| 21 | iterate | 3464/3464 | — | — | — | — | 2026-06-28 |
| 22 | iterate | 3464/3464 | — | — | — | — | 2026-06-28 |
| 23 | iterate | 3464/3464 | — | — | — | — | 2026-06-28 |
| 24 | iterate | 3497/3497 | — | — | — | — | 2026-06-30 |
| 25 | iterate | 1809/1809 | — | — | — | — | 2026-06-30 |
| 26 | iterate | 3500/3500 | — | — | — | — | 2026-06-30 |
| 27 | iterate | 1817/1817 | — | — | — | — | 2026-07-01 |
| 28 | iterate | 1812/1812 | — | — | — | — | 2026-07-06 |
| 29 | iterate | 3524/3524 | — | — | — | — | 2026-07-06 |
| 30 | iterate | 1819/1819 | — | — | — | — | 2026-07-06 |

## Code Review Evidence

| Event | Review Type | Findings | Fixed | Status |
|-------|------------|----------|-------|--------|
| evt-956e1c71 | self+skipped-cascade-doc-only | 0 | 0 | PASS |

