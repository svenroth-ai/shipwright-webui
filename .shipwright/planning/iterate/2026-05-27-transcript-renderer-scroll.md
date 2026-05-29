# Iterate Spec: transcript-renderer-scroll

- **Run ID:** iterate-2026-05-27-transcript-renderer-scroll
- **Type:** bug (3 of 4 ACs are renderer defects; AC4 is a CHANGE bundled because it touches the same surface)
- **Complexity:** medium
- **Status:** draft
- **Affected FRs:** FR-01.02 (Task detail / BubbleTranscript)
- **Risk flags:** `touches_shared_infra` (transcript renderer + `useAutoScroll`), `touches_io_boundary` (`session-parser.ts` parses Claude Code's on-disk JSONL — a third-party producer)

## Goal

Three Claude Code JSONL event classes currently render as "Unknown event"
(yellow warning card) or as raw text in a user bubble, and the transcript
scroll-up still flickers under live polling. Fix all four on one shared
surface (`session-parser.ts` + `BubbleTranscript/*` + `useAutoScroll.ts`)
in one PR, one external review, one E2E pass.

## Data-validated cause

Inspected the example session JSONL the user provided
(`~/.claude/projects/C--01-Development-shipwright-webui/86832cb1-db18-4cb8-8755-db8dc94b6fbf.jsonl`,
617 lines):

| Symptom | Top-level event | Count | Current renderer |
|---|---|---|---|
| "Unknown event: mode" yellow card, repeats every poll | `type: "mode"` (`{mode: "normal"}`) | 30 | `parseOne` falls through to `default` → `UnknownDetails` |
| "Unknown event: pr-link" yellow card (12 hits in screenshot zone) | `type: "pr-link"` (`prNumber`, `prUrl`, `prRepository`, `timestamp`) | 13 | `parseOne` falls through to `default` → `UnknownDetails` |
| Stop-hook output rendered as right-aligned user bubble | `type: "user"` with `content` string starting `Stop hook feedback:\n=========...\n  SHIPWRIGHT <GATE> ...` | 12 | No fingerprint detection → plain user bubble |
| Scroll-up "flicker" during live stream | — | — | `useAutoScroll` threshold-based detach (64 px) + 250 ms `ACTIVE_SCROLL_GUARD_MS`; slow scrollers stay inside the threshold zone and get yanked by 1 Hz polling |

The scroll issue is the **second recurrence** of `"Beim hochscrollen springt
alles"` (first fix iterate `iterate-2026-05-01-system-chips-and-scroll-polish`
introduced the 250 ms active-scroll guard; full quote is in
`useAutoScroll.test.ts:230-233`). Per memory `feedback_stop_stacking_patches`,
the next attempt MUST attack root cause, not extend the guard window.

Root cause: detach today is **position-based** (must move >64 px AND not
move for 250 ms). A user wheel-scrolling slowly stays inside that 64 px
zone forever — every 1 Hz `useTaskTranscript` poll then re-pins them. The
correct asymmetry is **detach on intent (any upward delta), re-attach on
position (within 64 px of bottom)**. This is the Slack / Discord /
ChatGPT pattern.

## Acceptance Criteria

- [ ] **AC1 — `mode` event renders as a permission-mode-style pill (defensive parsing).**
  `session-parser.parseOne` recognises `type: "mode"` and emits
  `kind: "mode-change"` with `mode: string` ONLY when
  `typeof raw.mode === "string" && raw.mode.length > 0`
  (external-review Gemini MEDIUM-10: if a future Claude release sends
  `{mode: {current: "normal"}}` the object would crash React on
  render — fall through to `kind:"unknown"` instead). New
  `ModeChangePill` in `BubblePills.tsx` mirrors `PermissionModePill`
  styling (lavender, matching `permission-mode` semantics — NOT
  sky-blue per the earlier mini-plan draft). Added to `SYSTEM_KINDS`
  in `filters.ts` so the toolbar's "show system" toggle hides it by
  default (repeats 30× per session, pure metadata noise).
  `TranscriptRow.renderBubble` dispatches to it. Vitest covers
  parser-case (string mode) + parser-rejection (object mode) +
  renderer-output + `SYSTEM_KINDS` membership. E2E asserts both
  toggle states (hidden-by-default + visible-when-system-on).

- [ ] **AC2 — `pr-link` event renders as a clickable PR card (defensive parsing).**
  `session-parser.parseOne` recognises `type: "pr-link"` and emits
  `kind: "pr-link"` ONLY when all of:
  (i) `prNumber` is `Number.isFinite()`,
  (ii) `prUrl` is a non-empty string matching `/^https?:\/\//`,
  (iii) `prRepository` is a non-empty string.
  Any other shape falls through to `kind:"unknown"` (preserves the
  existing diagnostic fallback). The scheme guard prevents
  `javascript:` / `data:` URLs from a tampered JSONL — the file is an
  io-boundary from a third-party producer (external-review HIGH-1).
  New `PrLinkCard` (own file
  `client/src/components/external/BubbleTranscript/PrLinkCard.tsx`,
  est. ~70 LOC) renders as a left-aligned anchor card:
  GitHub icon · `<prRepository> #<prNumber>` · external-link icon,
  `href={prUrl}` opens in new tab (`target="_blank"`,
  `rel="noopener noreferrer"`). Repeats of the same PR are NOT
  deduplicated at parser level — the renderer just shows them all
  (matches Claude's behaviour and keeps the parser stateless). Not in
  `SYSTEM_KINDS` (real content). Vitest covers parser-case + scheme
  rejection + malformed-payload fallback + renderer.

- [ ] **AC3 — Stop-hook user-content renders as a collapsed Tool-call-style card.**
  New helper `client/src/external/parsers/stop-hook.ts` exports
  `detectStopHook(content: unknown): { gateName, body } | null`.
  Detection pipeline (string-only — confirmed empirically all 12/12
  observations are strings, no array-content drift today):
  1. `typeof content === "string"` AND `content.length` between
     30 and 16384 bytes (sanity floor + length-guard against
     pathological inputs).
  2. `content.startsWith("Stop hook feedback:")` — STRING-start, not
     line-start. This is the R1 mitigation and is enforced by an
     explicit `startsWith` (no `/m` regex flag — external-review
     HIGH-2: `/m` would make `^` match mid-string line breaks, letting
     mid-prose like `"Hey:\nStop hook feedback:\n=..."` swallow the
     prose).
  3. Optional banner extraction via `^Stop hook feedback:\s*\n=+\s*\n\s*(.+?)\n=+\s*\n`
     (no `m` flag, anchored at string-start). If matched, gateName is
     the trimmed capture. If the prefix is present but banner is
     malformed, `gateName` defaults to `"Stop hook"` and the event is
     still classified as `stop-hook` (we don't want to swallow stop-hook
     output just because the banner shape drifted).
  `session-parser.parseOne` (inside the `case "user"` branch, AFTER
  `task-notification` reclassification — most specific first) calls
  `detectStopHook(content)`; on hit emits
  `kind: "stop-hook"` with `gateName: string`, `body: string` (full
  raw content). On miss falls through to plain `user`.
  New `StopHookCard` (own file
  `client/src/components/external/BubbleTranscript/StopHookCard.tsx`,
  est. ~110 LOC, modeled on `SkillCard.tsx`) — **collapsed by default**
  per user preference, header chevron expands to render `body` inside
  `<pre>` (it's ASCII art + monospace text, no Markdown). Header shows
  ShieldAlert icon · `STOP HOOK` label · `<gateName>` (mono) · chevron.
  Expansion state is local to the component instance (`useState`);
  `stableEventKey` in `filters.ts` uses `event.uuid` so polling-driven
  re-renders preserve expanded state. Stop-hook events are real content
  — NOT in `SYSTEM_KINDS`. Vitest covers fingerprint detection
  (positive + 16 KB length-guard + mid-prose negative falsification +
  malformed-banner fallback) + renderer collapsed/expanded.

- [ ] **AC4 — `useAutoScroll` detach is intent-based, re-attach is threshold-based.**
  Add a `lastScrollTop: useRef<number>(0)` that is **initialized to
  `el.scrollTop` on scroll-listener attach** and reset whenever the
  effect re-runs (dep-change / container swap) — external-review
  HIGH-3. Add `RUBBERBAND_TOLERANCE_PX = 8` constant (external-review
  Gemini MEDIUM: macOS/iOS overshoot bounce-back at the absolute
  bottom registers as an upward delta and would falsely detach).
  Inside the `onScroll` listener, after computing `distance` /
  `atBottom`:
  ```
  const isProgrammaticEcho = now - lastProgrammaticScrollAt.current <= 50;
  const movedUp = el.scrollTop < lastScrollTop.current;
  const inRubberbandZone = distance < RUBBERBAND_TOLERANCE_PX;
  if (movedUp && !isProgrammaticEcho && !inRubberbandZone) {
    userDetached.current = true;   // intent-based, asymmetric detach
    setIsAtBottom(false);
  }
  ```
  The existing threshold-based re-attach path
  (`atBottom → userDetached.current = false`) is preserved AFTER this
  block so re-attach still fires when the user scrolls back to within
  64 px of the bottom (and includes the rubber-band landing).
  The existing 250 ms `ACTIVE_SCROLL_GUARD_MS` stays as defense-in-depth.
  `lastScrollTop.current = el.scrollTop` is updated at the end of the
  handler. **Behaviour change vs. existing tests:** the "DOES re-pin
  after the active-scroll guard window has elapsed" spec at
  `useAutoScroll.test.ts:270-292` is replaced with the new contract:
  once the user has scrolled up with intent, they STAY detached until
  they cross the 64 px re-attach threshold. The remaining 5 specs
  (mid-transcript guard, growth re-pin, shrink no-op, sequential
  growth baseline, dep-change baseline, post-detach scroll-away) MUST
  still pass unchanged. New specs: (a) initial-mount `lastScrollTop`
  init does NOT spuriously detach on the first scroll event;
  (b) upward delta in the at-bottom zone (distance 30 → 40) DOES
  detach (this is the regression fix); (c) upward delta in the
  rubber-band zone (distance 2 → 5) does NOT detach.

## Confidence Calibration

- **Boundaries touched:** `session-parser.ts` parses Claude Code JSONL
  (external producer; schema evolves between Claude releases).
  `useAutoScroll.ts` consumes browser DOM scroll events (cross-platform
  variance: trackpad vs wheel vs touch vs keyboard).
- **Empirical probes run (post-build, all GREEN):**
  - Parsed the user's example session (617 lines): confirmed `mode` (30×),
    `pr-link` (13×), Stop-hook user-string (12×). The set of distinct
    top-level types in this session is `agent-name, assistant, attachment,
    custom-title, file-history-snapshot, last-prompt, mode,
    permission-mode, pr-link, system, user` — no other unknowns lurking.
  - **Boundary-probe round-trip** (`transcript-fingerprints.roundtrip.test.ts`,
    5/5): a 10-event JSONL mirroring the on-disk shapes parses with ZERO
    `kind:"unknown"`, mode-change ×2, pr-link ×1, stop-hook ×1, trailing
    plain-user message survives (not swallowed).
  - Defensive parsing covered: `javascript:`/`data:`/bare-path/NaN/
    non-numeric prNumber/empty repo/empty url all fall through to
    `unknown` (9 parser tests); mode object/missing/empty → `unknown`.
  - `useAutoScroll` 12/12 incl. rubber-band-no-detach + lastScrollTop-init
    + sticky-detach-after-guard. Full client suite 1328/1328; tsc clean;
    oxlint clean on touched files.
  - `pr-link` payload shape verified: `{prNumber: number, prUrl: string,
    prRepository: string, timestamp: ISO}` — all three string/number
    fields populated in 13/13 events.
  - Stop-hook fingerprint: 12/12 hits start with literal
    `"Stop hook feedback:\n=...\n  SHIPWRIGHT <NAME> GATE"`; banner
    char is `=` (single byte) followed by `\n` followed by a 2-space
    indent before the title — the regex must allow that indent.
  - `useAutoScroll`: re-read the 2026-05-01 ACTIVE_SCROLL_GUARD chapter;
    the previous fix's failure mode is documented in the file itself.
- **Edge cases NOT probed + why acceptable:**
  - Stop-hook output for non-bloat gates (test gate, custom hooks):
    untested; the fingerprint allows `(?:GATE)?` so a `SHIPWRIGHT
    SOMETHING` banner is captured. Fallback to `"Stop hook"` if banner
    is missing keeps it from ever swallowing as plain user.
  - Touch-device scroll: `useAutoScroll`'s `scrollTop` comparison is
    portable across input devices; touch fires `scroll` like wheel. Not
    probed empirically (no touch device on hand) but the mechanism is
    input-agnostic.
  - PR card on dark theme: existing CSS-var palette
    (`var(--color-surface, …)`) inherits theme correctly — no probe.
- **Confidence-pattern check:** the prior scroll fix shipped with full
  test coverage and still didn't solve it because the test surface
  (RO callback driven by mock scrollHeight changes) didn't model the
  threshold-stays-inside-zone case. This iterate adds a direct test for
  that case: user at scrollTop=470 (within 64 px of bottom), scrolls UP
  to scrollTop=460 — assert `userDetached` flips true. Without that
  test the heuristic remains unfalsifiable (asymptote risk per
  `references/confidence-anti-patterns.md`).

## Affected FRs

- **FR-01.02 Task detail (3-pane viewer) — Transcript pane.** No
  spec.md change required; the transcript renderer is one component
  inside this FR and we extend it with three new event kinds + a
  scroll-behavior refinement. Spec Impact: NONE (BUG default).

## Affected Boundaries (Self-Review item 7)

1. **JSONL → ParsedEvent.** `session-parser.ts` adds three new
   discriminated-union variants (`mode-change`, `pr-link`, `stop-hook`).
   Round-trip-test covers all three.
2. **DOM scroll events → React state.** `useAutoScroll.ts` direction-
   aware detach. Existing 6 tests + 1 new test.
3. **`SYSTEM_KINDS` set.** Adding `mode-change` to it; downstream
   `filterEventsForRender` + toolbar visibility test.

## Out-of-scope

- Stop-hook *re-classification by gate type* (BLOAT GATE vs others) —
  one renderer, gate name visible in header, no per-gate styling.
- Deduplication of consecutive identical `pr-link` events — 13/13 in the
  sample session all link to the same PR, but suppressing them at parser
  level changes the meaning ("PR opened at T1, updated at T2"). Render
  all, let the user collapse via the system-toggle if it becomes noise
  (future iterate if needed).
- Other "Unknown event" cases — only `mode` and `pr-link` exist in the
  sample. If a new unknown surfaces post-fix, that's a separate iterate
  with empirical evidence.
- `useTaskTranscript` polling cadence (1 Hz) — orthogonal; ADR-035 keeps
  the CSS-first approach intact.

## Risks

- **R1 — Stop-hook fingerprint false-positive.** A legitimate user
  message that quotes `"Stop hook feedback:\n====\n..."` verbatim would
  be reclassified. Mitigated: regex requires the banner pattern (===
  line, capitalized title, second === line) at the START of the content
  (`^` anchor). Mixed prose that mentions Stop hooks falls through to
  plain user. Caught by Vitest mixed-prose negative test.
- **R2 — `mode` event semantic drift.** Claude Code currently emits
  `{mode: "normal"}` 30× per session as a heartbeat. If a future Claude
  release changes the field name or starts emitting `auto`, `plan` etc.
  with side effects we don't render, we'd hide useful info under the
  system toggle. Mitigated: pill shows `mode` value verbatim; visible
  when system toggle is on.
- **R3 — `useAutoScroll` intent-based detach over-reacts.** A
  microscroll-down-up oscillation could leave the user perpetually
  detached. Mitigated: re-attach path is threshold-based — landing
  within 64 px of bottom flips it back. The asymmetry is the design.

## Test Strategy

- **Vitest** — 4 new parser cases + 4 new renderer specs (jsdom) +
  1 new `useAutoScroll` test for intent-based detach.
- **Boundary Probe** (round-trip from JSONL fixtures) — capture a
  copy of the example session, parse it, assert event counts +
  no remaining "Unknown event" rows.
- **Playwright E2E** (mandatory at medium) — seed a synthetic JSONL
  in a temp `~/.claude/projects/...` (per `feedback_iterate_e2e_isolated_userprofile`),
  open the transcript page, assert all 4 new cards render, no
  "Unknown event" pills, and that an upward `wheel` event sets the
  Jump-to-latest button visible.
- **Live browser smoke** — load the user's actual session in the
  running webui (after server restart per
  `feedback_merged_is_not_deployed`), confirm visually that the
  screenshot scenario is gone.

## Reflection (F3a)

- **What worked:** Treating the scroll bug as a recurrence (memory `feedback_stop_stacking_patches`) and refusing to extend the 250ms guard a third time — the intent-based detach is a root-cause fix, and asserting on the `isAtBottom` observable (not RO/scrollTop mechanics) made the AC4 tests robust against mount-scroll/guard timing artifacts that the first test draft tripped over.
- **External review earned its keep:** the `/m`-flag falsification (would have swallowed mixed prose) and the `prUrl` XSS scheme-guard were both caught at plan time, before a line was written. Cheaper than catching them in code review.
- **Worktree + shared-script gotcha:** `write_decision_drop.py` / `finalize_iterate.py` resolve the project root to the MAIN tree unless `SHIPWRIGHT_PROJECT_ROOT` is set to the worktree absolute path. The decision-drop landed in the main tree and had to be moved by hand; subsequent scripts were run with the env var set. Worth a memory note so the next worktree iterate doesn't lose artifacts off-branch.
- **Bloat call:** accepting the `session-parser.ts` 716→826 ratchet (vs. extracting the user-content detectors) was the right Ousterhout call — the detectors aren't a reusable abstraction, just private helpers; the real architectural split (render-side accessors, ~270 LOC) stayed out of scope.
