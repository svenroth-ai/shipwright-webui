# ADR detail — Widen the triage file-viewer panel

**Run-ID:** iterate-2026-08-30-triage-panel-width

## Empirical measurement

Measured live in a real Chromium instance (Playwright) by overriding
`Dialog.Content`'s inline width and re-reading `scrollHeight`/`clientHeight`
(markdown) and `scrollWidth`/`clientWidth` (code) against real repo files —
not synthetic fixtures, per the user's request to check real triage-linked
files first.

- **Representative markdown** (`.shipwright/planning/adr/095-claude-tui-flicker-workaround.md`,
  120 lines / 12.6KB): at the panel width the old 1100px total modal produced
  (~460px), required scroll height was 6178px against a constant 880px
  visible height. Widening the panel to ~800px (1440px total) cut that to
  4121px — a ~33% reduction. Going further (to ~1160px panel / 1800px total)
  only bought another ~18% on top of that — diminishing returns past ~800px.
- **Representative code** (`server/src/core/path-guard.ts`, 190 lines,
  typical comment-line length ~80-95 chars): needed ~717px of content width
  to avoid horizontal scrolling entirely.
- **Sanity check only** (`.shipwright/agent_docs/conventions.md`, 305 lines /
  84KB — an intentional outlier): confirmed the panel's height containment
  still holds (bounded, scrollable, no clipping) at extreme content length;
  not used as a basis for the width decision since sizing the common case off
  an atypically huge file would over-justify an unreasonably wide panel.

## Decision

1440px total modal width (up from 1100px) is the smallest step that clears
both the code width need (717px) and most of the markdown wrapping benefit,
yielding an empirically measured ~800px panel width. `max-w-[95vw]` still
clamps it gracefully on smaller screens.
