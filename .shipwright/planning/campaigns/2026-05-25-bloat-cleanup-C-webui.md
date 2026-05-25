# Campaign C — WebUI Bloat Cleanup (2026-05-25)

Top-level descriptor file (per source plan §7.2). The autonomous-loop machinery + sub-iterate specs live under [`.shipwright/planning/iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/`](../iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/).

## Source plan

`../shipwright/Spec/Launch preparation bloat cleanup.md` (sibling shipwright clone), §6.2 (C-rows), §7.1 (topology), §9 (acceptance).

Pre-condition: Campaign A.defense merged at commit `15dcc67` (PR #62, 2026-05-25). Pre-commit hook (`scripts/hooks/pre-commit`) + CI bloat-check workflow (`.github/workflows/bloat-check.yml`) active. WebUI baseline frozen at **86 grandfathered entries** in `shipwright_bloat_baseline.json` on origin/main.

WebUI has **NO** plugin-internal Stop-gate (architectural asymmetry per source plan §5.10 — only pre-commit + CI enforce). The bloat-check workflow's PR-comment IS the audit trail; every sub-iterate verifies it landed green ("✅ no anti-ratchet violation" AND no "New crossings (advisory)" rows) BEFORE merging.

## Sub-iterates (linearized topology)

Source-plan topology `C1 → C8 → (C6 ∥ C3 ∥ C4 ∥ C7) → C5 → C2` linearized for `stacked` branch-strategy to: **C1 → C8 → C6 → C3 → C4 → C7 → C5 → C2**.

| ID | Slug | Title | Surface | Risk | Spec |
|---|---|---|---|---|---|
| C1 | claude-md-verify | CLAUDE.md verification (Phase 0f already handled) | cli | Niedrig | [C1-claude-md-verify.md](../iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/C1-claude-md-verify.md) |
| C8 | pty-manager-bloat-exception-adr | pty-manager.ts state=exception ADR (no code split) | cli | Null (Doku) | [C8-pty-manager-bloat-exception-adr.md](../iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/C8-pty-manager-bloat-exception-adr.md) |
| C6 | task-detail-header-split | TaskDetailHeader.tsx → shell + 4 sub-components | web | Niedrig-Mittel | [C6-task-detail-header-split.md](../iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/C6-task-detail-header-split.md) |
| C3 | bubble-transcript-split | BubbleTranscript.tsx → shell + 5 sub-modules | web | Mittel | [C3-bubble-transcript-split.md](../iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/C3-bubble-transcript-split.md) |
| C4 | new-issue-modal-split | NewIssueModal.tsx → ModalShell + 3 modals | web | Mittel | [C4-new-issue-modal-split.md](../iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/C4-new-issue-modal-split.md) |
| C7 | inbox-page-split | InboxPage.tsx → page + 3 sections + 1 hook | web | Mittel | [C7-inbox-page-split.md](../iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/C7-inbox-page-split.md) |
| C5 | embedded-terminal-split | EmbeddedTerminal.tsx → shell + 3 sub-modules (HIGH RISK) | web | HOCH | [C5-embedded-terminal-split.md](../iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/C5-embedded-terminal-split.md) |
| C2 | external-routes-split | external/routes.ts → 9 sub-routers + shell (HIGH RISK, LAST) | api | HOCH | [C2-external-routes-split.md](../iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/C2-external-routes-split.md) |

The cleanup-invariant block shared by every sub-iterate lives at [`_cleanup-invariant.md`](../iterate/campaigns/2026-05-25-bloat-cleanup-C-webui/sub-iterates/_cleanup-invariant.md).

## Reframing: C1 is a verification iterate, not a split

At Campaign-C planning time, `CLAUDE.md` on origin/main is **197 LOC** (post Phase 0f compliance-hygiene cleanup, PR #55, commit f4d52fd) — already below the 300-LOC source limit AND not in `shipwright_bloat_baseline.json`. The source plan's premise ("CLAUDE.md ~1.600 LOC → Kern ~200 + references/{...}") is stale. C1 is therefore reframed as a **verification iterate**: empirically confirm the target state via pytest + vitest doc-sync, document the Phase-0f organic outcome in a small note, produce a tiny PR. Topology integrity preserved (C1 stays as first node in chain).

## Phase-D acceptance (post-merge of all 8 sub-iterates)

- `shipwright_bloat_baseline.json`: zero `state=grandfathered` entries from the original 86. Only ONE `state=exception` entry (`server/src/terminal/pty-manager.ts` with C8 ADR). Other 85 grandfathered entries: REMOVED via cleanup-invariant (a)/(b) by C-iterates that natively touch them, OR remain grandfathered if they belong to test-files / other non-Campaign-C scope.

  > NOTE: Campaign C addresses 7 specific files from the 86-entry baseline. The remaining 79 entries (mostly E2E spec files >300 LOC) stay grandfathered and are out-of-scope for this campaign. The "zero state=grandfathered" goal in the source plan is aspirational across all Campaigns, not just C.

- Re-run A.defense pre-commit probe + an end-to-end Playwright smoke covering the embedded-terminal + transcript flows that C3 + C5 split.
- Update this campaign file: `status=complete`, link to all 8 merged PRs.

## Hard constraints

- The vendored `scripts/hooks/anti_ratchet_check.py` carries `# canonical-source-hash: 99020b73f7f5f8ca8b5540ead53ddf78b9cd86f9184ede0ddfbd00a21b2318b1` — **DO NOT** touch during any C-iterate.
- C5 must land with a real Playwright E2E driving the ADR-068-A1 auto-execute flow end-to-end (xterm + node-pty + WS data-frame). Unit tests alone insufficient.
- C2 must preserve API contract bit-perfect, verified via a pre/post snapshot contract sweep.
- Test files >300 LOC grandfathered in Phase-0 are NOT touched unless they fall out of a split naturally (e.g., `server/src/external/routes.test.ts` → per-router test files during C2).
- Every PR description includes the auto-generated allowlist-diff from the bloat-check workflow's PR-comment (manual quote or link). This is the audit-trail substitute for WebUI's missing Stop-gate.
- Every iterate runs F0.5 surface verification **empirically** against a running stack. Spec-only authoring = no test (project memory `feedback_browser_fixes_need_real_browser_smoke`, `feedback_verify_the_consumer_chain`).

## Status

- **created:** 2026-05-25
- **status:** in_progress
- **branch_strategy:** stacked
- **autonomous mode:** ON

## Merged PRs (filled at completion)

(to be appended as each sub-iterate's PR merges)

- C1: pending
- C8: pending
- C6: pending
- C3: pending
- C4: pending
- C7: pending
- C5: pending
- C2: pending
