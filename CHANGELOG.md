# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
