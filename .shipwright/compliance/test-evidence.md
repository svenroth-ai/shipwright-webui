# Test Evidence Report

Generated: 2026-06-15T12:53:28.933961+00:00

## Summary

| Metric | Value |
|--------|-------|
| Total test checkpoints | 229 |
| Total unit tests (latest) | 0/0 |
| New tests from iterations | +26 |

## Test Progression

| # | Event | Source | Layer | New Tests | Suite Total | Result | Date |
|---|-------|--------|-------|-----------|-------------|--------|------|
| 1 | Fix read-only narrow replay corruption: useReplayDrainGate resizes the terminal to the snapshot cols/rows before term.write so a wide snapshot reconstructs faithfully in a narrow reader (no character interleaving). Client-only. | iterate | — | +0 | — | — | 2026-06-15 |
| 2 | Phone-header polish (FR-01.41 follow-up): top-bar project dropdown content-width (not full-width); All-Projects + New cascade replaced on phone by a flat downward drill-down (ProjectCreatePhoneMenu) so the side submenu no longer overflows off-screen. Desktop/tablet unchanged. | iterate | — | +0 | — | — | 2026-06-15 |
| 3 | Trailing repaint after terminal reflow — fixes Claude input box rendering broken/wrapped/with a floating title cell after a window/monitor width change (follow-up to PR #146) | iterate | mixed | +0 | 1672/1672 | PASS | 2026-06-15 |
| 4 | Mobile/tablet layout polish (FR-01.41): phone header — project dropdown moved into the top bar via MobileTopBarSlot portal, status filter collapsed to a funnel-icon multi-select menu (BoardStatusFilter); compact band — List launch icon-only, Projects Path column hidden, icon-rail count badge overlaid, board lanes flexible to fit all three. Desktop unchanged. | iterate | — | +0 | — | — | 2026-06-15 |
| 5 | Repaint embedded terminal on window focus / visibility regain — fixes WebGL stale-frame smear that previously only a manual resize healed | iterate | mixed | +0 | 1668/1668 | PASS | 2026-06-14 |
| 6 | Tablet-view polish: bidirectional sidebar rail collapse, bottom safe-area inset, greedy list Title column, terminal touch-action:none | iterate | mixed | +0 | 1652/1652 | PASS | 2026-06-14 |
| 7 | Self-heal ~/.claude.json a second time at deploy END (post server-up), not only at Step 0 | iterate | unit | +0 | 38/38 | PASS | 2026-06-14 |
| 8 | Compliance detective-audit reconcile (D3/G2/H1): G2 add 'responsive' commit scope to audit_config.json g2_stoplist; D3 reaffirm promised FR-01.38/FR-01.39 via event_amended on the tablet/phone responsive iterate events (their own work_completed omitted affected_frs); H1 grandfather client/src/components/terminal/EmbeddedTerminal.tsx (311>300, ADR-097 deep module) in shipwright_bloat_baseline.json. No product code touched; D3/G2/H1 re-run FAIL->PASS. | iterate | — | +0 | — | — | 2026-06-14 |
| 9 | Reusable ActionsConfigRow (hideProjectHeader) rendered in ProjectSettingsDialog; upload.ts passes slash_command to dryRunTemplate (fixes 500); removed stale Launcher preferences card. | iterate | — | +0 | — | — | 2026-06-14 |
| 10 | Phone responsive view (<768px), iterate 2 of 2: sidebar overlay drawer (Radix Dialog) below 768px; on-screen TerminalKeyBar for touch devices (Esc/Tab/Ctrl-C/arrows/Enter, writes to the pty via the existing socket.send writer frame, mode-aware CSI/SS3 arrows, writer re-check, soft-keyboard-safe); list+Projects table reflow; modal 44px touch targets; iOS safe-area + interactive-widget=resizes-content + dvh. Reuses the FR-01.38 foundation; tablet+desktop byte-identical. | iterate | — | +0 | — | — | 2026-06-14 |
| 11 | Tablet responsive view (≤1023px): useIsCompactViewport SSoT; sidebar rail; board swipe carousel + list lg:-gating + campaign card hardening; task-detail persistent-PanelGroup compact Files/Session/Viewer tabs (terminal never unmounts across breakpoint); desktop ≥1024px byte-identical. Phone deferred to iterate-2. | iterate | — | +0 | — | — | 2026-06-14 |
| 12 | Tighten shipwright_bloat_baseline.json ceiling for server/src/terminal/routes.ts (current 620 -> 509) to match post-#135 size; ADR-103 exception retained | iterate | unit | +0 | 1637/1637 | PASS | 2026-06-14 |
| 13 | Deploy-time self-heal of a truncation-tail-corrupt ~/.claude.json: new ops helper scripts/repair-claude-json.mjs + start-server-production.ps1 step 0 | iterate | unit | +0 | 24/24 | PASS | 2026-06-14 |
| 14 | buildSpawnEnv strips inherited CLAUDE_CODE_CHILD_SESSION/SESSION_ID/ENTRYPOINT/CLAUDECODE so embedded-terminal claude launches top-level and writes its <uuid>.jsonl; fixes empty Transcripts tab when the server was started from inside a Claude session. | iterate | — | +0 | — | — | 2026-06-13 |
| 15 | Correct stale .webui/actions.json -> .shipwright-webui/actions.json in live spec.md FR descriptions + acceptance criteria (post-v0.17.0 rename); regenerate traceability matrix. | iterate | — | +0 | — | — | 2026-06-13 |
| 16 | Thorough guide.md correctness audit vs code/ADRs/RTM (3 sub-agents): fix §6.1 menu location + Plain Claude sibling, §9.3 validation/placeholder/modal_fields drift, add §6.9 Campaigns lane + §6.10 file-editor docs; align server+client package.json version to 0.18.0. | iterate | — | +0 | — | — | 2026-06-13 |
| 17 | docs install audit: README production single-process install + guide §4/§7/§8 fixes + Makefile lint help/target + CLAUDE.md structure verify | iterate | — | +0 | — | — | 2026-06-13 |
| 18 | Reconcile post-v0.18.0 detective audit F5: document the convention-impact drop iterate-2026-06-12-automerge-pr-review-alignment under conventions.md (## Convention Updates). B7 (commit 82021094) and G2 (scopes review/actions, then agent-docs) were already resolved on origin/main by PR #127/#129; F5 had migrated to this drop. | iterate | unit | +0 | 1/1 | PASS | 2026-06-13 |
| 19 | Flat Campaigns-lane card (remove heavy shadow) + fix List-view right-column clipping | iterate | mixed | +0 | 1611/1611 | PASS | 2026-06-12 |
| 20 | compliance G2/H1/H2 bloat-baseline reconcile | iterate | unit | +0 | 1609/1609 | PASS | 2026-06-12 |
| 21 | Condense agent_docs (architecture.md + conventions.md) to ADR-anchored pointers; fix structural drift + a launchPayload ADR mislabel | iterate | — | +0 | — | — | 2026-06-12 |
| 22 | Reconcile post-v0.18.0 detective audit: backfill PR #124 (commit 8202109) missing work_completed event (B7) + register the actions/review conventional-commit scopes in audit_config.json g2_stoplist (G2). F5 was a stale-local-main false positive (PASS on origin/main). | iterate | unit | +0 | 3/3 | PASS | 2026-06-12 |
| 23 | Backfill (B7 reconciliation): WebUI side of routing idle-main triage status flips to the per-tree outbox (mirror of triage.py mark_status TRACKED-PREFERRED residence). shouldRouteToOutbox(projectRoot) = origin remote AND HEAD==default branch, git-probed via spawnSync, failing safe to tracked on any git error. PR #124 (commit 8202109) merged WITHOUT an F5b work_completed event or F6 Run-ID footer; this event is reconstructed from the commit to close the B7 gap. | iterate | — | +0 | — | — | 2026-06-11 |
| 24 | Manual dismiss/restore (webui-owned board quittance) for Campaigns-board cards; selectVisible/selectDismissed partition + show-dismissed toggle; dismissed-campaigns-store + 2 POST routes + dismissed annotation. | iterate | — | +0 | — | — | 2026-06-12 |
| 25 | Migrate .github/workflows/claude-review.yml to pr-review.yml: an OpenRouter-backed Tier-3 reviewer (vendored pr_review.py + pr_review_lib.py + prompts under scripts/ci/, logic byte-identical to monorepo B4.5 Phase 2) gated by a decide-job tier filter (external author / sensitive paths .github/workflows,scripts/hooks,scripts/ci / needs-review label). Drops @anthropic-ai/claude-code + ANTHROPIC_API_KEY + the dead develop trigger. Adds an offline selftest job running 72 vendored tests. | iterate | — | +0 | — | — | 2026-06-12 |
| 26 | Optional slash_command on custom actions so {task.initial_prompt} fuses slash+description into one positional; fail-loud schema validation. | iterate | — | +0 | — | — | 2026-06-11 |
| 27 | Project Campaigns-board status from the tracked shipwright_events.jsonl (overlay event-confirmed completions onto dir-sourced campaigns; synthesize derivedFromEvents campaigns when the dir is absent) so gitignored campaigns surface progress on a deployed board | iterate | — | +0 | — | — | 2026-06-11 |
| 28 | Pending-delivery badge for outbox-only triage items: GET /api/triage pendingDelivery enrichment (core/triage-enrich.ts) parity-gated against the real triage_cli.py list --json; amber badge in card+modal; CTAs unchanged; route anti-ratchet extraction 763->725. | iterate | — | +0 | — | — | 2026-06-10 |
| 29 | Force a full-viewport WebGL repaint on the terminal scroll input (term.onScroll + passive wheel listener, rAF-coalesced + 150ms trailing) to fix table smear (stale glyphs the partial dirty-row refresh skips). | iterate | — | +0 | — | — | 2026-06-09 |
| 30 | Campaigns board surfaces the live loop_state.json-derived in_progress sub-iterate as a per-step overlay on GET /api/campaigns (readLoopRunState, read once), so an autonomous build shows real-time progress instead of sitting at done/total=0/N. Only pending->in_progress; done/total/nextPending invariant. Webui-only, independent of the monorepo producer status.json write (trg-9edbab4d). | iterate | — | +0 | — | — | 2026-06-09 |
| 31 | WebUI server-side triage reader unions tracked + per-tree gitignored outbox (two-pass, Python-parity); status flips residence-derived to avoid tracked main drift. Codex Q6 deployment verified; .gitignore outbox line propagated via self-heal. | iterate | — | +0 | — | — | 2026-06-08 |
| 32 | Campaign attached-run guard: detect a live autonomous run (loop_state.json in_progress unit OR status.json in_progress step) and prevent a second orchestrator — client launch CTAs disable+relabel Run attached AND the server launch branches return 409 campaign_run_already_attached. | iterate | — | +0 | — | — | 2026-06-08 |
| 33 | force full-viewport refresh after terminal replay-drain settle (clean render on open) | iterate | unit | +0 | 1557/1557 | PASS | 2026-06-07 |
| 34 | Fix following ADR-131 / PR #110 (diagnosis). attachTouchScroll gains optional sendData callback; routeScroll helper reads term.buffer.active.type and routes alt-buffer pan to Cursor-Up/Down keystrokes via sendData (the TUI scrolls itself) and normal-buffer pan to term.scrollLines as before. EmbeddedTerminal.tsx:215 wires sendData to socket.send (same WS path term.onData uses). | iterate | — | +0 | — | — | 2026-06-07 |
| 35 | Diagnosis-only iterate. Added 3 vitest cases (real @xterm/xterm in jsdom) that empirically confirm DECSET 1049 flips buffer to alternate, scrollLines is no-op in alt-buffer, and current attachTouchScroll calls scrollLines unconditionally. PR #61 mock pattern could not model buffer-type semantics. No production code touched. | iterate | — | +0 | — | — | 2026-06-07 |
| 36 | Campaigns lane: hide done==total campaigns even on a stale active lifecycle | iterate | unit | +0 | 1550/1550 | PASS | 2026-06-05 |
| 37 | Event-log backfill (campaign sub-iterate A): record work_completed events for 10 pre-existing event-less direct commits (ci/security/docs/chore + 1 feat FR-01.33) so B7 (every commit accountable) clears; closes the B7 half of trg-2bce4cc6 | iterate | — | +0 | — | — | 2026-06-05 |
| 38 | ci(security): checkout at fetch-depth 1 | iterate | — | +0 | — | — | 2026-06-05 |
| 39 | feat(triage): Start Campaign action — draft->active + board nav (ADR-148) | iterate | — | +0 | — | — | 2026-06-05 |
| 40 | ci: pin create-or-update-comment to SHA + gitleaks integrity | iterate | — | +0 | — | — | 2026-06-05 |
| 41 | docs(ci): correct stale upload-sarif @v3 comment to @v4 | iterate | — | +0 | — | — | 2026-06-05 |
| 42 | ci(security): activate Security Scan on PRs + weekly | iterate | — | +0 | — | — | 2026-06-05 |
| 43 | ci(security): add CodeQL workflow | iterate | — | +0 | — | — | 2026-06-05 |
| 44 | chore(campaign): mark 2026-05-25-bloat-cleanup-C-webui complete | iterate | — | +0 | — | — | 2026-06-05 |
| 45 | fix(ci): gate server type-check + correct security gate | iterate | — | +0 | — | — | 2026-06-05 |
| 46 | fix(security): remediate vitest CVE-2026-47429 | iterate | — | +0 | — | — | 2026-06-05 |
| 47 | chore(security): allowlist sidekiq-secret false positive | iterate | — | +0 | — | — | 2026-06-05 |
| 48 | webui audit data/config reconcile (campaign C4): add legit scopes (board/campaigns/smartviewer/media/campaign) to g2_stoplist + event_amended FR links for reopen(FR-01.32)/create-menu(FR-01.01)/FR-01.34 same-event delivery | iterate | — | +0 | — | — | 2026-06-05 |
| 49 | One-click Launch (Cx) button to launch a single campaign sub-iterate via /shipwright-iterate "<specPath>" built server-side from {slug,stepId}; replaces the per-step Copy-launch clipboard button. Direct launch for ordinary steps, confirm dialog for risky ones. | iterate | — | +0 | — | — | 2026-06-04 |
| 50 | Parse the campaign Sub-Iterates table by column header and strip Markdown emphasis from cells, so bold step IDs (**C1**) and extra Repo/Depends-on columns no longer null the spec path and disable the board per-step Copy-launch button. | iterate | — | +0 | — | — | 2026-06-04 |
| 51 | Add a formatting toolbar to the SmartViewer markdown editor (FR-01.34 WYSIWYG UX completion) | iterate | — | +0 | — | — | 2026-06-04 |
| 52 | iterate finalization | iterate | — | +0 | — | — | 2026-06-03 |
| 53 | SmartViewer inline video playback (mp4/m4v/webm/ogv/ogg/mov) via a new Range-capable /media streaming route, kept separate from the atomic /file route. | iterate | — | +0 | — | — | 2026-06-03 |
| 54 | Second Campaigns-lane action: opens a TaskDetail terminal auto-running /shipwright-iterate --campaign <slug> --autonomous, gated by a confirm dialog + risky-step warning. | iterate | — | +0 | — | — | 2026-06-03 |
| 55 | SmartViewer in-app Markdown rich editor (TipTap) + first project-file write surface: PUT /file with content-hash If-Match optimistic concurrency, mandatory pre-save diff + warn banner. | iterate | — | +0 | — | — | 2026-06-03 |
| 56 | Triage 'Start Campaign' action (ADR-148): POST /api/campaigns/:slug/start flips draft->active via core/campaign-write.ts (atomic, lock-protected); triage items enriched with campaignSlug/campaignStatus via injected dep (triage.ts imports no campaign module); modal renders Start Campaign/Go-to-board/none + demotes Fix-now; navigates to board. Narrow relaxation of WebUI read-only-on-campaign-state. | iterate | — | +0 | — | — | 2026-06-03 |
| 57 | campaign-store reads top-level lifecycle status (status.json/frontmatter); selectActiveCampaigns shows iff active, legacy falls back to done<total | iterate | — | +0 | — | — | 2026-06-03 |
| 58 | CampaignLaneCard collapsible (default collapsed, persisted per-slug) + description disclosure + TaskBoardPage lane height-cap | iterate | — | +0 | — | — | 2026-06-03 |
| 59 | All-Projects create-menu cascade complete: project-first + New / Plain Claude; modal scoped to chosen project (fixes action/schema mismatch). 1416 client vitest + AC1-AC6 real-browser E2E green. | iterate | — | +0 | — | — | 2026-06-02 |
| 60 | Read-only Campaigns lane on TaskBoardPage + GET /api/campaigns/:projectId | iterate | — | +0 | — | — | 2026-06-02 |
| 61 | Gate terminal idle-ceiling on client attachment so a watched session is never reaped; raise detached-grace 30min->12h; resume data-loss note on the ADR-104 reset banner. | iterate | — | +0 | — | — | 2026-06-02 |
| 62 | WS liveness keepalive complete; PR pending | iterate | — | +0 | — | — | 2026-05-31 |
| 63 | POST /api/external/tasks/:id/reopen flips done->draft (counterpart of /backlog), session preserved; TaskCardMenu hosts the isDone-gated Re-open item | iterate | — | +0 | — | — | 2026-05-31 |
| 64 | SmartViewer pop-out opens a centered in-app modal (Radix Dialog) instead of window.open to a new browser tab; popOut threaded SmartViewer->MarkdownRenderer to suppress the nested control; /preview route retained. | iterate | — | +0 | — | — | 2026-05-31 |
| 65 | page-chrome cleanup: remove Diagnostics Launchers section and align Triage header to Inbox/Projects | iterate | mixed | +0 | 1331/1331 | PASS | 2026-05-30 |
| 66 | PR card bubble parity + open/merged status badge via gh pr view | iterate | mixed | +0 | 1335/1335 | PASS | 2026-05-30 |
| 67 | SmartViewer document rendering (comments/frontmatter/anchors/in-pane nav) + pop-out + page scroll | iterate | mixed | +0 | 1345/1345 | PASS | 2026-05-30 |
| 68 | Render mode/pr-link/stop-hook JSONL events + intent-based useAutoScroll detach | iterate | — | +0 | — | — | 2026-05-28 |
| 69 | TaskCard + TaskDetailHeader rendered a Build pill for iterate tasks whose title started with Fix (regex match in derivePhaseFromTitle). Centralised the resolution policy in resolveTaskPhase so new-iterate always resolves to the iterate phase when no override is persisted. | iterate | — | +0 | — | — | 2026-05-27 |
| 70 | ADR-103 retirement candidate #1: extract WebSocket upgrade body from server/src/terminal/routes.ts (1013 -> 620 LOC) into ws-upgrade-handler.ts as a single cohesive buildWsHandlers(ctx: ValidatedWsUpgradeContext) function. deriveTerminalReset moved to terminal-reset.ts to break the import cycle. routes.ts retains synchronous reject-the-upgrade validations + HTTP route handlers + spawn-env factory. 29 new lifecycle/parse-table unit tests; F0.5 Node-side WS probe pass; full server vitest suite (1342 tests) green. | iterate | — | +0 | — | — | 2026-05-27 |
| 71 | Fix prewarm race that armed the one-shot auto-launch guard on first WS attach | iterate | mixed | +0 | 1274/1274 | PASS | 2026-05-26 |
| 72 | iterate finalization | iterate | — | +0 | — | — | 2026-05-26 |
| 73 | Commit C2 API contract sweep as tracked vitest suite (baseline JSON + PROBE_TABLE in-memory probes + 3 meta-tests; regression-guards external/routes.ts touch-ups in CI) | iterate | mixed | +0 | 1279/1279 | PASS | 2026-05-26 |
| 74 | C5 EmbeddedTerminal-split E2E backfill (auto-execute + ptyReused regression fence) | iterate | mixed | +0 | 20/20 | PASS | 2026-05-26 |
| 75 | NEW .github/PULL_REQUEST_TEMPLATE.md (Superpowers anti-slop framing) + README Acknowledgments block (companion to shipwright PR #105) | iterate | — | +0 | — | — | 2026-05-26 |
| 76 | Split NewIssueModal.tsx (1516 LOC) into NewIssueModal/ directory with dispatcher + ModalShell + 5 mode-specific body components + shared useNewIssueForm hook (3 slices). Both bloat baseline entries removed. | iterate | unit | +0 | 1124/1124 | PASS | 2026-05-26 |
| 77 | Campaign C / C6 — Split TaskDetailHeader.tsx (1015 LOC) into 222-LOC shell + 7 sub-components. | iterate | — | +0 | — | — | 2026-05-26 |
| 78 | iterate finalization | iterate | — | +0 | — | — | 2026-05-25 |
| 79 | evt-956e1c71 | iterate | unit | +14 | 14/14 | PASS | 2026-05-25 |
| 80 | Sub-iterate C1 (verification) of Campaign 2026-05-25-bloat-cleanup-C-webui. CLAUDE.md is 197 LOC on origin/main and not in shipwright_bloat_baseline.json — Phase 0f compliance-hygiene cleanup (PR #55, commit f4d52fd) organically delivered the target. Reframed C1 as Verification Iterate: pytest probe (2 assertions) + ADR-100 + existing client doc-sync vitest guard (20 cases). No edit to CLAUDE.md. | iterate | unit | +2 | 22/22 | PASS | 2026-05-25 |
| 81 | Backfill 14 work_completed events for chore/docs commits between v0.14.0 and v0.16.0 that bypassed the iterate flow | iterate | — | +0 | — | — | 2026-05-23 |
| 82 | doc-sync meta-test follows Phase 0f file-map move | iterate | unit | +0 | 1066/1066 | PASS | 2026-05-23 |
| 83 | chore(launch-prep): publish .shipwright/ SDLC documentation | iterate | — | +0 | — | — | 2026-05-23 |
| 84 | chore(launch-prep): scrub local paths, Tailscale host and IP | iterate | — | +0 | — | — | 2026-05-23 |
| 85 | chore(launch-prep): drop stale skill-compliance docs, fix doc path refs | iterate | — | +0 | — | — | 2026-05-23 |
| 86 | docs(governance): add CODE_OF_CONDUCT, CONTRIBUTING, SECURITY policy | iterate | — | +0 | — | — | 2026-05-23 |
| 87 | chore(compliance): refresh commit SHAs after history rewrite | iterate | — | +0 | — | — | 2026-05-23 |
| 88 | chore(compliance): auto-regenerated artefacts include launch-prep commits | iterate | — | +0 | — | — | 2026-05-23 |
| 89 | chore(events): backfill affected_frs for 18 prior iterates (Phase 0a) | iterate | — | +0 | — | — | 2026-05-23 |
| 90 | chore(events): backfill change_type for 4 non-FR iterates (Phase 0a) | iterate | — | +0 | — | — | 2026-05-23 |
| 91 | chore(compliance): auto-regenerated artefacts include Phase 0a backfill | iterate | — | +0 | — | — | 2026-05-23 |
| 92 | chore(events): fix two malformed dashboard rows | iterate | — | +0 | — | — | 2026-05-23 |
| 93 | docs(adr): add Part I + Part II banners to decision_log (Phase 0b) | iterate | — | +0 | — | — | 2026-05-23 |
| 94 | docs(adr): slim down ADR-087/088 + extract details to planning/adr (Phase 0c, PR #47) | iterate | — | +0 | — | — | 2026-05-23 |
| 95 | docs(claude-md): strip Iterate annotations + slim DO-NOT guards (Phase 0e, PR #49) | iterate | — | +0 | — | — | 2026-05-23 |
| 96 | docs(test-status): record Phase 0d FAIL-row dismissals (PR #50) | iterate | — | +0 | — | — | 2026-05-23 |
| 97 | iterate finalization | iterate | — | +0 | — | — | 2026-05-23 |
| 98 | compliance documentation hygiene Phase 0f (F4-F7) | iterate | — | +0 | — | — | 2026-05-22 |
| 99 | triage Fix-now pre-selects the triage item's project in NewIssueModal | iterate | unit | +0 | 2198/2198 | PASS | 2026-05-22 |
| 100 | SPA fallback for /triage, /inbox & friends (Hono server) | iterate | unit | +0 | 1174/1174 | PASS | 2026-05-22 |
| 101 | VERIFICATION: bug+change-type — should pass | iterate | — | +0 | — | — | 2026-05-21 |
| 102 | VERIFICATION: with affected-frs — should pass | iterate | — | +0 | — | — | 2026-05-21 |
| 103 | triage Fix-now opens NewIssueModal pre-populated + namespace 4 phase slashes (+ FR-01.30 spec follow-up) | iterate | mixed | +0 | 2193/2193 | PASS | 2026-05-21 |
| 104 | triage Fix-now opens NewIssueModal pre-populated + namespace 4 phase slashes | iterate | mixed | +0 | 2193/2193 | PASS | 2026-05-21 |
| 105 | fix-terminal-flicker-on-closed-task | iterate | mixed | +0 | 2184/2184 | PASS | 2026-05-21 |
| 106 | triage-launch-surface-webui (launchPayload + Fix-now) | iterate | mixed | +0 | 2189/2189 | PASS | 2026-05-20 |
| 107 | adopt oxlint as the project linter + env-isolate the server CORS test | iterate | unit | +0 | 2135/2135 | PASS | 2026-05-19 |
| 108 | Inbox card markdown rendering + fade-clip + spacing | iterate | mixed | +0 | 979/979 | PASS | 2026-05-19 |
| 109 | triage promote carries the brief into the launched run (actionId + newline flatten) | iterate | mixed | +0 | 1156/1156 | PASS | 2026-05-19 |
| 110 | fix triage promote: carry item.detail into the promoted task description | iterate | unit | +0 | 1155/1155 | PASS | 2026-05-19 |
| 111 | fix --name double-quoting in bundled launch templates via the {task.session_name} placeholder | iterate | unit | +0 | 1152/1152 | PASS | 2026-05-18 |
| 112 | inbox-terminal-prompts: surface waiting terminal pickers + focus terminal on Inbox click | iterate | mixed | +0 | 2062/2062 | PASS | 2026-05-18 |
| 113 | fix launch command dropping the persisted task description on Resume / non-modal launches | iterate | unit | +0 | 1123/1123 | PASS | 2026-05-18 |
| 114 | terminal keyboard copy/paste with multi-line paste fidelity | iterate | mixed | +0 | 970/970 | PASS | 2026-05-18 |
| 115 | terminal cursor flicker on remount — restore DECTCEM (?25) cursor visibility in headless-mirror replay snapshots | iterate | unit | +0 | 2045/2045 | PASS | 2026-05-18 |
| 116 | edit-task-dialog: Edit Task dialog with lifecycle-gated field editability | iterate | mixed | +0 | 2042/2042 | PASS | 2026-05-18 |
| 117 | move-to-backlog — POST /api/external/tasks/:id/backlog + Move-to-Backlog menu items + draft-sticky transcript guard + Resume-vs-Launch fix (rebased onto origin/main afb4dc1) | iterate | mixed | +0 | 1985/1985 | PASS | 2026-05-17 |
| 118 | move-to-backlog — POST /api/external/tasks/:id/backlog + Move-to-Backlog menu items + draft-sticky transcript guard + Resume-vs-Launch fix | iterate | mixed | +0 | 1994/1994 | PASS | 2026-05-17 |
| 119 | Resume guard survives a browser reload — ptyReused ready-envelope flag arms the one-shot inject guard on a reused pty | iterate | mixed | +0 | 1939/1940 | FAIL | 2026-05-17 |
| 120 | Remove orphaned Resume-CTA liveness-gate code (getLastPtyDataAt/isAltBufferActive/altScreenActive/lastPtyDataAt) — dead since PR #29; eliminates a flaky CI test | iterate | unit | +0 | 1935/1935 | PASS | 2026-05-17 |
| 121 | Production build copies non-TS runtime assets into dist/ (fixes /actions HTTP 500) | iterate | unit | +0 | 1069/1069 | PASS | 2026-05-16 |
| 122 | Remove Resume-CTA activity gate; one-shot inject guard; Copy Resume command; fix Copy session UUID | iterate | unit | +0 | 1948/1948 | PASS | 2026-05-16 |
| 123 | terminal-smear-interleave — replay drain gate eliminates the embedded-terminal reattach smear (Bug B); ADR-099 WebGL atlas machinery removed | iterate | mixed | +0 | 892/892 | PASS | 2026-05-16 |
| 124 | evt-70d06e02 | iterate | — | +0 | — | — | 2026-05-15 |
| 125 | terminal-smear-reset — replay-snapshot remount smear fix (term.write callback) + WS reset banner | iterate | unit | +0 | 1885/1885 | PASS | 2026-05-15 |
| 126 | close-task-redirect — Close task in TaskDetail header now redirects to the task board | iterate | unit | +0 | 857/857 | PASS | 2026-05-15 |
| 127 | triage-card-styling — white-surface cards + wizard-matched dialogs | iterate | mixed | +0 | 855/855 | PASS | 2026-05-15 |
| 128 | docs(guide): document SHIPWRIGHT_NETWORK_PROFILE + .env.local workflow | backfill-retro | — | — | — | — | 2026-05-10 |
| 129 | fix(client): accept MagicDNS hostnames in Vite allowedHosts for tailscale profile | backfill-retro | — | — | — | — | 2026-05-10 |
| 130 | fix(server): wire SHIPWRIGHT_NETWORK_PROFILE into Trusted-Origin policy | backfill-retro | — | — | — | — | 2026-05-10 |
| 131 | fix(cli-compat): use platform-aware path module in selfHealClaudePath | backfill-retro | — | — | — | — | 2026-05-11 |
| 132 | Merge pull request #8 from svenroth-ai/fix/cli-compat-cross-platform-path | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 133 | fix(server,test): wire boot-time Trusted-Origin policy into WS upgrade gate (ADR-083) | backfill-retro | — | — | — | — | 2026-05-11 |
| 134 | Merge iterate/v0.9.1-tailscale-ws-real-browser-fix | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 135 | chore(workflows): drop dormant security + claude-review workflows from monorepo templates | backfill-retro | — | — | — | — | 2026-05-11 |
| 136 | Merge pull request #9 from svenroth-ai/chore/scaffold-security-and-claude-review-workflows | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 137 | chore(security): sync security.yml from monorepo (codeql v4 + continue-on-error) | backfill-retro | — | — | — | — | 2026-05-11 |
| 138 | Merge pull request #10 from svenroth-ai/chore/security-workflow-v4-and-private-repo-support | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 139 | Merge iterate/v0.9.2-embedded-terminal-mount-races (ADR-084) | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 140 | Merge branch 'main' of https://github.com/svenroth-ai/shipwright-webui | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 141 | Merge iterate/v0.9.3-resume-state-machine (ADR-085) | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 142 | Merge iterate/v0.9.4-skip-replay-newplain (ADR-086) | backfill-merge-retro | — | — | — | — | 2026-05-11 |
| 143 | feat(server): wire @xterm/headless mirror behind feature flag (ADR-088 Iterate A) | backfill-retro | — | — | — | — | 2026-05-11 |
| 144 | feat(server,client): replay_snapshot envelope + flag flip + snapshot-store hardening (ADR-089) | backfill-retro | — | — | — | — | 2026-05-11 |
| 145 | refactor(terminal): retire ADR-069/077/079/086 compensations; snapshot-only replay (ADR-087) | backfill-retro | — | — | — | — | 2026-05-12 |
| 146 | docs(terminal): sweep stale chunked-replay references post-ADR-087 (campaign code-review follow-up) | backfill-retro | — | — | — | — | 2026-05-12 |
| 147 | Merge iterate/headless-A-mirror-flag (ADR-088 — campaign headless-terminal-refactor A) | backfill-merge-retro | — | — | — | — | 2026-05-12 |
| 148 | Merge iterate/headless-B-snapshot-protocol (ADR-089 — campaign headless-terminal-refactor B) | backfill-merge-retro | — | — | — | — | 2026-05-12 |
| 149 | Merge iterate/headless-C-retire-compensations (ADR-087 — campaign headless-terminal-refactor C; supersedes ADR-069/077/079/086) | backfill-merge-retro | — | — | — | — | 2026-05-12 |
| 150 | fix(server): mark @xterm/headless fixture as binary; pin LF-normalized size | backfill-retro | — | — | — | — | 2026-05-12 |
| 151 | fix(server): live-pty replay via serialize-on-attach + snapshot-on-detach (ADR-092) | backfill-retro | — | — | — | — | 2026-05-12 |
| 152 | docs(server,test): sweep stale disk-first comment + tighten cursor axis assertion (E code-review follow-up) | backfill-retro | — | — | — | — | 2026-05-12 |
| 153 | Merge iterate/headless-E-live-pty-snapshot-fix (ADR-092 — closes ADR-091 live-pty replay regression) | backfill-merge-retro | — | — | — | — | 2026-05-12 |
| 154 | Merge iterate/headless-F-xterm-config-vorbild-align (ADR-093 — xterm.js Vorbild-Alignment for in-session status-pane stacking fix) | backfill-merge-retro | — | — | — | — | 2026-05-13 |
| 155 | Merge iterate/headless-G-flicker-env-and-resume-gating (ADR-095 — Claude TUI flicker env + Resume button gating) | backfill-merge-retro | — | — | — | — | 2026-05-13 |
| 156 | Merge iterate/headless-H-snapshot-preservation-taskcard-gating (ADR-096 — finalizeMirrorSnapshot preservation heuristic + TaskCard Resume gating) | backfill-merge-retro | — | — | — | — | 2026-05-13 |
| 157 | refactor(client,server): upgrade xterm.js 5.5.0 -> 6.0.0 (ADR-097) | backfill-retro | — | — | — | — | 2026-05-13 |
| 158 | test(e2e): migrate readXtermRows helper from DOM-locator to buffer-peek | backfill-retro | — | — | — | — | 2026-05-13 |
| 159 | Merge iterate/xterm-6-upgrade (ADR-097 — xterm.js 5.5.0 → 6.0.0; amends ADR-088 pin + ADR-095 NO_FLICKER default) | backfill-merge-retro | — | — | — | — | 2026-05-13 |
| 160 | refactor(client): refresh NewIssueModal copy to match auto-execute flow | backfill-retro | — | — | — | — | 2026-05-13 |
| 161 | Merge iterate/refresh-newissue-tooltips — NewIssueModal copy aligned to auto-execute embedded-terminal flow (ADR-068-A1) | backfill-merge-retro | — | — | — | — | 2026-05-13 |
| 162 | Merge iterate/headless-J-restore-no-flicker-default (ADR-098 — restore NO_FLICKER default after empirical Claude #37283 finding) | backfill-merge-retro | — | — | — | — | 2026-05-13 |
| 163 | feat(client): surface Resume CTA on state=active when pty is gone | backfill-retro | — | — | — | — | 2026-05-14 |
| 164 | fix(client): drop liveSession gating — Resume CTA always shows on idle/active | backfill-retro | — | — | — | — | 2026-05-14 |
| 165 | fix(server): refine new-plain Resume gate — emit --resume when JSONL exists | backfill-retro | — | — | — | — | 2026-05-14 |
| 166 | feat(server,client): introduce altScreenActive — hide Resume while TUI is foregrounded | backfill-retro | — | — | — | — | 2026-05-14 |
| 167 | Merge pull request #11 from svenroth-ai/iterate/resume-cta-active-state | backfill-merge-retro | — | — | — | — | 2026-05-14 |
| 168 | fix(terminal): WebGL load-order + rescaleOverlappingGlyphs (ADR-099) | backfill-retro | — | — | — | — | 2026-05-14 |
| 169 | Merge pull request #12 from svenroth-ai/iterate/codex-rescue-altscreen-rendering | backfill-merge-retro | — | — | — | — | 2026-05-14 |
| 170 | docs(guide): align launch flow to embedded-terminal auto-execute | backfill-retro | — | — | — | — | 2026-05-14 |
| 171 | docs(client): drop stale "nothing copies" from Save-to-Backlog tooltip | backfill-retro | — | — | — | — | 2026-05-14 |
| 172 | docs(claude-md): align WHAT/Architecture rules to embedded-terminal auto-execute + close Structure drift | backfill-retro | — | — | — | — | 2026-05-14 |
| 173 | docs(changelog): add two unreleased drops for CLAUDE.md alignment + Structure drift fix | backfill-retro | — | — | — | — | 2026-05-14 |
| 174 | Merge pull request #13 from svenroth-ai/docs/launch-flow-and-tooltip-alignment | backfill-merge-retro | — | — | — | — | 2026-05-14 |
| 175 | feat(wizard): render stack-profile step dynamically from /api/profiles | backfill-retro | — | — | — | — | 2026-05-14 |
| 176 | Merge pull request #15 from svenroth-ai/iterate/lead-foundation-task-schema | backfill-merge-retro | — | — | — | — | 2026-05-14 |
| 177 | feat(triage): WebUI Triage Tab + Promote bridge (FR-01.30, ADR-101) | backfill-retro | — | — | — | — | 2026-05-15 |
| 178 | docs(readme): add Triage tab section (FR-01.30, ADR-101) | backfill-retro | — | — | — | — | 2026-05-15 |
| 179 | Merge pull request #16 from svenroth-ai/iterate/post-merge-resume-gate-and-replay-smear | backfill-merge-retro | — | — | — | — | 2026-05-15 |
| 180 | Merge pull request #17 from svenroth-ai/iterate/triage-tab | backfill-merge-retro | — | — | — | — | 2026-05-15 |
| 181 | Iterate M (Resume CTA active-state followup) + ADR-099 v10 (post-replay maintenance) | iterate-M-retro | — | — | — | — | 2026-05-15 |
| 182 | Merge PR #14: Iterate K v1-v9 (xterm.js 6.0 atlas-corruption workaround) | iterate-K-merge-retro | — | — | — | — | 2026-05-14 |
| 183 | Iterate K v9: post-launch-settle backstop (4s after consumeLaunch) for Resume-click-in-long-mounted-tab | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 184 | Iterate K: ?atlasMaintenance=off kill switch + A/B regression probes (stills + video) | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 185 | Iterate K v8: DOM wheel listener (Tabby pattern) + 10-scenario systematic Playwright probe | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 186 | Iterate K v7: pre-init lastWriteTime + post-mount-settle backstop | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 187 | Iterate K cherry-pick: D-e2e task-type matrix | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 188 | Iterate K Vite WS proxy: swallow ECONNRESET/ECONNABORTED/EPIPE | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 189 | Iterate K v6: burst-after-2s-quiet trigger via onWriteParsed | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 190 | Iterate K v5: split main = clear+refresh, alt = refresh-only | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 191 | Iterate K v4: skip atlas-clear in alt-screen buffer | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 192 | Iterate K v3: conditional via onWriteParsed counter (skip when idle) | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 193 | Iterate K v2: 10s periodic + term.refresh() after clear | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 194 | Iterate K v1: 30s periodic clearTextureAtlas + onScroll | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 195 | server-side ?1006h re-emit in replay-snapshot envelope (Iterate K) | iterate-K-retro | — | — | — | — | 2026-05-14 |
| 196 | leadwright Phase 1 ExternalTask extension (13 optional fields) | iterate | unit | +0 | 1780/1780 | PASS | 2026-05-14 |
| 197 | Restore CLAUDE_CODE_NO_FLICKER=1 default (ADR-098 - Iterate J) | iterate-runner | unit | +1720 | 1720/1720 | PASS | 2026-05-13 |
| 198 | Iterate H — Snapshot preservation on pty death + TaskCard Resume gating (ADR-096) | iterate | unit | +10 | 1717/1717 | PASS | 2026-05-13 |
| 199 | Iterate G — Claude TUI flicker env + Resume button gating (ADR-095) | iterate-G | unit | +1707 | 1707/1707 | PASS | 2026-05-13 |
| 200 | dynamic-stack-profiles: wizard step 2 renders from /api/profiles + bundled snapshot refresh (ADR-094) | iterate | mixed | +0 | 786/786 | PASS | 2026-05-12 |
| 201 | Iterate F headless-terminal-refactor: xterm.js convertEol+allowProposedApi+scrollback alignment + WebglAddon try/catch fallback; follow-on to ADR-092 for in-session status-pane redraw stacking (ADR-093) | iterate | unit | +0 | 777/777 | PASS | 2026-05-12 |
| 202 | v0.9.4 skip disk-scrollback replay on attach for new-plain tasks (Claude TUI byte-stacking corruption fix; ADR-086) | iterate | mixed | +0 | 1636/1636 | PASS | 2026-05-11 |
| 203 | v0.9.3 resume state-machine: scope active→idle JSONL-mtime decay to non-new-plain (ADR-085) | iterate | mixed | +0 | 1636/1636 | PASS | 2026-05-11 |
| 204 | v0.9.2 embedded terminal mount races: 1500ms readOnly banner grace + safeFit/disposedRef/_renderService dimensions stub (ADR-084) | iterate | mixed | +0 | 1631/1631 | PASS | 2026-05-11 |
| 205 | env-local-loading-fix: tsx --env-file-if-exists for server + loadEnv with envDir for Vite. Closes ADR-081 wiring gap. ADR-082. | iterate | unit | +0 | 1606/1606 | PASS | 2026-05-10 |
| 206 | network-profile-flag: SHIPWRIGHT_NETWORK_PROFILE env-flag (local/tailscale/open) unifies Vite + Hono dev-server bind. Tailscale auto-detect via subprocess + env override. Closes Vite-proxy gap when Hono binds non-loopback. ADR-081. | iterate | unit | +0 | 1586/1586 | PASS | 2026-05-10 |
| 207 | tsc-baseline-fix: retire 4 documented tsc baseline errors (3x cross-package imports + missing @types/proper-lockfile). server npm run build exits 0; install-windows.ps1 step [3/4] runs clean. Type mirrors under server/src/types/ + comment-aware drift-guard test. ADR-080. | iterate | unit | +0 | 1508/1508 | PASS | 2026-05-09 |
| 208 | v0.8.9 replay-pushdown: live shell at viewport top after replay-on-attach (FR-01.28 v0.8.9 AC-1) | iterate | mixed | +0 | 1500/1500 | PASS | 2026-05-09 |
| 209 | HONO_HOST opt-in: backend default-binds loopback, opt-in for non-loopback | iterate | unit | +0 | 8/8 | PASS | 2026-05-07 |
| 210 | HONO_HOST opt-in: backend default-binds loopback, opt-in for non-loopback | iterate | unit | +0 | 8/8 | PASS | 2026-05-07 |
| 211 | VITE_HOST opt-in for LAN/Tailscale dev-server access | iterate | unit | +0 | 7/7 | PASS | 2026-05-07 |
| 212 | v0.8.2 follow-up: disclosure null-handling fix, Show-ignored toggle rename, Spec 79 live-browser smoke (5 tests covering AC-2/4/7/8/9). 1399/1399 unit + 37/37 e2e green. | iterate | mixed | +0 | 1399/1399 | PASS | 2026-05-06 |
| 213 | v0.8.2 polish — Spec 74 modal flake (AC-1) + xterm dark theme for Claude TUI legibility (AC-2) + Ctrl+V parity (AC-3) + image-paste latency reduction (AC-4) + awaiting-launch diag logs (AC-5) + paste-dir migration to .shipwright-webui/pastes/ (AC-6) + replay-only mode for done/launch_failed tasks (AC-7) + conditional disclosure footer (AC-8) + retention copy interpolation (AC-9). 1398/1398 unit + 33/33 e2e green. ADR-070. | iterate | mixed | +0 | 1398/1398 | PASS | 2026-05-06 |
| 214 | Post-v0.8 stabilization (Tier 0): AC-1 scrollback ANSI sanitizer + AC-3 per-conn pause refcount + writer-stuck watchdog. AC-2 deferred to follow-up. ADR-069. 1369/1369 unit tests green. | iterate | unit | +0 | 1369/1369 | PASS | 2026-05-05 |
| 215 | Embedded-terminal auto-launch + disk-backed scrollback persistence (ADR-068-A1) — clipboard-free one-click Launch via LaunchCoordinatorContext + WS data-frame; pty.onData appends to <scrollbackDir>/<taskId>.log via fs.appendFileSync with 3-state rotation; replay-on-attach with pty.pause/resume + chunked envelopes; new POST /clear-scrollback + Stop terminal session + Clear history modal; privacy disclosure footer. | iterate | unit | +0 | 1320/1320 | PASS | 2026-05-04 |
| 216 | Embedded terminal launcher (ADR-067) — Phase 6.1 fixes after second external code-review pass + live integration smoke. CRITICAL: ESM require bug broke every WS upgrade; Vite proxy missing ws:true; header CTA missing webui:launch-copied dispatch. Plus task.cwd realpath validation, paste-image auto-spawn, Content-Length missing/invalid handling, empty-text-paste path, paste-image error toast, browser-level paste E2E. 1273 unit + 12 Playwright tests green against real Chromium + Hono + xterm + node-pty. | iterate | mixed | +0 | 1285/1285 | PASS | 2026-05-04 |
| 217 | Embedded terminal launcher (ADR-067) — Phase 6 post-code-review hardening: writer-conn idempotency (CRITICAL); /append-gitignore 404 ordering; /paste-image writer-gate; Origin gate; second-attach envelope; toast-error UX; browser-level paste-event E2E. 1273/1273 tests green. | iterate | unit | +0 | 1273/1273 | PASS | 2026-05-03 |
| 218 | Embedded terminal launcher (xterm.js + node-pty + WebSocket image-paste flow) — Plan-D''-conform shell pane in TaskDetail; replaces external-terminal-only launches; closes Anthropic claude-cli image-paste gap (Issue #51244); ADR-067. | iterate | unit | +0 | 1269/1269 | PASS | 2026-05-03 |
| 219 | Persistent virtualizer measurement cache + cold-cache warmup pass (5th attempt at slow-scroll jump; ADR-066) — merge to main | iterate | unit | +0 | 657/657 | PASS | 2026-05-02 |
| 220 | Persistent virtualizer measurement cache + cold-cache warmup pass (5th attempt at slow-scroll jump; ADR-066) | iterate | unit | +0 | 657/657 | PASS | 2026-05-02 |
| 221 | filter null-rendering events out of virtualized transcript (ADR-065; rapid-scroll partial fix; slow-scroll deferred to follow-up) | iterate | unit | +0 | 640/640 | PASS | 2026-05-02 |
| 222 | useTaskTranscript polling cascade fix (residual scroll-up flicker) | iterate | unit | +0 | 635/635 | PASS | 2026-05-01 |
| 223 | overflow-anchor virtualized carve-out (scroll-up flicker root cause) | iterate | unit | +0 | 634/634 | PASS | 2026-05-01 |
| 224 | virtualizer flicker fix (merge) | iterate | unit | +0 | 632/632 | PASS | 2026-05-01 |
| 225 | virtualizer flicker fix | iterate | unit | +0 | 632/632 | PASS | 2026-05-01 |
| 226 | system chips alignment + scroll polish (merge) | iterate | unit | +0 | 632/632 | PASS | 2026-05-01 |
| 227 | system chips alignment + scroll polish | iterate | unit | +0 | 632/632 | PASS | 2026-05-01 |
| 228 | task-notification rendering | iterate | unit | +0 | 624/624 | PASS | 2026-05-01 |
| 229 | VS Code .code-workspace auto-generated on POST /api/projects | iterate | unit | +0 | 537/537 | PASS | 2026-05-01 |

## Full Suite Runs

| Run | Trigger | Unit | Integration | pgTAP | E2E | Smoke | Date |
|-----|---------|------|-------------|-------|-----|-------|------|
| 1 | iterate | 979/979 | — | — | — | — | 2026-05-19 |
| 2 | iterate | 2135/2135 | — | — | — | — | 2026-05-19 |
| 3 | iterate | 2189/2189 | — | — | — | — | 2026-05-20 |
| 4 | iterate | 2184/2184 | — | — | — | — | 2026-05-21 |
| 5 | iterate | 2193/2193 | — | — | — | — | 2026-05-21 |
| 6 | iterate | 2193/2193 | — | — | — | — | 2026-05-21 |
| 7 | iterate | 1174/1174 | — | — | — | — | 2026-05-22 |
| 8 | iterate | 2198/2198 | — | — | — | — | 2026-05-22 |
| 9 | iterate | 1066/1066 | — | — | — | — | 2026-05-23 |
| 10 | iterate | 22/22 | — | — | — | — | 2026-05-25 |
| 11 | iterate | 14/14 | — | — | — | — | 2026-05-25 |
| 12 | iterate | 1124/1124 | — | — | — | — | 2026-05-26 |
| 13 | iterate | 20/20 | — | — | — | — | 2026-05-26 |
| 14 | iterate | 1279/1279 | — | — | — | — | 2026-05-26 |
| 15 | iterate | 1274/1274 | — | — | — | — | 2026-05-26 |
| 16 | iterate | 1345/1345 | — | — | — | — | 2026-05-30 |
| 17 | iterate | 1335/1335 | — | — | — | — | 2026-05-30 |
| 18 | iterate | 1331/1331 | — | — | — | — | 2026-05-30 |
| 19 | iterate | 1550/1550 | — | — | — | — | 2026-06-05 |
| 20 | iterate | 1557/1557 | — | — | — | — | 2026-06-07 |
| 21 | iterate | 3/3 | — | — | — | — | 2026-06-12 |
| 22 | iterate | 1609/1609 | — | — | — | — | 2026-06-12 |
| 23 | iterate | 1611/1611 | — | — | — | — | 2026-06-12 |
| 24 | iterate | 1/1 | — | — | — | — | 2026-06-13 |
| 25 | iterate | 24/24 | — | — | — | — | 2026-06-14 |
| 26 | iterate | 1637/1637 | — | — | — | — | 2026-06-14 |
| 27 | iterate | 38/38 | — | — | — | — | 2026-06-14 |
| 28 | iterate | 1652/1652 | — | — | — | — | 2026-06-14 |
| 29 | iterate | 1668/1668 | — | — | — | — | 2026-06-14 |
| 30 | iterate | 1672/1672 | — | — | — | — | 2026-06-15 |

## Code Review Evidence

| Event | Review Type | Findings | Fixed | Status |
|-------|------------|----------|-------|--------|
| evt-956e1c71 | self+skipped-cascade-doc-only | 0 | 0 | PASS |

