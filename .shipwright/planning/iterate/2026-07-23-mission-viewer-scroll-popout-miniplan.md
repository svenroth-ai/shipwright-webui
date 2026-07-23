# Mini-Plan: mission-viewer-scroll-popout

**Run ID:** iterate-2026-07-23-mission-viewer-scroll-popout

## Chosen approach — bound the Mission body, share the artifact render, add a modal

1. **Scroll (root-cause, structural).** `MissionBody.tsx`: change the root
   wrapper `min-h-0 flex-1` → `flex min-h-0 flex-1 flex-col`. That makes
   `.mc-body` a bounded flex item so all three cards' pre-existing
   `overflow-y:auto` scrollers engage and the shell scroller stops scrolling.
   One-line cause fix; guarded by a class fence + real-browser E2E geometry.

2. **Extract `MissionArtifactBody.tsx`.** Move the summary `<p class="a-body">`
   + `<div class="a-detail">` + the `ArtifactDetail` switch (Spec/Requirement/
   Commit + Slice-2/3 details) out of `MissionArtifactPanel.tsx` into a shared
   body component that both the inline panel and the pop-out render. Preserves
   every existing `data-testid` (`artifact-summary`, `artifact-detail`, …).

3. **Add `MissionArtifactModal.tsx`.** Radix Dialog mirroring `SmartViewerModal`:
   portalled overlay + viewport-centered content, header (label + close),
   `<ModalScrollBody>` body wrapping `<div class="artifact is-popout">` +
   `<MissionArtifactBody>`. ESC/backdrop/close via `onOpenChange`.

4. **`MissionArtifactPanel.tsx` chrome.** Add `popoutOpen` state; a top-right
   toolbar with a "Pop out" chip + the existing close; render eyebrow +
   `<MissionArtifactBody>` + `<MissionArtifactModal>`. Guard the panel's
   document-level ESC handler with `if (popoutOpen) return;` so closing the
   modal never also closes the panel (AC4).

5. **CSS (`mission-record.css`).** Add `.artifact .a-tools` (toolbar),
   `.artifact .a-popout` (chip, token colours), and `.artifact.is-popout`
   (reset base slide-over position/width/overflow/shadow/animation so the
   `.artifact`-scoped child styles apply cleanly inside the portalled modal).

## Alternative considered — reuse `SmartViewerModal` directly (REJECTED)
`SmartViewerModal` takes `{projectId, path}` and renders a `SmartViewer` that
fetches by **file path**. Mission artifacts are fetched by an **opaque signed
document id** and several kinds are not files at all (requirement rows, tests
table, commit metadata). Building a path would violate FR-01.66 (G) ("the client
never constructs a `/file?path=`"). A dedicated modal that re-renders the same
typed `MissionArtifactBody` is both correct and reuses the existing detail
renderers verbatim.

## Risk / blast radius
- Client-only, read-only. No risk flags fired. No server, no endpoint, no
  serialized format. The height-chain change also benefits the left/middle
  cards (they gain working internal scroll) — verified they each already carry
  an internal scroller so nothing clips.
- Guards to keep green: `modal-scroll-body-invariant.test.ts` (use
  `ModalScrollBody`), `shell-scroll-invariant.test.ts` (TaskDetailPage is not a
  PageHead route, unaffected), motion/no-hardcoded-color fences.

## Test plan
- Unit (vitest/jsdom): MissionBody class fence; MissionArtifactPanel pop-out
  open/close + ESC-guard; existing panel-kind suites keep passing after the
  extract.
- E2E (Playwright, real browser): extend mission-artifacts S1 fixture with a
  long spec doc → open Spec artifact → assert card scrolls + shell does not +
  pop-out modal centers and shows the doc; ESC/close dismiss.
