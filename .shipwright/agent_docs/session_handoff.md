---
canon_generated: true
run_id: "iterate-2026-06-30-osv-dep-advisories"
phase: "iterate"
reason: "iterate: clear OSV/Scorecard dependency advisories (lockfile-only)"
timestamp: "2026-06-30T20:34:09.855457+00:00"
---

# Session Handoff

> Auto-generated 2026-06-30 20:34:09 UTC

## Session Info

- **Session ID**: 58ae49b5-61ed-46af-9a17-86023cf3a58c
- **Timestamp**: 2026-06-30 20:34:09 UTC
- **Reason**: iterate: clear OSV/Scorecard dependency advisories (lockfile-only)

## Last Iterate

- **Run ID**: iterate-2026-06-30-remove-native-scorecard
- **Date**: 2026-06-30T19:23:52.606862Z
- **Type**: change
- **Complexity**: trivial
- **Branch**: iterate/remove-native-scorecard
- **ADR**: iterate-2026-06-30-remove-native-scorecard
- **Tests passed**: True

## Current Iterate Progress

- **Branch**: iterate/osv-dep-advisories
- **External Review Marker**: completed (external_review_state.json @ 2026-06-03T14:56:50)

### Mandatory replay on Resume

Before dispatching to the handoff's Remaining phase, run these if missing:
- Finalization (F0–F11) after all mandatory phases pass

## Legacy build state

- **Phase**: changelog
- **Current Split**: 01-adopted
- **Current Section**: adopted-baseline

- **Splits**: 0/1 complete
- **Sections**: 0/1 complete

## Git State

- **Branch**: iterate/osv-dep-advisories
- **Last Commit**: ae24cf9 chore(ci): remove native OpenSSF Scorecard workflow (wrong anchor for AI-first) (#190)
- **Uncommitted Changes**: Yes

## Config Files to Read

- `shipwright_run_config.json` — exists
- `shipwright_project_config.json` — exists
- `shipwright_plan_config.json` — exists
- `shipwright_build_config.json` — exists
- `shipwright_security_config.json` — missing
- `shipwright_compliance_config.json` — exists

## Last Events

| Event | Type | Source | Date |
|-------|------|--------|------|
| evt-11f1d162 | work_completed | iterate (Clear all open advisories reported by the OSV/Scorecard Vulnerabilities check across both npm workspaces via lockfile-only dependency bumps (no package.json range edits, no --force, no major bumps). Every flagged package is dev-server / build-time / test-only tooling; the production runtime dependency tree is unaffected. CVE/package specifics are recorded in the gitignored security report. Verified: full unit suite 3500/3500 green, typecheck + lint + both builds clean, npm audit 0/0 in server and client.) | 2026-06-30 |
| evt-53efed82 | work_completed | iterate (Remove webui .github/workflows/scorecard.yml + the Added changelog drop. Keep the A+C grade work + the methodology citation. Token-permissions + open vulns + pinned-deps tracked as triage.) | 2026-06-30 |
| evt-3af4f8e4 | work_completed | iterate (Regenerate compliance with the updated plugin (honesty gate + 29148/12207/SSDF anchors); add native scorecard.yml. Grade stays A99 — webui has no traceability decline.) | 2026-06-30 |
| evt-a01aca38 | work_completed | iterate (E2E hardening: Task-Board header pill + graceful-absence coverage for FR-01.43) | 2026-06-30 |
| evt-d3c61a35 | work_completed | iterate (compliance Grade badge + detail modal in WebUI) | 2026-06-30 |

## Recovery

- **Pipeline**: 3 phases completed
- **Total work events**: 257
- **Last iterate**: change — Clear all open advisories reported by the OSV/Scorecard Vulnerabilities check across both npm workspaces via lockfile-only dependency bumps (no package.json range edits, no --force, no major bumps). Every flagged package is dev-server / build-time / test-only tooling; the production runtime dependency tree is unaffected. CVE/package specifics are recorded in the gitignored security report. Verified: full unit suite 3500/3500 green, typecheck + lint + both builds clean, npm audit 0/0 in server and client. (2026-06-30)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-202: Mobile/touch terminal UX: condense phone header, buffer-first touch-scroll, data-driven settle-repaint
- **Date:** 2026-06-20
- **Section:** iterate-2026-06-20-mobile-terminal-touch-ux
- **Run-ID:** iterate-2026-06-20-mobile-terminal-touch-ux
- **Context:** Mobile use over Tailscale surfaced four issues: oversized phone task-detail header, dead touch-scroll at Claude's --resume picker, low-contrast touch keys, and input-area smear on Transcript->Terminal switch / return-from-home.
- **Decis
