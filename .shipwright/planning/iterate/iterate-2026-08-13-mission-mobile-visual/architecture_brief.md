# Architecture Brief: mission-mobile-visual

## The problem
The Mission tab's middle card shows a fact-free "Not fully verified" status
banner above the activity narration even when there is nothing useful behind
it, wasting vertical space; the activity-feed narration itself is terse; and
several mobile-viewport layouts (Board header, Task Detail header, Intent
Wizard) have concrete visual defects (control overlap, mismatched right-edge
alignment, oversized touch targets) that a user has directly observed and
confirmed via a pixel-accurate mockup.

## What would newly, permanently exist
Nothing. This changes the presentation of machinery that already exists: the
Mission middle card's render-gating logic (`MissionBody.tsx`), the activity
feed's text generation (`missionActivityFeed.ts`), the Files & Terminal
compact tab set (`PaneTabBar.tsx`/`TaskDetailPage.tsx`, dropping an existing
Transcript tab now redundant with Mission's own view), and CSS/markup on
several existing mobile components. One line is added to an existing,
already-maintained CLAUDE.md convention (rule 26) documenting a phone-only
sizing exception; no new file, service, credential, or scheduled process is
introduced.
