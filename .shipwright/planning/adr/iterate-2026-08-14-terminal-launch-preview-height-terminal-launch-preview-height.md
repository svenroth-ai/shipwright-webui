# ADR — Cap the terminal launch-preview banner's height

**Run:** `iterate-2026-08-14-terminal-launch-preview-height`

## Context

Reported live: opening a triage item with a long description and clicking
Launch filled the embedded terminal with what looked like echoed command
text, then settled at a clean, untouched shell prompt with Claude never
starting.

Root cause, confirmed by a live end-to-end Playwright repro against the real
production server: `TerminalBanners.tsx`'s uncapped "About to run: `<command>`"
preview banner renders the FULL launch command with `break-all` and no
`max-height`. A `new-iterate` command with a long task description
substituted in (5341 chars for the real `trg-c57bec15` report) wraps the
banner to 1000+px tall. As a flex-column sibling ahead of the xterm canvas
div (`min-h-0 flex-1`), the banner's forced height squeezes the canvas to 0
height. `isMeasurableTerminalContainer` requires `width>0 && height>0`, so
`useTerminalSizeSync`'s `syncSizeNow` never succeeds, the pre-dispatch resize
retry loop in `useAutoLaunch.ts` spins until `pending.expiresAt`, and
`coord.cancelLaunch("timeout")` fires silently — the launch command is never
written to the pty at all.

## Decision

Cap both the `previewCommand` and `manualSendCommand` banners in
`TerminalBanners.tsx` with a bounded `max-height` + `overflow-y-auto` +
`shrink-0`, so neither can ever consume unbounded flex-column space
regardless of command length. The `manualSendCommand` container also gained
`[&>*]:shrink-0` (its own direct children) per the existing DO-NOT #24
self-scrolling-container rule, since it now scrolls itself.

## Consequences

A long launch command's preview is now scrollable within a fixed-height
strip instead of exploding the layout; the full command is still reachable,
just not all on screen at once. The terminal canvas always keeps a real
height, so the pre-dispatch resize retry loop can succeed and the launch
command reaches the pty. Verified via an explicit before/after run of a new
E2E spec (`git stash` of the fix): fails against the pre-fix code (canvas
reported hidden, height 0, matching the reported symptom exactly) and passes
with the fix.

## Rationale

A CSS class fence (`max-height` + `overflow`) is a direct, self-contained
bound that does not depend on getting flex arithmetic right elsewhere in the
tree — the same defensive shape this codebase already uses for the identical
defect class (DO-NOT #24).

## Investigation notes

The original root-cause hypothesis (a single burst pty write making
PSReadLine drop the trailing Enter on long input) was investigated first and
falsified: a self-inflicted control-character corruption in a hand-built test
fixture had produced a false "reproduction". Rebuilding the fixture cleanly,
and pulling the actual launch command straight from the live production
server for the real `trg-c57bec15` scenario, showed the original unmodified
code launches that command cleanly and deterministically via direct pty
writes. The real defect only surfaced once the reproduction went through the
actual browser → WebSocket → server path (a real Playwright click on the
Launch CTA), which is where the flex-layout squeeze lives.
