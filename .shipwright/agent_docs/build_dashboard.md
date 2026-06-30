# Project Activity Dashboard
> Updated: 2026-06-30 19:23 UTC | Session: 998fb4e1-d677-4d0a-89cf-cec4a7c4a6ee | Run: iterate-2026-06-30-remove-native-scorecard

## Recent Changes (186 iterations)

| Type | Description | Tests | Commit | FRs | Date |
|------|-------------|-------|--------|-----|------|
| change | Remove webui .github/workflows/scorecard.yml + the Added changelog drop. Keep the A+C grade work + the methodology citation. Token-permissions + open vulns + pinned-deps tracked as triage. | 0/0 |  | infra | 2026-06-30 |
| change | Regenerate compliance with the updated plugin (honesty gate + 29148/12207/SSDF anchors); add native scorecard.yml. Grade stays A99 — webui has no traceability decline. | 0/0 |  | compliance | 2026-06-30 |
| change | E2E hardening: Task-Board header pill + graceful-absence coverage for FR-01.43 | 1809/1809 |  | tooling | 2026-06-30 |
| feature | compliance Grade badge + detail modal in WebUI | 3497/3497 |  | FR-01.43 | 2026-06-30 |
| change | Suppress 130 Semgrep audit-rule false positives via a root .semgrepignore (test/e2e/POC/docs) + inline nosemgrep on 8 production FP lines (pty-manager spawn ADR-067, bidi-injection-defense regex, trusted-config RegExp compiles, loopback ws); converge the compliance dashboard, GitHub code-scanning, and triage on the real near-zero finding count. | 0/0 |  | tooling | 2026-06-29 |
| change | Reconcile detective-audit B7/D3/G2/H2 post-v0.21.0: backfill event for dd7f7468 (PR #168 safeFit refactor), amend evt-2646f4da to reaffirm FR-01.42, register mobile/images conventional-commit scopes, tighten 4 bloat-baseline current LOC values. | 0/0 |  | compliance | 2026-06-29 |
| change | refactor(terminal): extract safeFit into safe-fit.ts to keep useTerminalResize under 300 LOC (PR #168, B7 backfill — LOC-discipline follow-up to #167 ADR-084, behavior-preserving) | 0/0 | dd7f746 | FR-01.28 | 2026-06-29 |
| change | Light the WebUI Control-Grade Security dimension: with the dep-CVE fixes (#180) merged, the fresh main security.yml scan (#28336942429) reports 0 high/critical; refresh_ci_security (AR-10 SARIF-ingestion fallback, monorepo #291) ingests it into the tracked ci-security.json and the dashboard regenerates with Security marked OK -> Control Grade A (99/100), all 7 measurable dimensions green. | 0/0 |  | compliance | 2026-06-28 |
| change | Bump 7 dependencies to their Trivy-fixed versions to clear the security.yml high+medium dependency CVEs (incl. shell-quote command-injection CVE-2026-9277, react-router, hono, ws): client react-router-dom->7.18 / mermaid->11.16 / dompurify->3.4.11 / uuid->11.1.1; server hono->4.12.27 / shell-quote->1.9.0 / ws->8.21.0 (npm overrides for the transitive ones). Full suite 3464/3464 green; client+server builds clean. Lets the WebUI Control-Grade Security dimension light at 0 high/critical once re-scanned + re-ingested. | 3464/3464 |  | infra | 2026-06-28 |
| change | Regenerate WebUI compliance with the now-current plugin (cc1 BP-1 traced-credit, cc2 BP-2 reconciliation, cc3 AR-05 RTM Reconciled column) + reconcile: re-ran the full suite (server 1671 + client 1793 = 3464/3464 green), re-verifying the 12 behavior-touched-but-unreconciled FRs and linking that fresh verification here per BP-2 (spec_impact=none, no behavior change). Lifts the honest WebUI Control Grade from a stale-plugin B89 to A. AR-10 CI-security wiring deferred to a follow-up. | 3464/3464 |  | FR-01.02, FR-01.06, FR-01.25 | 2026-06-28 |
| change | BP-1 webui traceability backfill: classified all 245 work events (tagged 69 previously-untagged events to FRs or an explicit none_reason; closed 5 NOT-VERIFIED FRs (Group A: FR-01.05/.06/.23/.25/.27) by linking the existing work event whose changes exercised them) and freshly verified the 9 remaining NOT-VERIFIED foundational endpoints (Group B: FR-01.07/.14/.17/.18/.19/.20/.21/.22/.26) by re-running their existing route tests (server 1671 + client 1793 = 3464/3464 green) and linking that verification here. | 3464/3464 |  | FR-01.07, FR-01.14, FR-01.17 | 2026-06-28 |
| change | CodeQL noise reduction + qCmd cmd.exe quoting fix | 3463/3463 |  | infra | 2026-06-27 |
| bug | mobile modal touch-safety: iOS focus-zoom + footer 44px button symmetry | 1789/1789 |  | FR-01.39 | 2026-06-27 |
| bug | Repaint the embedded terminal on every WebGL texture-atlas mutation (onChangeTextureAtlas + onAddTextureAtlasCanvas + onRemoveTextureAtlasCanvas) so cells no longer keep stale atlas coordinates after a mid-stream atlas regeneration; fixes the wrong-letter glyph corruption that previously needed a manual resize. | 0/0 |  | FR-01.28 | 2026-06-27 |
| bug | Disable DragOverlay drop animation so a dragged board card no longer flips back to its origin on drop | 1780/1780 |  | FR-01.01 | 2026-06-23 |
| bug | Diagnostic: runtime renderer override (terminal-renderer.ts) read by xtermAddons.ts -- ?terminalRenderer=dom / localStorage skips the WebGL addon (DOM renderer) to A/B whether WebGL is the smear root cause on a real GPU. Default unchanged (webgl). | 0/0 |  | FR-01.28 | 2026-06-23 |
| bug | Reopen a Done card dragged/menu-moved out of the Done column so it lands unlocked instead of stranded done+locked | 3444/3444 |  | FR-01.01 | 2026-06-23 |
| bug | Embedded terminal: data-independent trailing repaint (activation-repaint.ts) clears the stale display:none->block WebGL frame on an IDLE Transcript->Terminal switch / focus restore, closing the no-data gap ADR-202 data-driven settle window left | 0/0 |  | FR-01.28 | 2026-06-22 |
| change | Mobile/touch terminal UX: condense phone header, white-bordered touch keys, buffer-first touch-scroll at resume picker, data-driven settle-repaint for input-area smear | 1762/1762 |  | FR-01.28, FR-01.39 | 2026-06-20 |
| bug | start-server-production.ps1 and install-windows.ps1 run npm install before npm run build so a newly-merged dependency (@dnd-kit/core) no longer breaks the production build; autostart no longer swallows npm errors. | 0/0 |  | infra | 2026-06-18 |
| bug | Embedded terminal WS now reconnects on tab refocus + has a client liveness heartbeat (app-level ping/pong) so a silently-dead socket after sleep/Tailscale partition is detected and recovered instead of a stale frozen frame. | 0/0 |  | FR-01.28 | 2026-06-18 |
| feature | Task-board drag-and-drop with the board column decoupled from session state (sticky boardColumn override, schema v4, POST /tasks/:id/column, accessible Move-to menu + keydown-guard fix). | 0/0 |  |  | 2026-06-17 |
| change | sync vendored gate copies to monorepo fail-closed fixes | 75/75 |  | tooling | 2026-06-17 |
| change | launch-prep README Beta badge, issue templates & tooling | 0/0 |  | docs | 2026-06-17 |
| change | launch-prep PII scrub & repo hygiene | 0/0 |  | infra | 2026-06-17 |
| bug | editor HTML link corruption on save (FR-01.34) | 1700/1700 |  | FR-01.34 | 2026-06-16 |
| bug | Touch-scroll replicates the mouse/trackpad: a finger-pan dispatches a synthetic pixel-mode WheelEvent on term.element so xterm encodes the same mouse-report Claude already consumes for the mouse wheel, instead of arrow keys that Claude interpreted as input-history navigation. Supersedes ADR-132. Client-only. | 0/0 |  | FR-01.38 | 2026-06-15 |
| bug | Fix read-only narrow replay corruption: useReplayDrainGate resizes the terminal to the snapshot cols/rows before term.write so a wide snapshot reconstructs faithfully in a narrow reader (no character interleaving). Client-only. | 0/0 |  | FR-01.28 | 2026-06-15 |
| change | Phone-header polish (FR-01.41 follow-up): top-bar project dropdown content-width (not full-width); All-Projects + New cascade replaced on phone by a flat downward drill-down (ProjectCreatePhoneMenu) so the side submenu no longer overflows off-screen. Desktop/tablet unchanged. | 0/0 |  | FR-01.41 | 2026-06-15 |
| bug | Trailing repaint after terminal reflow — fixes Claude input box rendering broken/wrapped/with a floating title cell after a window/monitor width change (follow-up to PR #146) | 1672/1672 |  | FR-01.28 | 2026-06-15 |
| change | Mobile/tablet layout polish (FR-01.41): phone header — project dropdown moved into the top bar via MobileTopBarSlot portal, status filter collapsed to a funnel-icon multi-select menu (BoardStatusFilter); compact band — List launch icon-only, Projects Path column hidden, icon-rail count badge overlaid, board lanes flexible to fit all three. Desktop unchanged. | 0/0 | 662eaec | FR-01.38, FR-01.39 | 2026-06-15 |
| bug | Repaint embedded terminal on window focus / visibility regain — fixes WebGL stale-frame smear that previously only a manual resize healed | 1668/1668 |  | FR-01.28 | 2026-06-14 |
| change | Tablet-view polish: bidirectional sidebar rail collapse, bottom safe-area inset, greedy list Title column, terminal touch-action:none | 1652/1652 |  | FR-01.38 | 2026-06-14 |
| bug | Self-heal ~/.claude.json a second time at deploy END (post server-up), not only at Step 0 | 38/38 |  | tooling | 2026-06-14 |
| change | Compliance detective-audit reconcile (D3/G2/H1): G2 add 'responsive' commit scope to audit_config.json g2_stoplist; D3 reaffirm promised FR-01.38/FR-01.39 via event_amended on the tablet/phone responsive iterate events (their own work_completed omitted affected_frs); H1 grandfather client/src/components/terminal/EmbeddedTerminal.tsx (311>300, ADR-097 deep module) in shipwright_bloat_baseline.json. No product code touched; D3/G2/H1 re-run FAIL->PASS. | 0/0 |  | compliance | 2026-06-14 |
| feature | Reusable ActionsConfigRow (hideProjectHeader) rendered in ProjectSettingsDialog; upload.ts passes slash_command to dryRunTemplate (fixes 500); removed stale Launcher preferences card. | 0/0 |  | FR-01.40, FR-01.37 | 2026-06-14 |
| feature | Phone responsive view (<768px), iterate 2 of 2: sidebar overlay drawer (Radix Dialog) below 768px; on-screen TerminalKeyBar for touch devices (Esc/Tab/Ctrl-C/arrows/Enter, writes to the pty via the existing socket.send writer frame, mode-aware CSI/SS3 arrows, writer re-check, soft-keyboard-safe); list+Projects table reflow; modal 44px touch targets; iOS safe-area + interactive-widget=resizes-content + dvh. Reuses the FR-01.38 foundation; tablet+desktop byte-identical. | 0/0 |  |  | 2026-06-14 |
| feature | Tablet responsive view (≤1023px): useIsCompactViewport SSoT; sidebar rail; board swipe carousel + list lg:-gating + campaign card hardening; task-detail persistent-PanelGroup compact Files/Session/Viewer tabs (terminal never unmounts across breakpoint); desktop ≥1024px byte-identical. Phone deferred to iterate-2. | 0/0 |  |  | 2026-06-14 |
| change | Tighten shipwright_bloat_baseline.json ceiling for server/src/terminal/routes.ts (current 620 -> 509) to match post-#135 size; ADR-103 exception retained | 1637/1637 |  | compliance | 2026-06-14 |
| change | Deploy-time self-heal of a truncation-tail-corrupt ~/.claude.json: new ops helper scripts/repair-claude-json.mjs + start-server-production.ps1 step 0 | 24/24 |  | tooling | 2026-06-14 |
| bug | buildSpawnEnv strips inherited CLAUDE_CODE_CHILD_SESSION/SESSION_ID/ENTRYPOINT/CLAUDECODE so embedded-terminal claude launches top-level and writes its <uuid>.jsonl; fixes empty Transcripts tab when the server was started from inside a Claude session. | 0/0 |  | FR-01.02, FR-01.12 | 2026-06-13 |
| change | Correct stale .webui/actions.json -> .shipwright-webui/actions.json in live spec.md FR descriptions + acceptance criteria (post-v0.17.0 rename); regenerate traceability matrix. | 0/0 |  | compliance | 2026-06-13 |
| change | Thorough guide.md correctness audit vs code/ADRs/RTM (3 sub-agents): fix §6.1 menu location + Plain Claude sibling, §9.3 validation/placeholder/modal_fields drift, add §6.9 Campaigns lane + §6.10 file-editor docs; align server+client package.json version to 0.18.0. | 0/0 |  | docs | 2026-06-13 |
| change | docs install audit: README production single-process install + guide §4/§7/§8 fixes + Makefile lint help/target + CLAUDE.md structure verify | 0/0 |  | docs | 2026-06-13 |
| change | Reconcile post-v0.18.0 detective audit F5: document the convention-impact drop iterate-2026-06-12-automerge-pr-review-alignment under conventions.md (## Convention Updates). B7 (commit 82021094) and G2 (scopes review/actions, then agent-docs) were already resolved on origin/main by PR #127/#129; F5 had migrated to this drop. | 1/1 |  | compliance | 2026-06-13 |
| bug | Flat Campaigns-lane card (remove heavy shadow) + fix List-view right-column clipping | 1611/1611 |  | FR-01.01, FR-01.33 | 2026-06-12 |
| change | compliance G2/H1/H2 bloat-baseline reconcile | 1609/1609 |  | compliance | 2026-06-12 |
| change | Condense agent_docs (architecture.md + conventions.md) to ADR-anchored pointers; fix structural drift + a launchPayload ADR mislabel | 0/0 |  | docs | 2026-06-12 |
| change | Reconcile post-v0.18.0 detective audit: backfill PR #124 (commit 8202109) missing work_completed event (B7) + register the actions/review conventional-commit scopes in audit_config.json g2_stoplist (G2). F5 was a stale-local-main false positive (PASS on origin/main). | 3/3 |  | compliance | 2026-06-12 |
| change | Backfill (B7 reconciliation): WebUI side of routing idle-main triage status flips to the per-tree outbox (mirror of triage.py mark_status TRACKED-PREFERRED residence). shouldRouteToOutbox(projectRoot) = origin remote AND HEAD==default branch, git-probed via spawnSync, failing safe to tracked on any git error. PR #124 (commit 8202109) merged WITHOUT an F5b work_completed event or F6 Run-ID footer; this event is reconstructed from the commit to close the B7 gap. | 0/0 | 8202109 | FR-01.30 | 2026-06-11 |
| feature | Manual dismiss/restore (webui-owned board quittance) for Campaigns-board cards; selectVisible/selectDismissed partition + show-dismissed toggle; dismissed-campaigns-store + 2 POST routes + dismissed annotation. | 0/0 |  | FR-01.33 | 2026-06-12 |
| change | Migrate .github/workflows/claude-review.yml to pr-review.yml: an OpenRouter-backed Tier-3 reviewer (vendored pr_review.py + pr_review_lib.py + prompts under scripts/ci/, logic byte-identical to monorepo B4.5 Phase 2) gated by a decide-job tier filter (external author / sensitive paths .github/workflows,scripts/hooks,scripts/ci / needs-review label). Drops @anthropic-ai/claude-code + ANTHROPIC_API_KEY + the dead develop trigger. Adds an offline selftest job running 72 vendored tests. | 0/0 |  | infra | 2026-06-12 |
| feature | Optional slash_command on custom actions so {task.initial_prompt} fuses slash+description into one positional; fail-loud schema validation. | 0/0 |  | FR-01.37 | 2026-06-11 |
| change | Project Campaigns-board status from the tracked shipwright_events.jsonl (overlay event-confirmed completions onto dir-sourced campaigns; synthesize derivedFromEvents campaigns when the dir is absent) so gitignored campaigns surface progress on a deployed board | 0/0 |  | FR-01.33 | 2026-06-11 |
| change | Pending-delivery badge for outbox-only triage items: GET /api/triage pendingDelivery enrichment (core/triage-enrich.ts) parity-gated against the real triage_cli.py list --json; amber badge in card+modal; CTAs unchanged; route anti-ratchet extraction 763->725. | 0/0 |  | FR-01.30 | 2026-06-10 |
| bug | Force a full-viewport WebGL repaint on the terminal scroll input (term.onScroll + passive wheel listener, rAF-coalesced + 150ms trailing) to fix table smear (stale glyphs the partial dirty-row refresh skips). | 0/0 |  | FR-01.28 | 2026-06-09 |
| change | Campaigns board surfaces the live loop_state.json-derived in_progress sub-iterate as a per-step overlay on GET /api/campaigns (readLoopRunState, read once), so an autonomous build shows real-time progress instead of sitting at done/total=0/N. Only pending->in_progress; done/total/nextPending invariant. Webui-only, independent of the monorepo producer status.json write (trg-9edbab4d). | 0/0 |  | FR-01.33 | 2026-06-09 |
| change | WebUI server-side triage reader unions tracked + per-tree gitignored outbox (two-pass, Python-parity); status flips residence-derived to avoid tracked main drift. Codex Q6 deployment verified; .gitignore outbox line propagated via self-heal. | 0/0 |  | FR-01.30 | 2026-06-08 |
| change | Campaign attached-run guard: detect a live autonomous run (loop_state.json in_progress unit OR status.json in_progress step) and prevent a second orchestrator — client launch CTAs disable+relabel Run attached AND the server launch branches return 409 campaign_run_already_attached. | 0/0 |  | FR-01.33, FR-01.34, FR-01.36 | 2026-06-08 |
| bug | force full-viewport refresh after terminal replay-drain settle (clean render on open) | 1557/1557 |  | tooling | 2026-06-07 |
| bug | Fix following ADR-131 / PR #110 (diagnosis). attachTouchScroll gains optional sendData callback; routeScroll helper reads term.buffer.active.type and routes alt-buffer pan to Cursor-Up/Down keystrokes via sendData (the TUI scrolls itself) and normal-buffer pan to term.scrollLines as before. EmbeddedTerminal.tsx:215 wires sendData to socket.send (same WS path term.onData uses). | 0/0 |  | tooling | 2026-06-07 |
| bug | Diagnosis-only iterate. Added 3 vitest cases (real @xterm/xterm in jsdom) that empirically confirm DECSET 1049 flips buffer to alternate, scrollLines is no-op in alt-buffer, and current attachTouchScroll calls scrollLines unconditionally. PR #61 mock pattern could not model buffer-type semantics. No production code touched. | 0/0 |  | tooling | 2026-06-07 |
| bug | Campaigns lane: hide done==total campaigns even on a stale active lifecycle | 1550/1550 |  | FR-01.33 | 2026-06-05 |
| change | Event-log backfill (campaign sub-iterate A): record work_completed events for 10 pre-existing event-less direct commits (ci/security/docs/chore + 1 feat FR-01.33) so B7 (every commit accountable) clears; closes the B7 half of trg-2bce4cc6 | 0/0 |  | compliance | 2026-06-05 |
| change | ci(security): checkout at fetch-depth 1 | 0/0 | 2fa1e9a | infra | 2026-06-05 |
| feature | feat(triage): Start Campaign action — draft->active + board nav (ADR-148) | 0/0 | 3def014 | FR-01.33 | 2026-06-05 |
| change | ci: pin create-or-update-comment to SHA + gitleaks integrity | 0/0 | fff2b02 | infra | 2026-06-05 |
| change | docs(ci): correct stale upload-sarif @v3 comment to @v4 | 0/0 | 48badb6 | docs | 2026-06-05 |
| change | ci(security): activate Security Scan on PRs + weekly | 0/0 | 7196205 | infra | 2026-06-05 |
| change | ci(security): add CodeQL workflow | 0/0 | d66ab55 | infra | 2026-06-05 |
| change | chore(campaign): mark 2026-05-25-bloat-cleanup-C-webui complete | 0/0 | 96824e6 | compliance | 2026-06-05 |
| change | fix(ci): gate server type-check + correct security gate | 0/0 | 9d096a1 | tooling | 2026-06-05 |
| change | fix(security): remediate vitest CVE-2026-47429 | 0/0 | 7187f28 | infra | 2026-06-05 |
| change | chore(security): allowlist sidekiq-secret false positive | 0/0 | 2148152 | infra | 2026-06-05 |
| change | webui audit data/config reconcile (campaign C4): add legit scopes (board/campaigns/smartviewer/media/campaign) to g2_stoplist + event_amended FR links for reopen(FR-01.32)/create-menu(FR-01.01)/FR-01.34 same-event delivery | 0/0 |  | compliance | 2026-06-05 |
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
| change | — | +14 new, 14/14 | 247325b | compliance | 2026-05-25 |
| change | Sub-iterate C1 (verification) of Campaign 2026-05-25-bloat-cleanup-C-webui. CLAUDE.md is 197 LOC on origin/main and not in shipwright_bloat_baseline.json — Phase 0f compliance-hygiene cleanup (PR #55, commit f4d52fd) organically delivered the target. Reframed C1 as Verification Iterate: pytest probe (2 assertions) + ADR-100 + existing client doc-sync vitest guard (20 cases). No edit to CLAUDE.md. | +2 new, 22/22 | b1e66f4 | docs | 2026-05-25 |
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
Last run: 2026-06-30 | Unit: 1809/1809 | E2E: 2/2 | Smoke: not_run | (iterate)

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
