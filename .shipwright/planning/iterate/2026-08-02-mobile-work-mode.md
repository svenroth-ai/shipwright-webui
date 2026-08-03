# Iterate Spec — Mobile work mode for Task Detail and Mission

- **Run ID:** `iterate-2026-08-02-mobile-work-mode`
- **Intent:** CHANGE (Path B)
- **Complexity:** medium (classifier: small; scout upgrade because the change
  composes responsive header chrome, a persistently mounted terminal, nested
  workspace tabs, and Mission's three-panel navigation)
- **Spec Impact:** MODIFY — fold into `FR-01.02`, `FR-01.28`, `FR-01.38`, and
  `FR-01.66`; no new capability row
- **Surface:** web
- **Source:** phone screenshot plus the product decisions made with Sven on
  2026-08-02. Those turns are the completed requirements interview and approval.

## 1. Outcome

On a phone, Task Detail becomes a work surface rather than a stack of chrome:
the title and occasional controls occupy little height, the terminal starts
materially higher, and one brand-light four-way workspace row replaces the two
nested pane/tab rows. Mission uses the same small-screen rule: one full-width
panel at a time behind three equal tabs instead of three squeezed columns.

The desktop three-card and three-pane layouts remain unchanged. The terminal,
its xterm instance, and its WebSocket stay mounted through every tab change.

## 2. Acceptance criteria

### AC1 — compact phone task header

Given Task Detail at `<=767px`, when a task has a long title, then the title is
one line, ends in an ellipsis inside the available title area, and tapping it
opens the full title in a portalled modal Popover without growing the header.
The Popover is viewport-bounded rather than ancestor-clipped, returns focus to
its trigger, closes on Escape/outside interaction, and renders the title as an
ordinary React text node with no HTML/Markdown injection path. Its Rename
action first closes the overlay, then on the next animation frame invokes the
existing imperative edit path. The same compact-header component then renders
and focuses the existing input with its existing pending/error mutation UI;
there is no second editor or mutation path. Rename remains
reachable from that overlay and from the existing overflow menu. At `>=768px`,
the existing inline editable title remains unchanged.

Given the same phone header, when the task can resume, then Resume keeps its
existing action and test id but uses compact phone geometry. The title, action,
state, and overflow menu do not wrap into the multi-line tower shown in the
reported screenshot.

### AC2 — Description beside state, never pushing the terminal down

Given a phone task with a non-empty description, when the header renders, then
a `Description` control appears beside the state badge. Tapping it opens the
read-only description in the same portalled modal Popover pattern; focus and
Escape behaviour match the title, and description remains escaped plain text
even when it contains markup-like input. Opening or closing it does not change
the height of the header or workspace. Its content is viewport-bounded and
internally scrollable for a long brief. A task without a description shows no
control. Tablet/desktop keep the existing persisted inline disclosure.

### AC3 — Shiplog is a compact link and the brand-light tab contract is fixed

Given the Task Detail view switch, when it renders at any supported theme,
then `Shiplog` is visibly a link to the existing Ship's Log route, never a tab.
The Mission / Files & Terminal segmented control and the compact workspace tabs
use the light Shipwright treatment (white/warm-grey surface, dark text, teal
active indicator). The dark task chrome and dark terminal remain dark; no
all-dark alternate tab treatment is introduced.

### AC4 — one compact workspace row, four direct destinations

Given Task Detail below `1024px`, when Files & Terminal is active, then one
equal-width row exposes `Files`, `Transcript`, `Terminal`, and `Viewer`
directly. The old `Session` destination and the additional nested
Transcript/Terminal row are not visible. Selecting Transcript or Terminal
selects the centre pane and its corresponding Radix content in one action.

Given any compact workspace switch or breakpoint crossing, when the user leaves
and returns to Terminal, then the same force-mounted EmbeddedTerminal subtree
and WebSocket remain alive. The existing saved Transcript/Terminal preference,
Inbox terminal focus, and desktop inner switch continue to work.

Given a saved centre preference of Transcript or Terminal, when compact Task
Detail first paints and later crosses 1024px in either direction, then the one
controlled centre value initializes from that preference without a transient
wrong destination or overwriting it. Files and Viewer change only the outer
pane; Transcript and Terminal change both the outer pane and that centre value.
The current `useLocalStorage` path was audited: it reads localStorage
synchronously in `useState`'s lazy initializer, so the first render already has
the persisted value and no hydration-ready state exists or is needed. A
breakpoint projection only reads that value and never writes a replacement.

### AC5 — terminal-first phone geometry

Given Files & Terminal at `<=767px`, when Terminal is selected, then the work
surface has no outer horizontal card inset, no dedicated `Terminal · Live`
title band, and the existing expand/restore control floats at the terminal's
top-right without reserving a row. The control has its own opaque 44px hit area
and no larger click-catching wrapper, so it remains legible without masking an
unnecessary terminal region. It stays keyboard accessible and continues to use
the existing focus-mode path.

Given a compact destination hides the centre pane at zero width, when Terminal
becomes visible again or the viewport crosses the compact breakpoint, then the
existing ResizeObserver/FitAddon path recalculates non-zero rows and columns
after a settled, measurable layout. The outer compact-pane selection participates
in `EmbeddedTerminal.active`; a reveal schedules a cancellable post-paint refit
through that existing hook instead of relying on ResizeObserver timing alone.
Resize forwarding is gated by the existing
terminal sizing seam on a practical minimum grid (at least 5 columns and 2 rows),
so neither `0x0` nor an intermediate sub-character grid reaches the pty. The
returned terminal is not clipped or left at stale dimensions, including a rapid
Terminal → Viewer → Terminal sequence.

Given a coarse pointer, when the touch key bar renders, then every key remains
at least 44px high and its bar has equal top and bottom padding. No additional
safe-area padding is added beneath the keys by this component.

### AC6 — Mission becomes three equal small-screen destinations

Given Mission below `1024px`, when no artifact is selected, then one
full-width panel is visible behind three equal brand-light tabs:
`Overview`, `Activity`, and `Detail`. Overview is initially selected; Detail is
disabled and clearly unavailable until a real artifact is selected. The panels
are not rendered as squeezed simultaneous columns or a slide-over.

Given the user selects an artifact in Overview or an artifact link inside
Activity prose, when that selection resolves, then Detail becomes available
and is selected automatically. Closing Detail clears the artifact selection
and returns to the non-Detail panel the user came from. Selecting the
already-active artifact preserves the existing toggle-close semantics and
likewise returns to that source panel.

The compact transition table is explicit and implemented through centralized
handlers over two independent concerns: `activeNode` is the sole artifact state;
`activeCompactMissionPanel` plus `detailReturnPanel` are UI navigation state.
Selecting a new artifact records the current Overview/Activity source, sets
`activeNode`, and selects Detail. Selecting the active artifact or closing
Detail clears `activeNode` and restores that source. Manually selecting Overview
or Activity preserves `activeNode` (Detail stays available) but hides its panel;
returning to Detail shows that same selection. Crossing 1024px preserves the
values, so desktop immediately shows the selected inline artifact and returning
to compact returns to the user's last compact panel.

Artifact selection and derivation are synchronous in the existing MissionBody
(`setActiveNode` plus an in-memory lookup), so there is no asynchronous resolve
whose response can arrive out of order; no request token is introduced. The
existing artifact-panel close button is the compact Detail close affordance.
After close/toggle-close, focus moves to the restored Overview/Activity tab;
desktop's existing panel and pop-out close behaviour is unchanged.

Given Mission at `>=1024px`, when it renders, then the existing inline
left/middle/optional-right three-card layout, internal card scrolling, and
artifact pop-out behaviour remain unchanged.

### AC7 — accessibility and responsive non-regression

All new tab controls expose a labelled tablist, `role=tab`, selected state,
arrow-key roving focus/activation, linked tabpanels, and semantic disabled state
where applicable. Inactive Mission panels remain mounted with the native
`hidden` contract at compact widths: scroll and component state survive, while
their controls are absent from the accessibility tree and tab order. Task
Detail's terminal-containing panes separately remain force-mounted and
zero-sized; these two persistence rules are not shared or conflated. Desktop
exposes all three Mission cards as today. Overlay
triggers expose their expanded state and accessible names. No interactive target required for touch operation
is reduced below 44px merely to save height; savings come from removing rows,
wrapping, and redundant padding.

At 390x844 and 430x932, neither Task Detail nor Mission causes horizontal page
overflow. At 820x1180 the compact one-pane navigation remains usable and the
unchanged tablet header/inline Description neither overlaps that row nor causes
horizontal overflow. At
1280x800 the existing desktop layout remains three-pane / three-card.

## 3. Product decisions and negative space

- **Chosen:** hybrid light/dark hierarchy — dark top chrome, light branded tab
  surfaces, dark terminal. Sven explicitly confirmed the light variant.
- **Chosen:** overlay disclosure for full title and Description; reflow would
  give the reclaimed terminal height back the moment either is opened.
- **Chosen:** one four-way compact workspace row; retaining Session plus the
  inner pair would preserve the exact redundancy being removed.
- **Chosen:** Mission's right/detail panel is conditional but automatically
  selected after a real artifact click.
- **Out of scope:** desktop visual redesign, terminal protocol or pty changes,
  new Ship's Log routes, changing transcript data, changing Mission artifact
  derivation, or altering the global phone top bar / 44px hamburger target.
- **Glossary:** `Shiplog` is display copy for the existing **Ship's Log** link,
  not a new surface or a renamed domain concept. `Detail` is the conditional
  right Mission panel, not a fourth Mission artifact type.

## 4. Affected boundaries

- **Responsive state:** existing `useIsPhoneViewport` and
  `useIsCompactViewport`; no new breakpoint.
- **Terminal mount boundary:** `TaskDetailThreePane` sizes mounted panels to
  zero rather than unmounting them; Radix tab contents stay `forceMount`.
- **Local preference:** the existing centre-tab localStorage preference remains
  the source of truth and already lives in TaskDetailPage as a controlled value.
  No key or serialized shape changes.
- **Routing:** Shiplog keeps the existing Ship's Log route constant.
- **Overlay layer:** the already-installed Radix Popover Portal is used with
  `modal=true` and the established application overlay z-index; no local portal
  root or HTML-rendering boundary is introduced.
- **Data / IO:** none. No API, JSONL, WS, pty, filesystem, or serialized-format
  producer/consumer changes.

## 5. Verification plan

- RTL/Vitest for title overlay vs desktop edit, phone Description overlay,
  compact Resume geometry, Shiplog copy/link semantics, four-way tab routing,
  terminal mount preservation, Mission Detail disabled/auto-selected/closed,
  equal key-bar padding, arrow-key tab navigation, inactive-panel accessibility,
  saved centre preferences, and non-zero terminal refit on reveal.
- Playwright in real Chromium at phone, compact-tablet, and desktop widths for
  geometry, horizontal overflow, visible-row count, automatic Mission Detail,
  and terminal subtree continuity.
- Real-stack screenshots at phone widths for Task Detail Terminal and Mission
  Overview/Detail; compare against the approved light-tab visual direction.
- Full client and server suites, both typechecks, both linters, test-hygiene
  diff scan, and production client build.

## 6. Confidence calibration (pre-build)

- **Depth:** the height loss has four measured structural sources: wrapping
  title/header content, a separate Shiplog/tab row with generous padding, a
  compact `Files / Session / Viewer` row plus a second Transcript/Terminal row,
  and asymmetric touch-key safe-area padding. Each source maps to an AC and a
  named test.
- **Breadth:** all user-visible decisions from the conversation are represented
  in AC1–AC7, including the later corrections that Shiplog is a link, that the
  expand icon may float, that Mission needs three conditional areas, and that
  the chosen branded surfaces are light.
- **Composition:** this is client UI composition, not Shipwright framework
  cross-component machinery. Nevertheless, terminal mount preservation and
  Mission click-to-detail are exercised in real-browser integration tests.
- **Boundary probe:** `touches_io_boundary=false`; no serialized format changes.

### Test completeness ledger (planned)

| Behavior | Disposition | Planned evidence |
|---|---|---|
| Phone title truncates and opens full-title overlay | tested | RTL + phone Playwright |
| Phone title/Description overlays do not grow header | tested | Playwright geometry |
| Desktop title editing and inline Description persist | tested | existing + updated RTL |
| Resume action preserved with compact phone geometry | tested | RTL |
| Shiplog is a link, not a tab; light branding fixed | tested | RTL + screenshot |
| Four direct compact workspace destinations | tested | RTL + Playwright |
| Terminal subtree/WS survives compact switches | tested | component mount probe + Playwright |
| Hidden/revealed terminal never emits a grid below 5x2, including pre-launch and replay | tested | size-sync/auto-launch units + whole-socket Playwright WS probe |
| Opaque 44px floating expand replaces compact title band without a larger dead zone | tested | RTL + Playwright |
| Touch key bar has symmetric padding and 44px keys | tested | RTL |
| Mission Detail disabled before selection and cannot receive focus/activation | tested | RTL keyboard + Playwright |
| Left/prose artifact click auto-selects Detail | tested | RTL + Playwright |
| Mission transition table, origin-aware close, manual hide, and breakpoint round-trip | tested | RTL + Playwright |
| Inactive compact Mission panels stay mounted/keep scroll but leave tab/a11y trees | tested | RTL |
| Title/Description render markup-like input as escaped text | tested | RTL |
| Mobile Rename closes overlay, reveals existing input, and focuses it | tested | RTL |
| Compact Detail close restores source-tab focus | tested | RTL |
| Native hidden remains effective despite Mission CSS | tested | RTL role/tab-order probe |
| Desktop Mission/Task Detail layout is unchanged | tested | desktop Playwright |
| Visual polish matches the approved direction | untestable | `requires-manual-visual-judgment`; browser screenshots retained as Surface evidence |

## 7. Review findings and dispositions

All accepted findings below were implemented before final verification. Native
review payloads live in the run folder; `external-code-review.json` preserves
the successful OpenRouter stdout verbatim, including its degraded Gemini leg.

| Source | Finding | Disposition |
|---|---|---|
| Internal code/doubt cascade | Pane selection had two sources of truth; hidden terminals could fit at zero width; early terminal focus could land inside an inert pane. | **Accepted.** TaskDetailPage controls the production pane state; legacy callers retain an uncontrolled fallback; fit/send paths require active, measurable, >=5x2 geometry; focus is post-commit. |
| Internal code/doubt cascade | Mission close/toggle/invalidation could leave selected disabled Detail after a desktop round-trip. | **Accepted.** Every clear path restores the recorded Overview/Activity source independently of breakpoint; only focus restoration is compact-only. Exact close, toggle-close, and live-invalidation round-trips are tested. |
| Internal code/doubt cascade | Desktop CTA height, compact Mission actions, Viewer focus, phone-only Playwright collection, active-tab branding, and whitespace/file-size gates regressed or lacked proof. | **Accepted.** Responsive minima reset at `md`; compact actions are >=44px; keyboard file activation focuses Viewer; desktop excludes the phone spec; light controls use dark text plus teal inset indicator; changed files are below 300 lines except the unchanged 673-line TaskDetailPage baseline. |
| OpenRouter rounds 1–2 | Desktop Mission close changed the compact destination; stale artifacts kept Detail enabled; saved centre preference and breakpoint projection lacked direct proof. | **Accepted.** Compact navigation mutates only when relevant, Detail availability derives from a resolved artifact, invalid selections clear safely, and first-commit plus compact↔desktop tests cover the persisted value. |
| OpenRouter rounds 1–2 | Active tabs were solid teal; visible Terminal did not explicitly refit on a 1024px crossing; Transcript/Terminal shared one ambiguous tabpanel. | **Accepted.** All three tab rows remain light with dark text and a teal indicator; `layoutRevision` re-runs the cancellable settled fit; the force-mounted Radix contents have distinct ids/labels. |
| OpenRouter round 4 | Desktop title was inadvertently truncated; title/Rename touch targets were undersized; the WS test could miss an invalid resize before a valid one; Activity prose links lacked compact coverage. | **Accepted.** Truncation is phone-only; both targets are 44px and browser-measured; every captured transition resize is asserted >=5x2 on the same socket; Activity→Detail is tested through a real narrative link. |
| OpenRouter final successful pass | Scoped review input omitted the separate Description files and therefore reported them absent. | **Not applicable by code fact.** `TaskDescriptionDisclosure` and `MissionTopRow` implement the conditional modal Portal path; RTL covers empty/markup/long content and the browser proves viewport bounds, focus return, and invariant header height. |
| OpenRouter final successful pass | The controlled pane API silently broke former callers; Shiplog semantics and several header paths needed stronger evidence. | **Accepted / clarified.** A tested uncontrolled fallback preserves the former prop contract while production stays controlled. Shiplog is asserted as the existing-route link, not a tab. Title Rename/escaping, empty Description, and Resume behavior are covered by focused RTL; browser coverage adds header geometry and focus return. |
| Final internal doubt pass | A second size producer could fit a hidden terminal to 2x1; Back and overflow remained below 44px. | **Accepted.** Both terminal size producers now share active, measurable and >=5x2 gates; Back/overflow are 44px on compact and retain desktop geometry. Unit and browser tests cover the exact paths. |
| Final internal code pass | Blocking hidden fits alone could let launch data overtake the required width sync; lifetime resize proof and file size were incomplete. | **Accepted.** Auto-launch waits for active visibility and a successful sync before sending data on the ordered socket, all frames since socket-open are checked at scenario end, and cohesive assertions were extracted to keep the spec at 299 lines. |

Final internal code and doubt re-reviews report no remaining findings. Later
OpenRouter retries returned only truncated/empty provider replies; they are
degraded transport results, not substituted for the successful recorded pass.
