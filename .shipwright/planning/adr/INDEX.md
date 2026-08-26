# ADR Spec Folder — INDEX

_Auto-generated — do not edit by hand. Each row's title comes from that
ADR file's own `#` heading, so change the heading, not this file._

_Regenerate:_ `uv run {shared_root}/scripts/tools/rebuild_adr_index.py --project-root .`

- [ADR-058 — spec — WebUI three-fix bundle: stuck Awaiting-launch state, chat padding, system pills](058-webui-three-fix-bundle.md)
- [ADR-087 — spec — Cell-state snapshot replay supersedes byte-stream chunked replay (Iterate C)](087-cell-state-snapshot-iterate-c.md)
- [ADR-088 — spec — Server-side @xterm/headless mirror (Iterate A)](088-headless-mirror-iterate-a.md)
- [ADR-095 — spec — Claude TUI flicker workaround + Resume-button gating via liveSession](095-claude-tui-flicker-workaround.md)
- [ADR-096 — spec — Iterate H: snapshot preservation on pty death + TaskCard Resume gating](096-snapshot-preservation-taskcard-resume.md)
- [ADR-098 — spec — Iterate J: restore `CLAUDE_CODE_NO_FLICKER=1` default to opt-out](098-restore-no-flicker-default.md)
- [ADR-099 — spec — Iterate K: xterm.js 6.0 WebGL atlas-corruption workaround + addon-serialize SGR-encoding fix (v1 → v8)](099-xterm6-webgl-atlas-workaround.md)
- [ADR-100 — spec — Campaign C, sub-iterate C1: CLAUDE.md verification (Phase-0f organic outcome)](100-campaign-c-c1-verification.md)
- [ADR-101 — Bloat exception — `server/src/terminal/pty-manager.ts` raised to 1198-LOC](101-bloat-exception-pty-manager.md)
- [ADR-102 — Campaign C — C4 — NewIssueModal.tsx split](102-campaign-c-c4-new-issue-modal-split.md)
- [ADR-102 — Campaign C / C6: TaskDetailHeader split into stable-props sub-components](102-campaign-c-c6-task-detail-header-split.md)
- [ADR-103 — Bloat exception — `server/src/terminal/routes.ts` raised to 1013-LOC](103-bloat-exception-terminal-routes.md)
- [ADR-131 — Touch-scroll resolves to a no-op inside DECSET-1049 alt-buffer (Claude Code TUI)](131-touch-scroll-alt-buffer-no-op.md)
- [ADR-132 — Touch-scroll routes by xterm buffer type: alt-buffer → pty keystrokes, normal-buffer → scrollLines](132-touch-scroll-buffer-aware-routing.md)
- [ADR-133 — Touch-scroll replicates the mouse wheel: a synthetic WheelEvent on `term.element`, not hand-rolled arrow keys](133-touch-scroll-wheel-events.md)
- [ADR-134 — ADR — S2: Tests · Review · Decisions Mission artifacts](134-mission-artifacts-tests-review-decisions.md)
- [ADR-135 — ADR — S3: native pipeline + campaign artifacts, scenario-6 hardening, typography](135-mission-artifacts-pipeline-campaign-polish.md)
- [ADR-136 — ADR — S4: "Where it stands" derived from the session's REAL phase](136-mission-honest-lifecycle-stage.md)
- [ADR-137 — ADR — Decisions reads the drops; the campaign store stops calling a degraded read "ok"](137-mission-decisions-drops-store-honesty.md)
- [ADR-138 — ADR — Answering Claude's mid-run question from the Inbox: spiked, measured, NOT built](138-inbox-answer-in-place-not-built.md)
- [ADR-139 — ADR — Epoch-gated resolution of `tests.total` (collected vs executed)](139-tests-total-skip-contract.md)
- [Triage amend event support (reader parity + Edit-in-place UI)](iterate-2026-08-08-triage-amend-reader.md)
- [ADR — Cap the terminal launch-preview banner's height](iterate-2026-08-14-terminal-launch-preview-height-terminal-launch-preview-height.md)
- [ADR: Fix phone new-task E2E test assertion, not the component](iterate-2026-08-15-phone-new-project-test-fix-phone-new-project-test-fix.md)
- [ADR: Task lifecycle UX fixes — Edit Task parity, Launch-from-Backlog, Reopen re-arm](iterate-2026-08-16-task-lifecycle-ux-fixes.md)
- [ADR: Complete the hono CVE fix (bootstrapper/ + both declared floors)](iterate-2026-08-17-hono-cve-bootstrapper-followup-hono-cve-fix.md)
- [Leads org route](iterate-2026-08-17-org-route-leads.md)
- [Beat-register release, last-run staleness, and open-register finding](iterate-2026-08-18-org-route-beat-register-release.md)
- [ADR: Reader-role WS connections may send SGR mouse reports to the shared pty](iterate-2026-08-24-terminal-readonly-scroll-copy.md)
- [Mission feed: restore a turn's own words, drop the narration toggle](iterate-2026-08-25-mission-feed-progress-narration-explanation-scope.md)
- [ADR: Route grade.py and triage_cli.py through `uv run`, never a bare system Python](iterate-2026-08-26-grade-uv-run-uv-run-spawn.md)
