# Session Handoff

> Auto-generated 2026-06-27 10:17:41 UTC

## Session Info

- **Session ID**: f25c4c06-6068-4b24-b09b-a3c8ddce4d07
- **Timestamp**: 2026-06-27 10:17:41 UTC
- **Reason**: iterate completion: iterate-2026-06-27-codeql-hardening

## Last Iterate

- **Run ID**: iterate-2026-06-27-codeql-hardening
- **Date**: 2026-06-27T10:17:54.343312Z
- **Type**: change
- **Complexity**: small
- **Branch**: iterate/codeql-hardening
- **ADR**: iterate-2026-06-27-codeql-hardening
- **Tests passed**: True

## Current Iterate Progress

- **Branch**: iterate/codeql-hardening
- **External Review Marker**: completed (external_review_state.json @ 2026-06-03T14:56:50)

## Legacy build state

- **Phase**: changelog
- **Current Split**: 01-adopted
- **Current Section**: adopted-baseline

- **Splits**: 0/1 complete
- **Sections**: 0/1 complete

## Git State

- **Branch**: iterate/codeql-hardening
- **Last Commit**: 73ad123 fix(security): harden cmd.exe arg quoting + scope CodeQL to production code
- **Uncommitted Changes**: None

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
| evt-667baa47 | work_completed | iterate (CodeQL noise reduction + qCmd cmd.exe quoting fix) | 2026-06-27 |
| evt-31471e05 | work_completed | iterate (mobile modal touch-safety: iOS focus-zoom + footer 44px button symmetry) | 2026-06-27 |
| evt-42ea8ea6 | work_completed | iterate (Repaint the embedded terminal on every WebGL texture-atlas mutation (onChangeTextureAtlas + onAddTextureAtlasCanvas + onRemoveTextureAtlasCanvas) so cells no longer keep stale atlas coordinates after a mid-stream atlas regeneration; fixes the wrong-letter glyph corruption that previously needed a manual resize.) | 2026-06-27 |
| evt-be31e6ba | work_completed | iterate (Disable DragOverlay drop animation so a dragged board card no longer flips back to its origin on drop) | 2026-06-23 |
| evt-8b9af61b | work_completed | iterate (Diagnostic: runtime renderer override (terminal-renderer.ts) read by xtermAddons.ts -- ?terminalRenderer=dom / localStorage skips the WebGL addon (DOM renderer) to A/B whether WebGL is the smear root cause on a real GPU. Default unchanged (webgl).) | 2026-06-23 |

## Recovery

- **Pipeline**: 3 phases completed
- **Total work events**: 245
- **Last iterate**: change — CodeQL noise reduction + qCmd cmd.exe quoting fix (2026-06-27)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-202: Mobile/touch terminal UX: condense phone header, buffer-first touch-scroll, data-driven settle-repaint
- **Date:** 2026-06-20
- **Section:** iterate-2026-06-20-mobile-terminal-touch-ux
- **Run-ID:** iterate-2026-06-20-mobile-terminal-touch-ux
- **Context:** Mobile use over Tailscale surfaced four issues: oversized phone task-detail header, dead touch-scroll at Claude's --resume picker, low-contrast touch keys, and input-area smear on Transcript->Terminal switch / return-from-home.
- **Decis
