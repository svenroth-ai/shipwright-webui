---
canon_generated: true
run_id: "iterate-2026-05-27-fix-pty-reused-prewarm-race"
phase: "iterate"
reason: "iterate: fix-pty-reused-prewarm-race"
timestamp: "2026-05-26T22:29:33.024406+00:00"
---

# Session Handoff

> Auto-generated 2026-05-26 22:29:33 UTC

## Session Info

- **Session ID**: 9d447124-3723-465c-b600-7223644ef655
- **Timestamp**: 2026-05-26 22:29:33 UTC
- **Reason**: iterate: fix-pty-reused-prewarm-race

## Last Iterate

- **Run ID**: iterate-2026-05-25-fix-terminal-touch-scroll
- **Date**: 2026-05-25T19:07:15.309074Z
- **Type**: bug
- **Complexity**: small
- **Branch**: iterate/fix-terminal-touch-scroll
- **ADR**: iterate-2026-05-25-fix-terminal-touch-scroll
- **Tests passed**: True

## Current Iterate Progress

- **Branch**: iterate/fix-pty-reused-prewarm-race
- **Run ID**: iterate-2026-05-27-fix-pty-reused-prewarm-race
- **Spec**: .shipwright/planning/iterate/2026-05-27-fix-pty-reused-prewarm-race.md
- **Complexity**: medium (touches `ptyreused` semantics — io-boundary-adjacent)
- **External Review Marker**: stale (predates spec (2026-05-26T05:30:27))

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

- **Branch**: iterate/fix-pty-reused-prewarm-race
- **Last Commit**: d626596 Merge pull request #71 from svenroth-ai/iterate/campaign-C-C2-external-routes-split
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
| evt-ceed7566 | work_completed | iterate (Fix prewarm race that armed the one-shot auto-launch guard on first WS attach) | 2026-05-26 |
| evt-dd475015 | work_completed | iterate (iterate finalization) | 2026-05-26 |
| evt-711a2d15 | work_completed | iterate (Commit C2 API contract sweep as tracked vitest suite (baseline JSON + PROBE_TABLE in-memory probes + 3 meta-tests; regression-guards external/routes.ts touch-ups in CI)) | 2026-05-26 |
| evt-503ee853 | work_completed | iterate (C5 EmbeddedTerminal-split E2E backfill (auto-execute + ptyReused regression fence)) | 2026-05-26 |
| evt-490d6b9f | work_completed | iterate (NEW .github/PULL_REQUEST_TEMPLATE.md (Superpowers anti-slop framing) + README Acknowledgments block (companion to shipwright PR #105)) | 2026-05-26 |

## Recovery

- **Pipeline**: 3 phases completed
- **Total work events**: 159
- **Last iterate**: bug — Fix prewarm race that armed the one-shot auto-launch guard on first WS attach (2026-05-26)
- **Resume**: `/shipwright-iterate` for next change, or `/shipwright-run` for new pipeline

## Recent Decisions

### ADR-126: Split BubbleTranscript.tsx into stable-props sub-modules (Campaign C, C3)
- **Date:** 2026-05-26
- **Section:** Iterate — refactor: BubbleTranscript decomposition (Campaign C bloat cleanup)
- **Run-ID:** iterate-2026-05-26-campaign-C-C3-bubble-transcript-split
- **Context:** `client/src/components/external/BubbleTranscript.tsx` had reached 1618 LOC (5.4× the 300-LOC project guideline). Campaign C sub-iterate C3 spec mandates a thin shell (≤200 LOC) plus 5 stable-props sub-modules: `Transcri
