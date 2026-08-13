# Mini-Plan: mission-mobile-visual

- **Run ID:** iterate-2026-08-13-mission-mobile-visual

## Files to create/modify

### Mission tab
**Revised after internal + external plan review** (both external reviewers
flagged the original `outcome !== "neutral"` MissionBody-level gate as
ambiguous re: where `VerdictBanner` actually lives; the internal
`opus-plan-reviewer` found the concrete bug it would have caused — see
below). `MissionBody.tsx`'s `completed` branch is **unchanged** —
`OperationCard` keeps rendering unconditionally there, preserving AC1
("single derivation, `OperationCard` never re-derived externally") and
`proofLines.ts`'s guarantee that a red test-suite line (`suiteFailLine`) is
never hidden behind a neutral verdict. The fix moves inside `OperationCard`
itself, at the banner only:
- `client/src/components/external/mission/OperationCard.tsx` — edit: never
  render `<VerdictBanner outcome="neutral" .../>` (drop the branch
  entirely for the neutral case — `ProofSummary` already carries its own
  honest "No run data yet — nothing to prove" empty state when there are
  no facts, so a second "No run data yet"/"Not fully verified" banner on
  top is pure redundancy either way — with facts or without). `MissionLine`
  (already null for neutral via `missionInputFor`) and `ProofSummary`
  render exactly as today, unconditionally — the red-suite-line guarantee
  is never touched. `clear`/`hold` banners are unaffected (they always
  carry a genuine, earned verdict).
- `client/src/components/external/mission/VerdictBanner.tsx` — no
  functional edit; confirm still referenced (it is, from OperationCard,
  conditionally).
- `client/src/components/external/mission/MissionBody.tsx` — no gating
  change now needed; only the dark-surface CSS classes and the activity-
  feed narration work below still apply here.
- `client/src/components/external/mission/MissionActivityFeed.tsx` — edit:
  dark-surface styling (moves to CSS, `.mc-feed` on dark ground) + richer
  per-card narration text, sourced from `missionActivityFeed.ts` card
  generation, matching the approved "Mission Feed" mockup.
- `client/src/lib/missionActivityFeed.ts` — edit: strengthen per-card `text`
  generation for expressiveness (reuse `assistantText()`/BubbleTranscript
  formatting pieces per the approved mockup), no schema change to
  `ActivityFeed`/`ActivityCard`. **Content-safety constraint (external
  review, both reviewers, medium):** render through the existing safe
  React text/markdown path only (`MarkdownChunk` or plain text nodes) —
  never build raw HTML strings or use `dangerouslySetInnerHTML` for
  transcript-derived text, since it is user/assistant-influenced content.
  Add a rendering test with HTML-like/markdown-like content in a feed
  card. Confirm at build time which `BubbleTranscript/*` pieces
  (`MarkdownChunk.tsx`, `BubblePills.tsx`, etc.) are already exported for
  reuse vs. need a small shared-extraction first — do not import another
  module's private internals.
- `client/src/styles/mission-record.css` / `mission-operation.css` — edit:
  dark middle-card tokens. **Scoping constraint (external review, both
  reviewers, low):** scope dark tokens narrowly to the `.mc-op`/`.mc-feed`
  card roots only, not a broad Mission/page-level ancestor, so nested
  controls, the terminal/viewer surfaces, and unrelated Mission cards
  (`MissionLeftPanel`, `ArtifactPanel`) cannot inherit an unintended flip.
  Verify contrast + interactive states (text, muted text, links, focus
  rings, the segmented-tab selected state) in both the feed-only and
  feed+OperationCard-stacked variants, and run adjacent-surface visual
  regression, not only the Mission baselines.

### Files & Terminal — remove Transcript sub-tab
**Revised after internal plan review (high severity).** The original
mitigation ("keep the same id/data-testid so the ~50 terminal/replay specs
stay byte-stable") undercounted the blast radius. Two additional, concrete
things break and must be handled explicitly, not folded into "retarget any
spec asserting tab presence":

1. **A separate ~15-20 spec cohort reaches the Transcript pane via
   `localStorage["webui:embedded-terminal-default-tab"] = '"transcript"'`**
   and asserts deep `BubbleTranscript` rendering behavior (markdown/code
   fences, ANSI stripping, PR-link cards, `StopHookCard`, mode-change
   pills, positional-tail byte-offset correctness, 1000-event perf):
   `37a-markdown-rendering`, `37b-bubble-lifecycle`, `37c-perf-1000-events`,
   `48-tricky-char-titles`, `36-rename-title`, `36b-clipboard-name`,
   `34-browser-refresh`, `59-parser-variants`, `60-system-toggle`,
   `90-transcript-renderer-fingerprints`, `91-transcript-positional-tail`,
   `103-transcript-cursor-single-walk`, plus several `v0-9-x`
   replay/scrollback specs. Once the `centerTab`/`TAB_STORAGE_KEY`
   mechanism is removed, there is no surviving path for these specs to
   reach a Transcript pane — full list to be confirmed by a corpus grep at
   build time before any spec is touched.
2. **`getByRole("tab", {name:/terminal/i})`** is pinned by an explicit
   code comment to match exactly one element at desktop viewport (the
   `Tabs.List` trigger); `PaneTabBar`'s `role="tab"` buttons exist only at
   compact (≤1023px). Removing `Tabs.Root` entirely removes the only
   desktop `role="tab"` element. Grep the corpus for `getByRole("tab"`
   (13 files matched) before landing, in addition to the id/data-testid
   check.

**Decision (build-time, recorded here rather than left open):** this
iterate keeps `BubbleTranscript`'s per-piece rendering logic
(`MarkdownChunk`, `BubblePills`, `PrLinkCard`, `StopHookCard`, ANSI
handling) — these gain a NEW consumer via the richer `MissionActivityFeed`
narration work above, so they are not deleted. What is retired is the
**top-level Transcript-pane orchestration** (`BubbleTranscript`'s own
composition + `TranscriptRow`/`VirtualBubbles` wiring as a page-reachable
surface) and the desktop `Tabs.List`/`Tabs.Content` switch that exposed it.
The rendering-pipeline E2E coverage enumerated above (markdown/ANSI/
PR-link/StopHookCard/positional-tail/perf) is **migrated to component-level
Vitest tests against the individual `BubbleTranscript/*` pieces directly**
(they no longer need a live page route to exercise), rather than dropped —
this is itself a work-breakdown step (below), not an incidental retarget.
A single-option tablist (Terminal alone, nothing to switch to) is an
accessibility anti-pattern, so the desktop head band intentionally drops
`role="tab"` entirely rather than keeping a decorative one-item tablist.

- `client/src/pages/TaskDetailPage.tsx` — edit: drop the `Tabs.Root`
  wrapping the center pane; render `EmbeddedTerminal` directly with the
  SAME `id="task-center-panel-terminal"` / `data-testid="task-detail-
  terminal"` DOM shape. Remove `BubbleTranscript` usage, the
  transcript-stats header, `centerTab` state, `CenterTab` type,
  `TAB_STORAGE_KEY`, `onCenterTabChange` threading. Keep `FocusModeToggle`
  in the (now simpler, non-tab) head band.
- `client/src/components/external/PaneTabBar.tsx` — edit: drop the
  `transcript` entry from `TABS`/`PANEL_FOR_TAB`/`CompactTab`; `grid-cols-4`
  → `grid-cols-3`; `PaneTabBarProps` drops `centerTab`/`onCenterTabChange`.
- `client/src/components/external/TaskDetailThreePane.tsx` — edit: drop
  `centerTab`/`onCenterTabChange` props (confirmed safe by internal review
  — `activePane`/`onActivePaneChange`, which governs Files/Terminal/Viewer
  selection, is a fully orthogonal prop pair; no other consumer of
  `centerTab` found).
- `.shipwright/agent_docs/component_inventory.md` /
  `.shipwright/agent_docs/architecture.md` — edit: update the
  `BubbleTranscript` entry to reflect its new consumer (Mission activity
  feed) and the retired page route, so `doc-sync.test.ts` (CLAUDE.md rule
  11) stays green.

### Mobile visual fixes
- `client/src/components/external/mission/MissionTopRow.tsx` — edit: fix
  the phone header vertical-centering overlap (back-arrow / Resume /
  overflow-menu vs. the two-line title+status block) per the approved
  mockup's `.td-row-top` / `.td-status-row` restructuring.
- `client/src/components/external/TaskDetailHeader/ResumeCTA.tsx` — edit:
  icon-only phone variant. **A11y constraint (external review, both
  reviewers, medium/low):** keep an explicit `aria-label`/accessible name
  (the button loses its visible text, not its accessible name) and meet
  the project's existing mobile touch-target minimum (44px, matching the
  back-arrow link's `min-h-11 min-w-11` pattern already in
  `MissionTopRow.tsx`). Add a focused a11y test for the phone variant.
- `client/src/components/external/TaskDetailHeader/HeaderMenu.tsx` — edit:
  confirm the phone `⋯` menu no longer clips at the right edge (Sven's
  original screenshot complaint) once the header restructure lands.
  Verify-first: check if this is already fixed by the row-restructure
  before making a separate change.
- `client/src/components/external/mission/MissionCompactTabs.tsx` — edit:
  visual language to match `MissionSegmented`'s glass-pill look for the
  collapsed Mission/Terminal sheet, replacing the current plain-white
  `PaneTabBar`-style tile.
- `client/src/components/external/MobileTopBarSlot.tsx` /
  `client/src/layouts/MainLayout.tsx` — edit: **decided (external review,
  both reviewers, low): fix at the shared mobile-top-bar slot first**,
  since that is the single owner both Board's `ProjectFilterDropdown` and
  the create-CTA render inside; unify its right padding to 14px (matching
  `PageHead`). Fall back to a per-consumer override in
  `ProjectFilterDropdown.tsx`/`CreateControls.tsx`/`CreateMenuSplitButton.tsx`
  only if build-time inspection shows a genuine per-page exception is
  needed (e.g. one screen's control legitimately needs different padding)
  — record that reason explicitly if it happens, rather than defaulting
  to local overrides.
- `client/src/components/wizard/IntentWizard/FlightPlanRail.tsx` +
  `client/src/styles/intent-wizard.css` / `intent-wizard-panels.css` —
  edit: apply the same header/spacing standard confirmed for Board/Task
  Detail.
- `client/src/styles/buttons.css` — edit: add the documented phone-only
  exception to CLAUDE.md rule 26. **Concrete value (external review, low,
  fixed — not "e.g." anymore): 88px min-width**, the value already used in
  the approved mobile mockup's `.btn-primary-split`/`.bps-main`, scoped to
  the phone media query only (desktop/tablet keep 132px unchanged) + a
  matching one-paragraph amendment to CLAUDE.md rule 26 itself, worded as
  an explicit, named exception (not a silent override) per Sven's
  decision. Test both the phone exception and the unchanged desktop/tablet
  minimum in `create-cta-standard.test.ts`.
- `client/src/components/external/ViewToggle.tsx` — edit: fix a
  cross-viewport control-height mismatch against the adjacent Filter/
  Density icon buttons (both fixed `h-8 w-8`) — the spec Goal names
  "mismatched control heights" among the Board toolbar defects this
  covers. Uniform `h-8` on both toggle buttons; phone additionally drops
  the "Board"/"List" text labels (icon-only, `aria-label` carries the
  accessible name) to free up row width for the create button.
  (**Retroactively added to this file list post-build** — spec-reviewer
  flagged it as implemented-but-undocumented; traced to the Goal text and
  confirmed non-scope-creep before adding it here.)
- `client/src/components/external/ProjectCreatePhoneMenu.tsx` — edit: the
  phone rendering of the primary create control (`CreateControls.tsx` →
  `ProjectCreateCascade.tsx` → this component when `isPhone`), reached via
  the AC covering `CreateControls.tsx`. Real header band (border-separated
  title / back-chevron + project name) replacing the old
  `DropdownMenu.Item`-as-back-row, closing the "reads as an afterthought"
  drill-down complaint without migrating the outer `DropdownMenu`
  primitive (see in-file comment for why that migration is out of scope).
  (**Retroactively added to this file list post-build**, same reason as
  above.)

### Verify-first (no code change unless verification proves broken)
- "Terminal always default pane": **VERIFIED ALREADY TRUE** — read
  `TaskDetailPage.tsx` line ~87-90: `centerTab` defaults to `"terminal"` via
  `useLocalStorage(TAB_STORAGE_KEY, "terminal")`, with an explicit comment
  explaining this is deliberate for CI/spec byte-stability. No fix needed;
  this becomes moot anyway once the Transcript sub-tab is removed (there is
  only one pane left).
- "Spec → opens right panel": **VERIFIED ALREADY TRUE** — `MissionBody.tsx`
  `handleNodeClick` sets `activeNode` and (when compact) flips
  `compactPanel` to `"detail"`, which renders `MissionArtifactPanel` /
  `ArtifactPanel` in the right/detail panel for any artifact click,
  including a Spec artifact. No fix needed.

## Work breakdown (sequential)
1. Mission middle-card dark styling + banner-only neutral suppression
   (OperationCard's `VerdictBanner` render condition; MissionBody dark CSS
   classes only, no gating logic change) — test: `OperationCard` unit
   coverage extended for neutral-with-proof-lines (banner hidden, red-suite
   line still renders), neutral-with-no-facts (banner hidden, nothing
   else to show), clear/hold (banner unchanged); MissionBody.test.tsx /
   MissionBody.compact.test.tsx updated only for the dark-CSS class
   assertions; visual regression baseline update.
2. Activity feed narration richness pass (missionActivityFeed.ts,
   MissionActivityFeed.tsx), reusing exported `BubbleTranscript/*` pieces
   through the safe rendering path only — test: missionActivityFeed.test.ts
   extended with the new/updated card-text expectations + an HTML/markdown
   -like-content rendering test.
3. Corpus grep for `webui:embedded-terminal-default-tab` localStorage
   seeding and `getByRole("tab"` before touching any production code —
   produce the exact spec list (expected ~15-20 + the 13 role=tab files),
   confirm/adjust the enumeration above.
4. Remove Transcript sub-tab (TaskDetailPage, PaneTabBar,
   TaskDetailThreePane) per the retired-orchestration decision above —
   test: migrate the enumerated BubbleTranscript rendering-pipeline
   coverage to component-level Vitest tests against `BubbleTranscript/*`
   directly; update the terminal-reachability specs that used the
   transcript-tab localStorage seed to seed nothing (terminal is now the
   only pane); confirm the ~50 terminal/replay specs stay green with the
   DOM shape preserved.
5. `component_inventory.md` / `architecture.md` update for
   `BubbleTranscript`'s new consumer + retired page route (doc-sync).
6. Mobile header overlap + Resume icon-only (with accessible name/touch
   target) + tab-sheet restyle (MissionTopRow, ResumeCTA, HeaderMenu,
   MissionCompactTabs) — test: `90-phone-responsive.spec.ts`,
   `A11-mission-record-rail.spec.ts`, `A13-mission-shell.spec.ts`
   updated/extended, plus a phone a11y test for Resume.
7. Mobile right-edge gutter unification at `MobileTopBarSlot`/
   `MainLayout` (shared-owner-first) — test: extend
   `90-phone-responsive.spec.ts` with a measured alignment assertion.
8. Intent Wizard mobile fixes (FlightPlanRail, intent-wizard*.css) — test:
   extend or add a phone-viewport wizard spec.
9. CLAUDE.md rule-26 phone exception (88px, phone-scoped) + buttons.css —
   test: `create-cta-standard.test.ts` updated for both the phone
   exception and the unchanged desktop/tablet minimum.
10. Visual regression baseline regen for every touched screenshot
    (`task-detail-mission*.png` + any Board/Task Detail/Wizard phone
    baselines + adjacent Mission-surface baselines per the token-scoping
    check) — per the project's Linux-only regen flow.

## Component hierarchy (touched)
```
TaskDetailPage
├── MissionTabRow
├── MissionBody                (dark-card CSS only; unchanged gating)
│   ├── MissionLeftPanel
│   ├── OperationCard           (still always mounted where it was before;
│   │   └── VerdictBanner        banner-only conditional suppression)
│   ├── MissionActivityFeed     (dark styling + richer text via
│   │                            BubbleTranscript/* pieces)
│   ├── MissionCompactTabs      (mobile glass-pill restyle)
│   └── ArtifactPanel / MissionArtifactPanel
└── TaskDetailThreePane
    ├── PaneTabBar               (Transcript entry removed, 3 columns)
    ├── EmbeddedTerminal         (now the sole center content, no Tabs.Root)
    └── SmartViewer
```

## Data model changes
None — no new/changed serialized format, API route, or persisted schema.

## Test strategy
- Unit/component (Vitest): MissionBody, OperationCard-consumption,
  MissionActivityFeed, missionActivityFeed.ts, PaneTabBar,
  TaskDetailThreePane, ResumeCTA, MissionCompactTabs, create-cta-standard
  meta-test.
- Visual regression: `task-detail-mission.png` / `task-detail-mission-
  live.png` baselines regenerated; any phone-viewport Board/Task Detail/
  Wizard baseline the header changes touch.
- E2E (Playwright, targeted): `80-tablet-responsive.spec.ts`,
  `90-phone-responsive.spec.ts`, `A11-mission-record-rail.spec.ts`,
  `A13-mission-shell.spec.ts`, plus new/updated assertions for the removed
  Transcript tab and the mobile header fixes. Full suite required
  (`touches_shared_infra`).

## Alternative approach (considered, rejected)
**Alternative:** keep `OperationCard` always rendered in the `completed`
branch (current behavior) and instead only restyle `VerdictBanner`'s neutral
variant to be visually smaller/quieter rather than removing it from the
render tree.
**Rejected because:** Sven's explicit ask was to *remove* the fact-free
status section, not shrink it — "it wastes space on fact-free status
especially when there's nothing useful to show." A quieter-but-present
banner still occupies vertical space above the activity feed for no
informational gain, and the approved mockup already shows the middle card
opening directly on the activity feed with no banner for this case.
