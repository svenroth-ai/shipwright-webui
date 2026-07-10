# Iterate — Single-session design-gate mockup review hosting

- **Run ID:** `iterate-2026-07-10-design-gate-review-host`
- **Intent:** FEATURE (net-new webui capability — there is no design-gate UI today)
- **Complexity:** medium
- **Track:** webui-pipeline-convergence (convergence S5)
- **Spec Impact:** ADD — new **FR-01.45**; MODIFY cross-ref on FR-01.01 (the
  `SingleSessionRunCard` conditionally renders a design-gate panel).
- **Supersedes:** monorepo trg-ff0b2049 (dismissed; monorepo side delivered as
  `iterate-2026-07-10-design-gate-feedback-gitignore` / monorepo #355).

## Problem

In a `single_session` pipeline run the **design gate is `orchestrator-approve`**
(SS2): the `/shipwright-run` master's phase-runner emits the mockups
(`.shipwright/designs/{index.html, screens/*.html, flows/*.html}`) + the review
viewer, records a human-gate PAUSE (`run_loop_state.json` →
`status: paused_human_gate`), and stops. The Command Center currently has **no
affordance for this state** — the `SingleSessionRunCard` shows the `design`
phase as an ordinary checklist row and the only mockup-viewing path (Smart
Viewer) renders `index.html` as *highlighted source code*, not a live viewer,
and would fight the mockup's own design tokens and hide the viewer's built-in
feedback panel. There is no in-app way to review the mockups full-fidelity or to
get per-round feedback back into the worktree without the manual File System
Access save-dialog / download step.

## Decision (2026-07-10)

Mockups render in an **isolated full-fidelity surface** — a sandboxed, full-bleed
**in-app** iframe that hosts the design phase's OWN emitted `index.html` review
viewer. The WebUI **hosts** the viewer (it already bundles full-fidelity mockup
viewing AND the per-screen feedback panel); it does NOT rebuild either in React
and does NOT route mockups through the generic Smart Viewer. "Inline" means *no
manual export step*, not "embedded in Smart Viewer".

**User decisions (this run):**
1. **Host surface:** full-screen in-app sandboxed panel (not a separate tab).
2. **After Submit:** write the round file + show a "Saved — Round N"
   confirmation; the user presses **Resume** as a separate, explicit click
   (safest / most reversible; supports multiple review rounds).

## Key mechanics discovered (load-bearing)

- **Gate signal (webui-observable):** `.shipwright/run_loop_state.json`
  (`single_session/loop_state.py`, schemaVersion 1) →
  `status === "paused_human_gate"` AND its `currentPhaseTaskId` resolves to a
  `run_config.phase_tasks[]` row whose `phase === "design"`. The webui reads
  this file read-only (a NEW read surface — `run_config` never carries the gate).
- **Resume clears the gate WITHOUT the webui running `orchestrator.py`.** The
  existing `<MasterRunLaunchButton>` "Resume" resolves to
  `claude --resume <masterUuid>`, which "rebuilds the master conversation, which
  re-enters the single-session loop" (`master-run-branch.ts:27-28,90-92`). The
  master itself runs `orchestrator.py single-session-gate --phase design --state
  resume`, reads the Option-B feedback, and revises / finalizes. **AC#5 needs no
  new webui resume mechanism** — the CTA is already in the card. (CLAUDE.md
  Architecture rule 1: webui spawns no framework subprocess.)
- **Emitted viewer has NO postMessage bridge today** — only File System Access
  (`showSaveFilePicker`) + an anchor-download fallback
  (`review-viewer-template.md:815-879`). The clean seam: an **injected bridge**
  overrides `window.showSaveFilePicker` so the viewer's *existing* `exportFeedback()`
  path posts the (already contract-shaped) markdown to the host instead of
  saving. Zero viewer rebuild → respects OUT-OF-SCOPE.
- **Round number** in the viewer heading comes from `localStorage`
  (`getCurrentRound()`), which AC#3 forbids relying on → the **server** computes
  N from disk (`design-feedback-round*.md`) and normalizes the heading round
  number (preserving every other byte so the Option-B reader still parses it).

## Acceptance Criteria

- **AC1** — A "Review mockups" button appears on the `SingleSessionRunCard`
  ONLY when the design gate is active (paused_human_gate at the `design` phase
  task AND `.shipwright/designs/index.html` exists). Clicking it opens
  `.shipwright/designs/index.html` in a **full-bleed sandboxed in-app iframe**
  the viewer fully owns. No Smart Viewer tab is involved.
- **AC2** — Clicking **Export** (Submit) in the hosted viewer's feedback panel
  writes `.shipwright/designs/design-feedback-round{N}.md` **directly into the
  active worktree** (via host postMessage → `POST …/design-feedback`),
  replacing the File System Access save-dialog / download path. A "Saved —
  Round N" confirmation is shown; the panel stays open.
- **AC3** — Round number **N is computed from the round files on disk**
  (`max(existing round) + 1`, numeric; ignores non-round files; 1 when none) —
  robust across sessions/machines — NOT from localStorage.
- **AC4** — The written file matches the existing per-screen / per-split
  contract shape so the monorepo Option-B reader parses it: `# Design Feedback
  — Round {N}` / `## Summary` table (Approved / Changes Requested / Rejected /
  Total Reviewed) / `## {split}` / `### #{num} {title} — APPROVED|CHANGES|
  REJECTED` + `**File:**` / `**FRs:**` + free-text notes. (Preserved by keeping
  the viewer's exact `exportFeedback()` output and only substituting the round
  integer server-side.)
- **AC5** — The **Resume** CTA (existing `MasterRunLaunchButton`) continues the
  master; the master reads the Option-B feedback and revises, or finalizes on
  approve-all. The webui neither runs `orchestrator.py` nor writes
  `run_config` / the loop-state / Claude JSONL.

## Non-goals / OUT OF SCOPE

- Rebuilding the mockup viewer or the feedback form in React.
- Rendering mockups in the Smart Viewer.
- Changing the resume mechanism, `orchestrator.py`, or the monorepo Option-B
  reader (all done / owned elsewhere).
- Writing the feedback file to anywhere other than the active project worktree.

## Approach (files)

**Server**
- `core/run-loop-state-reader.ts` *(new)* — torn-read-hardened read of
  `.shipwright/run_loop_state.json`; pure `deriveDesignGate(loopState,
  runConfig, hasViewer)`.
- `core/design-feedback.ts` *(new)* — pure `computeNextRound(fileNames)` +
  `normalizeRoundHeading(markdown, n)`; testable in isolation.
- `external/design-review/{gate,serve,feedback-write,routes}.ts` *(new
  sub-router)* — `GET …/design-gate`, `GET …/designs/*` (bridge-injected
  index.html + path-guarded assets), `POST …/design-feedback`.
- Wire the sub-router into `external/routes.ts` (pass `getProjectById` +
  `readRunConfig`).

**Client**
- `lib/designReviewApi.ts` *(new)* — `getDesignGate`, `writeDesignFeedback`,
  `designsViewerUrl` (own lib file — `externalApi.ts` is at its bloat ceiling).
- `hooks/useDesignGate.ts` *(new)* — polling query, only while `single_session`
  + non-terminal.
- `components/external/DesignGatePanel.tsx` *(new)* — the paused-design
  affordance (opens the overlay; owns "Saved — Round N" state).
- `components/external/MockupReviewOverlay.tsx` *(new)* — full-bleed sandboxed
  iframe overlay; postMessage listener → `writeDesignFeedback`.
- Wire `<DesignGatePanel>` into `SingleSessionRunCard.tsx` (conditional on the
  gate query).

**Spec**
- Add **FR-01.45** to `.shipwright/planning/01-adopted/spec.md`; MODIFY note on
  FR-01.01.

## Risk / safety

- `touches_public_api` — new routes → **mandatory code review**.
- `touches_io_boundary` — the round-file writer is a producer whose output the
  monorepo Option-B reader consumes → **round-trip test** (write → re-read →
  contract-shape assertions) is mandatory (Boundary Probe).
- **Path-guard:** every disk read/write under `.shipwright/designs/` uses
  `pathGuard` + `realPathGuard` (CLAUDE.md rule 10); the serve route is confined
  to the `.shipwright/designs/` subtree; feedback write is `.md`-only + size-capped.
- **Sandbox:** iframe `sandbox="allow-scripts allow-same-origin allow-modals"`
  (same-origin needed for the viewer's `localStorage`; `allow-modals` preserves
  its `alert()`s). Content = the project's own developer-authored mockups +
  shipwright-emitted viewer, served loopback-only. postMessage validated by
  `event.origin` + `event.source === iframe.contentWindow`.
- **Read-only observer:** no writes to `run_config`, `run_loop_state.json`, or
  Claude JSONL. Only new write surface = `design-feedback-round{N}.md`
  (gitignored transient scratch, monorepo #355).

## Confidence Calibration

- **Boundaries touched:**
  1. Round-file **producer ↔ monorepo Option-B reader** (markdown contract shape) — `touches_io_boundary`.
  2. Loop-state **reader** of `.shipwright/run_loop_state.json` (new read surface).
  3. **iframe ↔ host** postMessage (injected `showSaveFilePicker` bridge → `POST /design-feedback`).
  4. Designs **static serve** (text/html render vs the /file route's text/plain).

- **Empirical probes run:**
  1. Verified the loop-state field shape against `single_session/loop_state.py`
     source: `init_loop_state` returns camelCase `currentPhaseTaskId` + `status`;
     `mark_human_gate` sets `status="paused_human_gate"`. Reader matches → no
     silent never-fires (plan review R2 closed).
  2. **E2E flow 100 (real Hono stack, real browser):** paused card →
     DesignGatePanel → overlay iframe loads the hosted viewer (with the injected
     bridge) → the viewer's own Export → bridge overrides `showSaveFilePicker` →
     postMessage → host write → "Saved — Round 1" → the round file exists on
     disk with the contract shape. Passed.
  3. Round-trip write test: posted viewer markdown → written round file →
     re-read → exact per-screen/per-split contract assertions; disk-derived N
     (round1+round3 → round4), heading em-dash preserved.
  4. Exclusive-create race: a pre-existing round1 → the write lands on round2,
     round1 bytes untouched (no clobber — R6).
  5. Path-guard: `../../src/secret.ts` under `/designs/*` → 400, content not leaked.
  6. Overlay postMessage validation: a wrong-origin OR wrong-source message is
     ignored (no write); the valid same-origin-from-iframe message writes (R7).

- **Test Completeness Ledger** (testable ⇒ tested; 0 untested-testable):

  | # | Behavior (AC) | Disposition | Evidence |
  |---|---|---|---|
  | 1 | `computeNextRound` disk-derived N, numeric, ignores non-round (AC3) | tested | `core/design-feedback.test.ts` |
  | 2 | `normalizeRoundHeading` rewrites round only, preserves bytes/dash, no free-text touch (AC4) | tested | `core/design-feedback.test.ts` |
  | 3 | `looksLikeDesignFeedback` contract guard | tested | `core/design-feedback.test.ts` |
  | 4 | `deriveDesignGate` paused∧design∧viewer∧non-terminal predicate + all inactive branches (AC1) | tested | `core/run-loop-state-reader.test.ts` |
  | 5 | `readLoopState` absent/torn/valid | tested | `core/run-loop-state-reader.test.ts` |
  | 6 | `GET /design-gate` active/inactive/no-viewer/no-config/404 | tested | `design-review/__tests__/gate.test.ts` |
  | 7 | `GET /designs/*` text/html + bridge-into-index-only + screens verbatim + no nosniff/CSP-block + 404 + traversal-reject + 415 (AC1) | tested | `design-review/__tests__/serve.test.ts` |
  | 8 | `injectFeedbackBridge` before-script / before-body / append | tested | `design-review/__tests__/serve.test.ts` |
  | 9 | `POST /design-feedback` round1/disk-N/round-trip-shape/not_design_feedback/designs_dir_missing/exclusive-create/413/404 (AC2/3/4) | tested | `design-review/__tests__/feedback-write.test.ts` |
  | 10 | Bridge `showSaveFilePicker` override → postMessage → host write (real browser, AC1+AC2) | tested | E2E `flows/100-design-gate-review.spec.ts` |
  | 11 | `isDesignFeedbackMessage` guard + `designsViewerUrl` relative/encoded | tested | `lib/designReviewApi.test.ts` |
  | 12 | Overlay postMessage origin/source validation + write + "Saved — Round N" | tested | `MockupReviewOverlay.test.tsx` |
  | 13 | Card renders `DesignGatePanel` only when the gate is active | tested | `SingleSessionRunCard.test.tsx` |
  | 14 | `DesignGatePanel` Review-button → overlay + saved-hint | tested | E2E flow 100 |
  | 15 | Resume clears the gate (existing `MasterRunLaunchButton`, unchanged — AC5) | covered-by-existing-test | flows 97/98/99 + `master-run-branch.ts` (webui runs no orchestrator.py) |
  | 16 | `useDesignGate` poll cadence (5s useQuery wrapper) | untestable (`covered-by-existing-test`) | mirrors `useRunConfig`; enablement covered by #13 + #10 |

- **Confidence-pattern check:**
  - **Asymptote (depth):** every new pure fn + route + the bridge + the client
    wiring is pinned at unit AND route AND (for the cross-window seam) real-browser
    E2E — not "looks right".
  - **Coverage (breadth):** AC1 (gate detect + panel + serve), AC2 (bridge→write),
    AC3 (disk round), AC4 (round-trip contract), AC5 (existing Resume, unchanged)
    all have a test. No `cross_component` framework machinery is touched, so no
    integration-coverage flag applies.
