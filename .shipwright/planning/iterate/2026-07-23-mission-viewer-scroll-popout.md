# Iterate Spec: mission-viewer-scroll-popout

- **Run ID:** iterate-2026-07-23-mission-viewer-scroll-popout
- **Type:** change (bug-fix core + additive affordance)
- **Complexity:** medium
- **Status:** draft

## Goal
Make the Mission tab's right-hand artifact viewer (Requirement / Spec / Tests /
Review / Decisions / Commit) scroll **inside its own card** instead of pushing
the whole page, and give it a **"Pop out"** control that opens the same content
in a large centered modal — exactly like the Files-&-Terminal Smart Viewer.

## Acceptance Criteria
- [ ] AC1 — When an artifact's content is taller than the card, the Mission
  artifact card scrolls internally; the surrounding page (the shell scroller
  `.scene-fore` / `main-scroll-container`) does **not** scroll.
- [ ] AC2 — The Mission artifact panel shows a "Pop out" control.
- [ ] AC3 — Activating "Pop out" opens a viewport-centered modal that renders
  the **same** artifact (business summary + typed detail) larger, with its own
  internal scroll. ESC, the backdrop, and the close button all dismiss it.
- [ ] AC4 — Dismissing the modal via ESC does **not** also close the underlying
  inline artifact panel (the panel's own ESC-to-close still works when the modal
  is closed).
- [ ] AC5 — No regression: the inline panel still renders each artifact kind's
  existing shape (document / requirement rows / tests / review / decisions /
  commit), and the legacy `ArtifactPanel` + its "Open full document" path are
  untouched.

## Spec Impact
- **Classification:** modify
- **ADD:** none
- **MODIFY:** FR-01.66 — the Mission view's right artifact panel now bounds its
  own scroll and offers a pop-out (a FOLD/completion of the existing Mission
  view, not a new capability). Append AC (K).
- **REMOVE:** none
- **NONE justification:** n/a

## Out of Scope
- The legacy `ArtifactPanel` (scenarios 1/3/4/5) keeps its "Open full document"
  affordance verbatim — it already routes to the Smart Viewer, which has its own
  scroll + pop-out. Only the height-chain fix (structural) reaches it.
- No change to the mission-context resolver, the transcript observer, or any
  server endpoint. Client-only, read-only (rule 1 / DO-NOT #1 unaffected).
- No change to the middle (`OperationLive`) / left (`MissionLeftPanel`) card
  content — they gain working internal scroll as a side effect of the same fix.

## Design Notes
- Root cause: `MissionBody`'s root wrapper `<div className="min-h-0 flex-1">`
  is `display:block`, so its child `.mc-body` (`flex:1; min-height:0;
  display:flex`) has an **inert** `flex:1` — the flex row grows to its tallest
  child's content height and the whole card cluster overflows the shell scroller
  `.scene-fore` (which is the only element that then scrolls). Fix: make the
  wrapper a bounded flex column (`flex min-h-0 flex-1 flex-col`) so `.mc-body`
  becomes a bounded flex item and every card's existing `overflow-y:auto`
  (`.record`/`.mc-left`, `.mc-hero`, `.artifact`) engages. Broken since #271.
- Pop-out mirrors `SmartViewer/SmartViewerModal.tsx`: Radix Dialog portalled to
  body, viewport-centered, ESC/backdrop/close. The scroll body uses
  `components/common/ModalScrollBody.tsx` (DO-NOT #24 — never hand-roll a dialog
  scroll body). The artifact detail styles are `.artifact`-scoped, so the modal
  body wraps the content in `.artifact.is-popout` (a modifier that neutralises
  the base `.artifact` slide-over position/width/overflow, since the portal
  renders outside `.on-photo`).
- New split (files ≤300 LOC): `MissionArtifactBody.tsx` (shared summary + typed
  detail, reused by the inline panel and the modal) + `MissionArtifactModal.tsx`
  (the pop-out). `MissionArtifactPanel.tsx` keeps the chrome (toolbar with
  pop-out + close, eyebrow) and owns the modal-open state.
- Tokens only, no magic colours; no new motion (A20 floor untouched — the modal
  reuses the existing Radix dialog pattern, and `.artifact.is-popout` sets
  `animation: none`).

## Affected Boundaries
n/a — no serialized format is produced or consumed. Pure client render/layout.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| n/a | n/a | n/a |

## Confidence Calibration
- **Boundaries touched:** none (client render/layout only).
- **Empirical probes run:**
  - Traced the height chain viewport→`.scene-fore`(overflow-y:auto)→TaskDetailPage
    (`flex h-full min-h-0 flex-col`)→MissionBody root(`min-h-0 flex-1`,
    **display:block**)→`.mc-body`(`flex:1;min-height:0;display:flex`). Finding:
    `.mc-body`'s `flex:1` is inert (parent not a flex container) → mc-body =
    content height → cards overflow the shell scroller. Confirmed the Files tab
    works because `TaskDetailThreePane` uses `h-full` (percentage), which
    resolves against the bounded flex-item wrapper, whereas Mission uses `flex:1`.
  - Confirmed via `OperationLive.tsx` comment ("`.mc-hero` — a correct scroll
    container all along — never had anything to scroll TO … now the card
    scrolls") that the internal scrollers were always present but never engaged.
  - Verified `git log -S` that the wrapper has been `min-h-0 flex-1` (block)
    since #271 — the defect is original to the three-card shell, matching the
    user's "only the whole page scrolls".
- **Test Completeness Ledger:**

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | MissionBody root is a bounded flex column | tested | MissionBody.test.tsx::"root is a bounded flex column" (class fence) |
  | 2 | Mission artifact card scrolls internally; shell does not scroll | tested | e2e mission-viewer-scroll-popout.spec.ts (real-browser geometry) |
  | 3 | Pop-out control renders on the artifact panel | tested | MissionArtifactPanel.test.tsx::"renders a Pop out control" |
  | 4 | Pop-out opens a centered modal with the same artifact body | tested | MissionArtifactPanel.test.tsx + e2e geometry/centering |
  | 5 | Modal closes via close/ESC/backdrop; ESC does not close the panel | tested | MissionArtifactPanel.test.tsx::"ESC closes the modal but not the panel" |
  | 6 | Inline panel still renders each kind's existing shape | tested | covered-by-existing-test (MissionArtifactPanel.test.tsx suites) |

- **Confidence-pattern check:** asymptote — root cause was found by tracing the
  actual height chain and confirmed against source comments + git history, not
  by "looks right". coverage — every row above is `tested`; 0 untested-testable.
  The one behavior jsdom cannot see (real scroll geometry, row 2) is covered by a
  real-browser E2E, per the "jsdom can't see layout" rule.

## Verification (medium+)
- **Surface:** web
- **Runner command:** Playwright — `mission-viewer-scroll-popout.spec.ts`
  (extends the existing S1 mission-artifacts fixture: seed project + task +
  iterate pointer + a long spec doc; open the Spec artifact; assert the card
  scrolls, the shell does not, and the pop-out modal opens centered).
- **Evidence path:** client Playwright report + F0.5 `surface_verification` block.
- **Justification (if surface=none):** n/a
