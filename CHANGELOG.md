# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Settings → Configure actions** now lists every registered project with a state badge (Custom / Bundled / Malformed) and lets you upload or reset `.webui/actions.json` directly from the UI. Files are validated against the actions schema (JSON-parse + `validateActionsSchema` + contract version) before they overwrite anything on disk; oversized payloads (>256 KB) are rejected via a `Content-Length` pre-check, and every write goes through the same `realpath + path.relative` traversal guard the rest of the file/tree routes use. Reset is enabled even when the on-disk file is malformed so you can recover without opening a terminal.

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
