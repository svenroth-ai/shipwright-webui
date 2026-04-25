# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
