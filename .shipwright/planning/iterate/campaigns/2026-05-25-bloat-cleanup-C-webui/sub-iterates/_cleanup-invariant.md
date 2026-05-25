## Cleanup-Invariant (applies to EVERY C sub-iterate — enforced in spec)

The same commit that splits a file MUST also update `shipwright_bloat_baseline.json`:

(a) If the original file path still exists post-split AND is now ≤ its limit (300 source / 400 runtime-prompt) → **REMOVE** the entry from the `entries` list.
(b) If the original file path is deleted (replaced by a directory of sub-modules) → **REMOVE** the entry from the `entries` list.
(c) If the original file path still exists AND is still > limit → **FAIL** the iterate, do NOT merge. Refactor further.

For every NEW sub-module created by the split:
- Source files (`.ts`/`.tsx`) MUST be ≤ 300 LOC.
- Test files (`*.test.ts(x)`, `*.spec.ts`) MUST be ≤ 300 LOC.
- References `*.md` (loaded by CLAUDE.md, only relevant for C1) MUST be ≤ 400 LOC.
- If a new file would exceed its limit → split further BEFORE commit. NEVER add it as a fresh `state=grandfathered` entry — that defeats the campaign.

**C8 is the literal exception.** It adds ONE `state=exception` entry (`server/src/terminal/pty-manager.ts`) with the ADR path filled in. That is the ONLY entry that may be created during Campaign C.

### Why this matters

WebUI has **no Stop-gate** (architectural asymmetry per source plan §5.10 — only pre-commit + CI enforce). The bloat-check workflow's PR-comment IS the audit trail. The pre-commit hook blocks anti-ratchet (`measured > current`), but a fresh oversize file NOT yet in the baseline is only ADVISORY (per A.defense design). That means a sloppy slice can leak an oversize `references/Fx.md` or sub-component INTO the codebase. The autonomous runner MUST treat its own freshly-created sub-modules as **failures-to-block-on**, not as advisories.

### F0.5 surface verification — NO SHORTCUTS

Every C-iterate MUST run F0.5 surface verification empirically against a real running stack. Spec-only authoring (writing a Playwright spec without executing it; pytest-spec without running pytest) counts as `tests_run = 0` → gate fails. The "always" semantics in the Phase Matrix mean **author AND run**, not author OR run.

- **C1, C8:** `surface=cli`. Real pytest invocation (`uv run --with openai pytest <test_path> -v` — see project memory `feedback_uv_with_openai_for_shared_tools`) AND a real `npx vitest` probe for any test that reads CLAUDE.md. C1 also probes via `doc-sync.test.ts`.
- **C3, C4, C6, C7:** `surface=web`. Real Playwright spec against a running dev stack (`cmd /c client\node_modules\.bin\playwright.cmd test --config=client/playwright.config.ts <spec>` — see project memory `feedback_f05_playwright_windows_invocation`). MUST drive the user-visible surface (transcript / modal / header / inbox).
- **C5:** `surface=web`. Playwright E2E driving the ADR-068-A1 auto-execute flow end-to-end (xterm + node-pty + WS data-frame). Unit tests alone are insufficient. See project memory `feedback_browser_fixes_need_real_browser_smoke`, `strictmode_aborts_first_ws_in_e2e`.
- **C2:** `surface=api`. Real curl probes against a running Hono server (`PORT=3848 SHIPWRIGHT_NETWORK_PROFILE=local USERPROFILE=<temp>` per project memory) for EVERY client.api.* call path that resolves today.

Server vitest invocations MUST set `SHIPWRIGHT_NETWORK_PROFILE=local` (project memory `project_server_vitest_needs_network_profile_local`).
Server build/lint MUST use `npm.cmd --prefix server ...` on Windows (project memory `feedback_windows_subprocess_npm_cmd`).

### CI bloat-check workflow PR-comment gate (stricter than default workflow)

After F11 PR-creation, the CI bloat-check workflow's PR-comment MUST report:
1. ✅ **No anti-ratchet violation**
2. ✅ **No "New crossings (advisory)" rows** — fresh sub-modules MUST already be under their limit pre-merge

If the PR-comment reports any advisory crossing → the runner fails the iterate and refines the split BEFORE merging. The advisory threshold is treated as block-on because WebUI has no Stop-gate fallback.

### Hard constraints (apply to all C-iterates)

- The vendored `scripts/hooks/anti_ratchet_check.py` carries `# canonical-source-hash: 99020b73f7f5f8ca8b5540ead53ddf78b9cd86f9184ede0ddfbd00a21b2318b1` — **DO NOT** touch it during any C-iterate.
- Test files >300 LOC grandfathered in Phase-0 are NOT touched unless they fall out of a split naturally (e.g., `routes.test.ts` → per-router tests during C2).
- PR description MUST include the auto-generated allowlist-diff from the bloat-check workflow's PR-comment (manual quote or link). This is the audit-trail substitute for WebUI's missing Stop-gate.

### External review + code review cascade

Every C-iterate is medium complexity → ADR-029 mandates Step 3.5 (External Plan Review via `external_review.py --mode iterate`) AND Step 3.7 (Code-Review-Cascade). See project memory `feedback_external_code_review_catches_high_bugs`. Skipping either step silently is a contract violation.
