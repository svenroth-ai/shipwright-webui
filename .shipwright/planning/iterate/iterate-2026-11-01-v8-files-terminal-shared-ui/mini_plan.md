# Mini plan: V8 Files & Terminal reuses the shared flat tree and the shared Info | Viewer sidebar

## Acceptance criteria (derived from the scope)
1. Left card = the shared flat FolderTree (V5: 15px / 28px rows, row context menu, Copy Path with the project root). No separate `ft-card ft-files` tree variant remains; the card chrome comes from a thin wrapper.
2. Desktop: the three cards share ONE 46px `.ft-head` band: left "Files" (+ refresh), middle "Terminal" + Expand/Maximize, right the segmented tabs `Info | Viewer` (where "Preview" used to stand) + a collapse button. No second tab row, no "Preview" text.
3. Right card = the SAME `MissionInfoSidebar` (V6) with a segment list of Info | Viewer only (no Folders), segment owned by the page; layout state of the Mission tab sidebar is untouched.
4. Open files remain tabs above the viewer (`ViewerTabBar`, same testids); clicking a file in the tree switches the right card to Viewer; Info Outputs open as tabs too.
5. The right card can be hidden (desktop sidebar collapse, tablet viewer toggle) and brought back from the middle head.
6. Phone/compact: ONE tab bar `Files | Terminal | Info | Viewer` + Expand button; Info and Viewer are segments of the same right pane (no second level, no "Preview" tab). Expand shares the header toggle state (`data-term-expanded`) and the bar stays visible while expanded.
7. Mission compact tabs stay Overview | Activity | Detail | Info (unchanged).
8. Terminal/pty untouched: same EmbeddedTerminal subtree, same mounting, no change to CLAUDE.md DO-NOT 17-22/28/29 surfaces.
9. English UI strings; tokens only; no new motion.

## Approach
- `MissionInfoSidebar` gains an `embed` config (segment, onSegmentChange, headless, onCollapse, onActivePathChange) and keeps open files as a tab list; chrome-less `.mc-side-embed` inside the outer `.ft-card.ft-view`.
- `FolderTree`: `flat` becomes the only variant (+ `headBand` prop for the shared band); wrapper card in `FilesTerminalSides.tsx` (`FilesCard`, `ViewCard`).
- `PaneTabBar` four tabs + trailing Expand (`TerminalExpandButton`); `useTerminalExpanded` becomes one shared store; `FocusModeContext` gets `sidebar` (desktop collapse), `ViewerToggle` shows as the way back.
- `TaskDetailPage` shrinks (viewer state moves into the sidebar); `TaskDetailThreePane` forwards segment props.

## Tests
Unit: PaneTabBar, MissionInfoSidebar.embed, TaskDetailThreePane.v8, useTerminalExpanded, FolderTree. E2E (isolated stack): `V8-files-terminal-shared-ui.spec.ts` desktop + phone incl. a keystroke through the pty; existing three-card / mobile / tablet / V5 / A13 specs re-run.

## Known limits / deviations
- The header Expand toggle on phone (MissionTopRow) stays next to the new tab-bar Expand (same state); removing the header one is a follow-up.
- Visual baselines `task-detail-terminal.png` (and any Files-tab launch-state shot) need Linux regeneration.

## External-Plan-Review-Findings (plan call: openai revise, glm revise; architecture call: glm approve, openai approve)
| Finding | Disposition |
|---|---|
| openai: embedded Folders handling / independent selection | accepted-and-fixed: EMBED_OPTIONS has no Folders, segment is page-owned, Mission layout key untouched (unit-tested) |
| openai (high): terminal lifecycle with shared expand store / compact switching | accepted-and-fixed: EmbeddedTerminal subtree untouched; E2E asserts terminal socket opens stay constant across tab switches + Expand and a keystroke is still its own byte |
| openai: file open while right card collapsed / hidden | accepted-and-fixed: ThreePane reveals a collapsed right card when viewerRequestKey bumps; tabs live in the always-mounted sidebar; E2E covers it |
| openai: audit FolderTree consumers before flat-only | accepted: grep + typecheck show only the page and Mission sidebar consume it |
| openai: head-band ownership | accepted: .ft-head owns Info|Viewer + collapse, ViewerTabBar sits above the viewer; verified desktop + phone in E2E |
| glm: extract headless sidebar content instead of embed prop-bag | rejected-with-reason: README row 16 prescribes MissionInfoSidebar with the segment list as a prop; a content extraction is a larger refactor than this unit |
| glm: keep tab state in the page | rejected-with-reason: each sidebar instance owns its own tabs; Mission and Files & Terminal never share a list, so Mission is structurally unaffected |
| glm: write down segment precedence | accepted: tree click / Output click always switch to Viewer (AC4) |
| glm: two Expand controls on phone | accepted-and-fixed: header toggle hidden on the Files tab (CSS, data-ft-active), the tab bar owns Expand |
| glm: expand scope | accepted: global compact-only flag (CSS under max-width 1023px), cleared on last unmount |
| glm: copy ACs into the spec | rejected-with-reason: the unit spec lives in the shared campaign worktree (orchestrator-owned); ACs are canonical in this mini plan |

## External-Code-Review-Findings (openai revise, glm revise)
| Finding | Disposition |
|---|---|
| openai (medium): re-open at a new line left a stale tab target | accepted-and-fixed: addTab replaces the stored target in place; unit test added |
| glm (high): useTerminalExpanded toggle closes over a stale value | rejected-with-reason: it reads the module-level variable at call time (not a render closure); unit test and E2E toggle back to false |
| glm (medium): closeTab acts on a stale list | accepted-and-fixed: synchronous tabsRef + functional setTarget |
| glm (medium): flat prop removal | rejected-with-reason: grep + typecheck show no other consumers |
| glm (low): tabs keyed by path only | rejected-with-reason: inside paths are root-relative, outside ones absolute, so they cannot collide |
| glm (low): middle head geometry unchecked | accepted-and-fixed: E2E asserts all three heads share the band |
