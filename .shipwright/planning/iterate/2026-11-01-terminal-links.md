# Iterate Spec: terminal-links

- **Run ID:** iterate-2026-11-01-terminal-links
- **Type:** feature
- **Complexity:** medium (classifier estimate `small`; raised on positive evidence: new user-visible capability on the embedded terminal, cross-surface wiring terminal -> Files & Terminal page -> shared info sidebar, mandatory real-browser E2E incl. phone width)
- **Status:** draft

## Goal
File paths printed in the embedded terminal (relative or absolute, Windows and POSIX, optional `:line[:col]`) become clickable and open in the Smart Viewer in the right-hand card, reusing the path the Mission chat file chips already use. Web links keep their existing behaviour. Client-side only, read-only addition on the xterm instance.

## Findings about the EXISTING link handler (reported to the operator)
- `client/src/components/terminal/openTerminalLink.ts` builds an `@xterm/addon-web-links` `WebLinksAddon` (0.12.0) with a custom activation callback; `xtermAddons.ts` loads it.
- The callback has NO modifier check: a **plain click** opens `http(s)://` links in a **new tab** with `noopener,noreferrer`; any other scheme is ignored. This matches what the operator sees ("artifact links open without Ctrl/Cmd").
- xterm's own activation only fires when mouse-down and mouse-up land on the same link (a drag-select that ends elsewhere does not open it).

## Decision: activation for the NEW file links
Plain click / tap, identical to web links (consistency; a phone has no Ctrl key). Guards against accidental opens (`createClickGuard` + provider): primary button only (a right/middle click never opens), never the 2nd+ click of a multi-click, the pointer must not have moved more than 4px since mousedown (a drag that copies part of a path - including inside Claude's own mouse-tracking screen, where xterm keeps no selection - does not open it), and nothing while the terminal has a selection. Residual accepted risk: the FIRST click of a double-click word-select on a path still activates (opens the Viewer, non-destructive). The operator will try it live and decide whether to move file links behind Ctrl/Cmd (one-line change in `createClickGuard`).

## Acceptance Criteria
- [ ] AC-1 (web, unchanged): clicking `https://example.test/x` printed in the terminal calls `window.open(url, "_blank", "noopener,noreferrer")` with no modifier key; `file:`, `javascript:`, `data:` URIs never open (existing `openTerminalLink` tests stay green; no new web-link code path).
- [ ] AC-2 (detection): `findFileLinkCandidates()` returns the path (with `line`; `:col` is recognised and linked but not carried) for `src/a.ts:12:5`, `./a.ts`, `C:\proj\a.ts:3`, `C:/proj/a.ts`, `/home/u/a.py`, `(C:\p\a.js:10:5)` (parens stripped), `a.ts,` / `a.ts.` / `"a.ts"` (trailing punctuation / quotes stripped), `a.ts(12,5)` (tsc style); and returns nothing for a path containing a space (a token following an absolute-path head that is no file by itself, e.g. `C:\Program Files\a.ts` or `/Users/x/My Docs/a.ts`, is never linked on its own), `console.log`, `v1.2.3`, `https://h/x/a.ts`, `file:///x/a.ts`, UNC `\\srv\x\a.ts`, `..` traversal.
- [ ] AC-3 (wrapped lines): a path that xterm soft-wrapped over two buffer rows is linked as ONE link whose range spans both rows (provider unit test against a fake buffer).
- [ ] AC-4 (project file, E2E): with a project file `src/hello.ts` printed in the terminal, a click on it switches the right card to the Viewer segment and the viewer shows the file text (`[data-testid=...]` of the viewer contains the file's content); the request target is root-relative (`outside: false`).
- [ ] AC-5 (evidenced outside file, E2E): an absolute path outside the project that the session evidences (JSONL mention) opens in the Viewer with the "outside project" scope header.
- [ ] AC-6 (unevidenced outside file, E2E): an absolute path outside the project that the session does NOT evidence does not open the Viewer; the corner notice `[data-testid=embedded-terminal-clipboard-notice][data-notice-kind=link-not-in-session]` reads "Not part of this session" and auto-dismisses.
- [ ] AC-7 (phone, E2E at 393x851 touch): a vertical touch-scroll on terminal text containing links scrolls the terminal and opens nothing; a tap on a link opens it.
- [ ] AC-9 (click guard): `createClickGuard.isClick` is false for a right/middle click, a click with detail > 1, a pointer that moved > 4px since mousedown, and a click with no preceding mousedown; true for a still primary single click.
- [ ] AC-10 (stale probe): when a newer file-link click or a task switch happens while an outside-file check is in flight, the older result neither opens the Viewer nor shows the notice.
- [ ] AC-8 (no pty/protocol change): `git diff` touches no file under `server/` and no pty/replay/snapshot/renderer/redraw/resize/scrollback client module (guard: diff-scope assertion in the review, DO-NOT 17-22, 28, 29 untouched).

## Spec Impact
- **Classification:** modify
- **ADD:** none
- **MODIFY:** FR-01.28 (Embedded terminal) - file paths in terminal output are clickable and open in the Smart Viewer; web links unchanged. FOLD per MINT-vs-FOLD: completes the existing embedded-terminal capability, not a new product capability.
- **REMOVE:** none

## Out of Scope
- Any server change (path-evidence rule, `path-guard`, session-file route stay as is).
- Any pty / replay / snapshot / renderer / redraw / resize / scrollback change.
- Ctrl/Cmd gating (decision above; operator decides after a live try).
- Detecting paths with spaces; directory links; line-jump inside the viewer (the `line` is carried in the target as informational, same as chat chips).
- Hover tooltips / previews.

## Design Notes
Behaviour only, no mockup. Notice reuses the existing terminal corner-pill (`ClipboardNoticeKind`) with one new kind, styled with theme tokens only. Underline/pointer cursor come from xterm's link decoration.

## Affected Boundaries
n/a - no serialized format changes. Reads only: terminal buffer text (client), `GET /api/external/tasks/:id/session-file` status code (existing route, unchanged).

## Confidence Calibration
- **Boundaries touched:** none (see Affected Boundaries).
- **Empirical probes run:** (1) real xterm buffer + real pty + real routes in a real browser (spec 106): web link, project file, evidenced outside, unevidenced outside, right-click/drag guard, Pixel-5 touch swipe + tap; (2) mouse-tracking mode (`?1003h/?1006h`) set on the real xterm: the file link still activates (xterm's linkifier fires in Claude's TUI mode); (3) adversarial tokenizer cases (quoted/parenthesised/`--flag=`/relative heads, multi-space paths, 1024-char runs) as unit cases; (4) wrapped rows, wide characters, mid-row empty cells against a fake buffer. NOT probed: a click inside a live Claude session (does Claude also receive it as a mouse report?) and iOS Safari - both left as operator hand steps.
- **Test Completeness Ledger:**

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | Path detection (rel/abs, Windows/POSIX, :line:col, tsc, punctuation, quotes) | tested | terminalLinkMatch.test.ts PASSED |
  | 2 | Rejections (code names, versions, URLs, file:, UNC, traversal, ~, spaced paths, quoted/relative spaced heads) | tested | terminalLinkMatch.test.ts PASSED |
  | 3 | Soft-wrapped, wide-char and empty-cell rows join correctly; 1-based inclusive ranges | tested | terminalFileLinkProvider.test.ts PASSED |
  | 4 | Click guard (button, multi-click, drag, outward-and-back, no mousedown) and selection guard | tested | terminalFileLinkProvider.test.ts PASSED |
  | 5 | Provider never calls window.open | tested | terminalFileLinkProvider.test.ts PASSED |
  | 6 | Inside/outside resolution, refused -> notice, not refused -> open, stale result dropped, not-ready no-op | tested | useTerminalFileLinks.test.tsx PASSED |
  | 7 | Single registration per mount, dispose on unmount | tested | useTerminalFileLinks.test.tsx PASSED |
  | 8 | isRefusedBySession (403, truncated window, 200/404/500, network) | tested | sessionFileApi.refused.test.ts PASSED |
  | 9 | Web link opens with noopener on a plain click | tested | 106 spec web-link PASSED (isolated stack) |
  | 10 | Project file opens in Viewer on Files & Terminal page | tested | 106 spec PASSED |
  | 11 | Evidenced outside file opens with Outside-project tag | tested | 106 spec PASSED |
  | 12 | Unevidenced outside file: hint shown, nothing opens, hint dismisses | tested | 106 spec PASSED |
  | 13 | Right-click and drag do not open | tested | 106 spec PASSED |
  | 14 | Works with mouse tracking on | tested | 106 spec PASSED |
  | 15 | Phone: swipe scrolls and opens nothing; tap opens | tested | 106 spec (touch emulation) PASSED |
  | 16 | New notice kind renders with theme tokens | tested | 106 spec (notice testid/attr) PASSED |
  | 17 | Click inside a live Claude session / iOS Safari tap | untestable | requires-interactive-tty |

- **Confidence-pattern check:** depth: the review cascade found real defects after the author's own "done" (guard in mouse-tracking mode, spaced-path tails, stale probe, wrap-boundary space); each was fixed with a test and a further probe (mouse-tracking E2E) was added, and the external code review's later findings (long spaced paths, outward-and-back drag, trailing-punctuation head test) were fixed likewise. Breadth: 16 tested, 1 untestable with a closed-vocabulary code, 0 untested-testable.

## Review Outcomes
- **Code review (Stage 2):** 6 findings (2 medium, 4 low) - all fixed (wrap-boundary empty cell only, multi-space tails, row cap, tsc regex cost, guard readability, cleanup order note).
- **Doubt review (Stage 3):** 2 medium, 3 low. (a) Plain click reveals the right card via the page's existing viewer-request effect, which un-collapses a COLLAPSED right card and persists that layout, exactly like every other open path (file tree, chat chips) (TaskDetailThreePane.tsx: only when the card is collapsed) - REBUTTED as intended and listed as a leftover risk for the operator's live try (a phone focus-tap that lands on a path opens it; Ctrl/Cmd gating is the stated fallback). (b) quoted/parenthesised/flag/relative heads bypassed suppression - FIXED + tests. (c) cleanup now bumps the sequence - FIXED. (d) TUI mouse mode - probed (E2E), live-Claude click double-handling left as a hand step. (e) quadratic strip - FIXED (tsc regex only when a `(` exists).
- **External code review (glm + openai, both `revise`):** long spaced paths with separator-less words, outward-and-back drag, A-B-A task sequence, trailing punctuation making a complete path look like a head, e2e helper positional click - all FIXED with tests; reconnect/replaced-terminal concern answered by the one-xterm-per-mount invariant (documented at the hook); touch click without mousedown and `PATH=` env values disclosed.
- **Known limitations (for the ADR):** relative paths resolve against the task cwd, not the shell's current directory; a relative head with spaces (`src/My Folder/a.ts`) and TUI hard-wrapped fragments are not detected as one path; one extra evidence scan per outside click; iOS Safari and a live Claude click unverified.

## Verification (medium+)
- **Surface:** web
- **Runner command:** `node client/e2e/isolated-stack.mjs` running `client/e2e/flows/106-terminal-file-links.spec.ts`
- **Evidence path:** `.shipwright/runs/iterate-2026-11-01-terminal-links/`

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** medium
- **Summary:** Design sound (separate provider, client-only, server stays the authority); fix guard, race, spaced-path tail, line budget, hook placement before shipping.
- **Findings:**
  - completeness/medium selection guard useless in Claude's mouse-tracking screen -> fixed (movement + button + detail guard, AC-9)
  - security/medium activation ignores mouse button -> fixed (button === 0, AC-9)
  - completeness/medium spaced path tail linked ("My Docs/a.ts" -> wrong file) -> fixed (path-head heuristic, AC-2 wording + tests)
  - architecture/medium older click can override newer / task switch -> fixed (sequence + taskId check, AC-10)
  - performance/low double evidence scan per outside click; 403 on overloaded scan queue shown as "Not part of this session" -> partly fixed (`evidence_window_truncated` is not reported as refused); double scan disclosed
  - architecture/medium hook placement (effect order, StrictMode) + TaskDetailPage hook before early returns -> fixed (hook after mount effect, deps [termRef], accepts undefined task; real-browser E2E runs under the dev StrictMode)
  - architecture/medium EmbeddedTerminal line budget (import counts) -> fixed (net +2, 311 = baseline cap, no bump)
  - completeness/medium TUI hard-wrapped (not isWrapped) fragments can parse as a path -> disclosed
  - completeness/low wide char at row end inserts a space -> fixed (empty cell at a soft-wrap boundary skipped)
  - completeness/low iOS Safari tap behaviour unverified; alt-buffer scroll -> disclosed (hand step)
  - completeness/low relative paths resolve against task cwd, not the shell's current dir; click ignored while project still loading -> disclosed
  - security/low passed; add test that provider never calls window.open -> done
- **Known limitations:** TUI hard-wrapped fragments; relative paths vs shell `cd`; iOS Safari unverified; double evidence scan per outside click; click ignored while the project query loads.
- **Status:** 7 fixed, 4 disclosed

## Internal Architecture Review (architecture-internal-reviewer)
- **Ran:** yes
- **Severity:** low
- **Summary:** Build option A (separate client link provider); smallest correct option; delegate all validation to parseFileRef.
- **Findings:**
  - necessity/low worth building -> accepted
  - smallest-option/low take A, keep createTerminalLinksAddon byte-identical -> accepted (untouched)
  - complexity-cost/medium avoid a second rule set -> accepted: terminalLinkMatch only tokenises/strips and hands every token to `parseFileRef` (no validation of its own beyond the token-level URL/~ skips)
  - completeness/medium relative paths vs task cwd -> disclosed
  - completeness/low provider mount location -> fixed (page-level `useTerminalFileOpen`, read via ref)
  - security/low, perf/low -> no change / scan only the logical line, capped at 40 rows
- **Known limitations:** relative paths resolve against the task cwd.
- **Status:** 2 fixed, 1 disclosed

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-11-01-terminal-links/architecture_brief.md`
- **Verdicts:** glm=revise (see findings) / openai=revise (via codex)
- **Smallest thing that would do (per reviewers):** as proposed (separate client provider)
- **Findings:** (external plan review, both models) probe failure opens the Viewer (fail-open) -> declined with reason: the Viewer's own request is gated by the same server route, so the probe is a UX pre-check, not an access control; a failed probe must not block a legitimate open, and the Viewer shows the server's error. Stale async result -> fixed (AC-10). Lifecycle of registration -> verified (single registration per mount, dispose on cleanup, unit tested). Token-level exclusions -> tests added (URL in `--url=`, absolute `..`, UNC, traversal). Auto-dismissing notice assertion flake -> E2E asserts visibility immediately then hidden with generous timeout.
- **Reconciliation:** the mini-plan's alternatives (extend the web-links addon, server-side detection) stay rejected; reviewers recommended neither.
