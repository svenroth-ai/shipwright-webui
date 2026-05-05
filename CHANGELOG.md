# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [v0.8.0] - 2026-05-05

### Added

- Embedded xterm.js terminal in TaskDetail with WebSocket-bidirectional pty + Strg+V image-paste support — replaces external-terminal-only launches for Claude sessions and closes the Claude-CLI clipboard-image gap (Anthropic Issue #51244). New Toggle-Tab in TaskDetailPage with localStorage-persisted choice, lazy-loaded EmbeddedTerminal, automatic tab-flip + focus on launch CTA, image-paste flow with Keep-Last-N retention under <task.cwd>/.claude-pastes/ and an optional .gitignore-suggestion toast (ADR-067).
- Embedded-terminal one-click auto-launch — clicking Launch in TaskDetailHeader now flips to the Terminal tab and writes the launch command directly into the embedded shell (zero clipboard interaction; ADR-068-A1)
- Disk-backed terminal scrollback persistence (24h TTL, configurable via SHIPWRIGHT_TERMINAL_SCROLLBACK_TTL_DAYS) — terminal history survives nav-away, page-reload, browser-restart, and OS-reboot; replay-on-attach via WS chunked envelopes (ADR-068-A1)
- TaskDetailHeader: 'Stop terminal session' + 'Clear terminal history' (with confirm-modal) menu items + 'About to run' preview disclosure + privacy footer note in Terminal pane (ADR-068-A1)

### Changed

- POST /api/terminal/:taskId/close semantics: now kills pty only — scrollback retained on disk; new POST /api/terminal/:taskId/clear-scrollback handles destructive history cleanup (Decision #18 — separate Stop vs Clear)

### Fixed

- Embedded terminal: post-code-review hardening — writer-conn now stays writer on subsequent messages (CRITICAL: would have broken xterm input in real browser testing); /append-gitignore correctly returns 404 when .gitignore is missing; /paste-image gates pty.write on a live writer; WS Origin gate refuses missing Origin; reader-role attachers receive explicit {type:'second-attach'} envelope; gitignore-suggestion toast stays open with structured error message when /append-gitignore fails; Spec 73 gains a browser-level paste-event case (synthetic image+text ClipboardEvent on xterm container) (ADR-067 phase 6).
- Embedded terminal Phase-6.1 — caught by integration smoke (1273 unit tests didn't): ESM require-not-defined error broke every WS upgrade in dev; Vite proxy was missing ws:true (embedded-terminal unreachable in npm run dev); TaskDetailHeader launch CTA didn't dispatch webui:launch-copied so the tab-flip never fired from the primary surface. Plus second-review hardening: task.cwd realpath-validated up front; paste-image auto-spawns pty + response carries ptyWritten; paste-image error toast surfaces upload failures; missing Content-Length now rejected (chunked-transfer cap bypass); empty-text paste preventDefault for predictable single-path. 12 Playwright tests green against the real stack (ADR-067 phase 6.1).
- Embedded terminal Phase-6.2 — caught only by user-side live smoke (1273 unit tests + 12 Playwright tests didn't): React StrictMode triple-WS race left the read-only banner stuck on fresh tasks (per-effect cancelled flag now isolates stale handlers); xterm white-on-beige (foreground bound to brand --color-text + 16 ANSI slots pinned to brand-readable values; Claude Code true-color downgraded via TERM=dumb + FORCE_COLOR=1 since supports-color overrides everything else on Windows); navigator.clipboard.writeText silently rejected during React re-render (textarea+execCommand fallback added to both launch surfaces). Plus auto-promote on writer detach so the StrictMode race resolves cleanly via {type:writer-promoted} envelope (ADR-067 phase 6.2).
- Embedded terminal Phase-3 review fold — 8 HIGH + 4 MEDIUM external-review findings: the prompt-readiness handshake hard-cap is now a CANCEL boundary (not permission to inject blindly); explicit `coord.cancelLaunch("timeout")` on expired pending entries surfaces a deterministic cancel-reason instead of silently returning; LaunchCoordinator unmount-cancel reverted (StrictMode dev mount→cleanup→mount loop was cancelling every dispatch); sessionStorage handover idempotent on StrictMode re-fire; reader-role attachers cancel pending launches with `role-not-writer` reason; pendingFocus retry-on-ready cleared after consumption (was sticky); WS connection lifecycle traced with stable connToken so subscribe/unsubscribe pairs survive reconnect; PtyManager.detach() no longer logs "no entry" on legitimate close (ADR-068-A1 phase 3).
- Embedded terminal Phase-5 review fold + Codex final-pass — separate "Stop terminal session" action (clean kill-pty) split from "Clear terminal history" (destructive scrollback wipe with confirm-modal) because the prior single action mixed two different intents; honest TTL disclosure copy ("default 24h, configurable via SHIPWRIGHT_TERMINAL_SCROLLBACK_TTL_DAYS") replaced vague "may be retained" wording; Terminal CTA in TaskDetailHeader is now a pure tab-flip on `active`/`awaiting_external_start` states (dispatches `webui:focus-terminal-tab` instead of writing the launch command — the pty is already running, no need to re-execute); AC-16 about-to-run preview banner shows the actual command bytes that will hit the pty before injection so the user has a clipboard-style visual gate; `paste-image` flow surfaces structured upload errors via toast instead of swallowing them silently (ADR-068-A1 phase 5 + Codex final-pass).
- Auto-launch from TaskCard / NewIssueModal now reaches the embedded terminal deterministically (post-finalization UAT-fold). Previously failed in roughly half of clicks: when a new WebSocket attached to an existing pty (StrictMode dev double-mount; or a genuine multi-tab handoff), the server emitted `ready{role:"reader"}` followed within ~5 ms by `writer-promoted` once the previous writer's close handler fired, but the client cancelled the pending launch immediately on the first reader signal — losing the launch before the promotion landed. `TaskDetailPage.handleTerminalReady` now defers the reader-cancel by a 1500 ms stability window; the cancel is cleared when the role flips to writer (the typical promotion case) and only fires when the role genuinely stays reader (real second-tab scenario). New `client/e2e/flows/76-autolaunch-reader-writer-race.spec.ts` regression guard drives all 3 previously-failing UAT flows × 3 repetitions and observes outcome via WebSocket frame capture (looks for `claude --session-id` in the data-frame stream).
- Cumulative auto-launch session fixes (post-finalization UAT-fold): (a) cold-pty prompt-readiness handshake gained a 1500 ms no-data grace path because Windows pwsh `$PROFILE` / oh-my-zsh / Starship cold starts can stay silent for 500–1500 ms — sometimes exceeding the prior 3 s hard cap; absolute cancel boundary raised to 15 s for worst-case profile init. (b) `actionId` persists across Save-to-Backlog launches: `POST /api/external/tasks` now accepts `actionId` in the body, and `sdk-sessions-store`'s loader preserves `actionId` / `phase` / `phaseLabel` / `description` / `autonomy` on disk-reload (was silently dropping all five). (c) `wantResume` default narrowed to `task.state === "active" || "idle"` (was `state !== "draft"`); `awaiting_external_start` / `launch_failed` / `jsonl_missing` no longer emit `claude --resume <uuid>` for sessions that never started. (d) pty survives WS detach — `pty-manager.detach()` no longer kills the pty when the last subscriber leaves; orphan GC now via 30 min idle ceiling + explicit user actions. (e) `EmbeddedTerminal` refs reset on `taskId` change so the prior task's "data seen" / "consumed token" state can't short-circuit the next task's prompt-readiness handshake. New `client/e2e/flows/75-launch-matrix-and-session-persistence.spec.ts` adds API-level launch-matrix coverage (4 direct-launch tests assert correct slash command per action-id, 4 backlog-launch tests assert `task.actionId` is recovered server-side, 1 session-persistence test verifies pty identity across WS detach/re-attach).
- Plain Claude (new-plain) tasks no longer show a phase pill on TaskCard, TaskList, or TaskDetailHeader. The `derivePhaseFromTitle` keyword fallback was firing on free-form chat titles (e.g. "build my prototype" → phase=build), but Plain Claude is a free chat scoped to the project's directory and has no phase by design. All three call-sites now early-return when `task.actionId === "new-plain"` (TaskList keeps the em-dash placeholder for stable column width).

## [v0.7.0] - 2026-05-02

### Added

- Auto-generate .code-workspace on POST /api/projects so projects open in VS Code with one double-click (terminal-in-editor layout).
- **Settings → Configure actions** now lists every registered project with a state badge (Custom / Bundled / Malformed) and lets you upload or reset `.webui/actions.json` directly from the UI. Files are validated against the actions schema (JSON-parse + `validateActionsSchema` + contract version + `command_template` placeholder dry-run) before they overwrite anything on disk; oversized payloads (>256 KB) are rejected via a `Content-Length` pre-check, and every write goes through the same `realpath + path.relative` traversal guard the rest of the file/tree routes use. Reset is enabled even when the on-disk file is malformed so you can recover without opening a terminal. The reset confirmation uses the same Radix dialog pattern as the rest of the WebUI.

### Changed

- Transcript layout: all system chips (system, custom-title, agent-name, permission-mode, slash-command, task-notification) now render left-aligned with the assistant bubbles instead of centered.

### Fixed

- Transcript flicker during slow scroll-up: useAutoScroll now suppresses programmatic re-pin for 250 ms after the last user scroll event, so 1 Hz polling ticks no longer yank the user back to the bottom while they are still within the near-bottom threshold.
- Background-task completion notifications (Claude Code v2.1.119+) now render as a centered status chip in the transcript instead of a right-aligned user bubble showing raw <task-notification> XML.
- Transcript scroll-up flicker on long sessions (>=200 visible events): virtualizer now keys row measurements to event identity and batches ResizeObserver updates per paint frame, so dynamic-height rows stop jerking the visible window during scroll.
- Eliminate slow scroll-up content cascade on long virtualized BubbleTranscript transcripts (200+ events). Per-row measurement sizes are persisted to localStorage per session and rehydrated on mount; on a cold cache, a one-frame warmup pass measures all visible rows before the user can scroll. Solves "Er zieht den Code nach" symptom (ADR-066, 5th attempt; ADR-063 + ADR-064 reverted, ADR-062 + ADR-065 preserved).
- Eliminate residual scroll-up flicker on tool-heavy virtualized transcripts by filtering null-rendering events (tool_result-only-and-all-folded user events; filename-less attachment events) out of the virtualizer's items list — closes the 4th attempt at this bug after ADR-062/063/064. (ADR-065)

## [0.6.0] - 2026-04-27

### Added

- **Multi-session pipeline integration (v2 run-config orchestrator).** WebUI now reads `shipwright_run_config.json` schemaVersion 2 from registered projects and renders one Master TaskCard per Run on the TaskBoard, grouped above the kanban columns. Each phase_task is shown with phase / splitId / status / sessionUuid; awaiting_launch tasks expose a green Continue button that copies the framework's launch command. A new "+ New ▾ → Continue Pipeline" entry surfaces when an in-progress run has at least one ready phase_task; the modal pre-populates from `readyToLaunchTasks[]` and supports parallel branches (per_split runs) via a radio list. Failure / needs_validation / complete / stale states render with copy-able `recover-phase-task` snippets. v1 run-configs and missing configs render the legacy flat task path unchanged. Continuation always funnels through one shared code path (`useContinuePipeline`) so every entry surface (Master CTA, dropdown menu, future TaskDetail header) stays consistent. Server-side launch verification re-reads run-config on every `phaseTaskRef` launch and rejects mismatched session-uuids / non-actionable status / unmet prerequisites — the client never dictates the resolved command.

## [0.5.0] - 2026-04-26

### Added
- feat(webui): support custom action ids from `.webui/actions.json` — user-defined slash skills (e.g. `/content-orchestrator`) can be wired into the "+ New ▾" menu without forking. NewIssueModal renders a new **generic mode** for custom ids: heading from `action.label`, subheading from `action.description`, no phase picker, no autonomy toggle, static command-preview hint. Server-side `actionId` allowlist relaxed; the actions catalog lookup is now the single source of truth (`unknown_action_id` 400 on miss). `ExternalTask.actionId` widened from a 4-id union to `string`.

### Changed
- build(webui): `install-windows.ps1` now runs `npm run build` in both `server/` and `client/` in step 3, and the generated VBS launcher invokes `node dist/index.js` instead of `tsx src/index.ts`. Single production-style runtime path on autostart, no TypeScript runtime in the hot loop, dev-only `tsx` stays out of the autostart artefact.

### Documentation
- docs(webui): `docs/guide.md` is now the source-of-truth user guide. Written for Shipwright users comfortable with Claude Code in VS Code but new to running a local web app — covers what the Command Center is and when to use it, the why-copy-paste rationale (max flexibility, no CLI/SDK lock-in, no surprise side effects, multi-tab by construction), recommended setup (Warp + Command Center next to your editor), step-by-step installation, daily workflow, custom actions, Windows autostart, and troubleshooting. README links to it as the quickstart's complement.

## [0.4.2] - 2026-04-26

### Fixed
- fix(webui): TaskList (Board view → List) Phase column actually renders the phase. Was hardcoded to `—` since 2026-04-22 with a stale "ADR-045 — deferred" comment. Now uses the same source-priority chain as TaskCard / TaskDetailHeader (server-persisted phase first, title-keyword fallback as last resort, em-dash when neither resolves). Visually identical chips across kanban + list.

## [0.4.1] - 2026-04-26

### Fixed
- fix(webui): phase persists across all launch paths — the launch handler now reads `actionId ?? task.actionId`, `phase ?? task.phase`, `phaseLabel ?? task.phaseLabel`, so subsequent launches via TaskCard / Resume / any path that doesn't carry the full action context re-use the values persisted at create time. Once set, always used.
- fix(webui): NewIssueModal can no longer submit before the actions catalog resolves. Fast typists previously could trigger a phase-less create when `useProjectActions` was still loading; submit is now gated on `projectActions` being present (and on `currentPhase` for new-task mode).
- fix(webui): phaseStyle.derivePhaseFromTitle uses word boundaries — `\b(?:design|ui|mockup)\b` no longer matches "ui" inside "webui" or "suite", which previously produced a bogus Design badge for adopt-titled tasks.
- feat(webui): phaseStyle.derivePhaseFromTitle gained an `adopt` branch with verb-inflection support (adopt, adopted, adopten, adopting, adopts). Explicitly excludes the noun form `adoption` because that signals different user intent.
- fix(webui): forgotten in v0.4.0 — server `ExternalTask.actionId` union now includes `"new-plain"`.

## [0.4.0] - 2026-04-25

### Added
- feat(webui): Plain Claude session button — a ghost-style icon-only button (Terminal) sits LEFT of the "+ New ▾" split-button. Click opens a slim NewIssueModal variant (Title + Description + Project context only — no Phase, no Autonomy, no Advanced) and creates a `claude --session-id <uuid> --name "<title>"` paste command that drops you straight into a chat scoped to the project's directory. No Shipwright skill, no slash command — just Claude in the right cwd.
- feat(webui): new bundled action `new-plain` in default-actions.json — uses the legacy `{task.description?}` placeholder so the substituter is untouched. The pasted command pre-seeds the description as Claude's first user message when present.

## [0.3.2] - 2026-04-25

### Fixed
- fix(webui): ProjectContextStrip no longer wraps "Creating in" + project name across two lines when Advanced parameters opens a vertical scrollbar (whitespace-nowrap + shrink-0 on each segment).
- fix(webui): project path now shows the last two segments (`…/03 Development/shipwright-webui`) instead of the `C:\Users\…` prefix — the end-of-path is the relevant identifier; full path remains in the hover tooltip.

## [0.3.1] - 2026-04-25

### Fixed
- fix(webui): Advanced parameter rows now align consistently — every field type (boolean, string, enum) uses the same fixed-width left slot for the checkbox, so labels line up regardless of param type. Required fields render an inline "Required" pill next to the label instead of a 60px-wide left gutter that mis-aligned the column.
- fix(webui): TaskCard now shows the phase badge for legacy tasks (launched before the phase-on-create wiring). The title-keyword fallback heuristic (extracted into `derivePhaseFromTitle()` and shared with TaskDetailHeader) keeps the kanban card in sync with the task detail. `data-phase-source="task"|"title-fallback"` exposes the provenance.

## [0.3.0] - 2026-04-25

### Added
- feat(webui): explicit enable-checkbox per Advanced parameter — optional string/enum params now have a left-side enable-checkbox; off → value disabled, on → pre-fills schema default for non-sensitive fields
- feat(webui): `phase.supports_autonomy` schema field gates the AutonomyToggle in Task mode — bundled markers on build/test/security
- feat(webui): auto-helpText "If omitted: schema default is X; skill may apply its own default." rendered for optional params without an explicit helpText
- feat(webui): inline empty-hint "Value empty — flag will not be emitted" makes skip-emit semantics visible without opening the live preview
- feat(webui): non-interactive "Required" badge replaces the disabled-checkbox affordance for required fields (better a11y per external review)
- feat(webui): `aria-describedby` chains enable-checkboxes to helpText for screen readers
- feat(webui): build.section gets a handful helpText pointing to the planning/-folder pattern

### Changed
- feat(webui): required parameters now render OUTSIDE the Advanced collapsible — generic over `required: true`
- feat(webui): Advanced count reflects only optional params (excludes required)
- feat(webui): `paramsToPreview` + `explicitParamEntries` signatures take `paramEnabled` — disabled fields no longer appear in the launch body or preview

### Fixed
- fix(webui): reset-form effect no longer fires on every React-Query refetch — user-typed values now survive background `actions.json` re-resolutions; same fix applied to the schemaKey-driven seed effect
- fix(webui): sensitive parameter values are cleared from in-memory state on toggle-OFF (audit hardening — was retained across re-toggles)

### Validator (breaking for misauthored configs)
- feat(webui): `boolean + required:true` is now a hard validator reject (`invalid_param_required`) — unrepresentable under opt-in semantics; bundled configs unaffected
- feat(webui): `phase.supports_autonomy` must be boolean when set (`invalid_phase_supports_autonomy`)

## [0.2.1] - 2026-04-25

### Fixed
- fix(webui): skill flags belong in initial-prompt, not as Claude CLI args
- fix(webui): opt-in Advanced parameters + initial-prompt preview

## [0.2.0] - 2026-04-25

### Added
- feat(webui): server-side CLI parameters resolution + validation
- feat(webui): NewIssueModal Advanced parameters section
- feat(webui): live CLI parameters in CommandPreviewPanel
