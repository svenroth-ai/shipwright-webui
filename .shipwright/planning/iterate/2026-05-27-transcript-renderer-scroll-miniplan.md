# Mini-plan: transcript-renderer-scroll

Iterate: `iterate-2026-05-27-transcript-renderer-scroll` (medium BUG +
bundled CHANGE). Spec: `2026-05-27-transcript-renderer-scroll.md`.

## File-level changes

| File | Action | Est ΔLOC |
|---|---|---|
| `client/src/external/session-parser.ts` | Add 3 type defs (`ModeChangeEvent`, `PrLinkEvent`, `StopHookEvent`) to the `ParsedEvent` union. Add 2 cases to `parseOne` (`mode` with `typeof === "string"` guard; `pr-link` with finite-number + scheme-validated url + non-empty repo defensive parsing). Inside `case "user"`, after `task-notification` detection and before falling through to plain `user`, call new `detectStopHook(content)` helper; if hit, emit `kind: "stop-hook"`. | +38 |
| `client/src/external/parsers/stop-hook.ts` | NEW. `detectStopHook(content: unknown): { gateName: string; body: string } \| null`. String-only (16 KB length-guard, 30-char floor). Step 1: `content.startsWith("Stop hook feedback:")` — STRING-start, no `/m` flag (external-review HIGH-2 falsified the `/m` design). Step 2: regex `/^Stop hook feedback:\s*\n=+\s*\n\s*(.+?)\n=+\s*\n/` (no `m`) extracts gate name; on banner-malformed-but-prefix-present case, returns `{gateName: "Stop hook", body: content}` (don't swallow stop-hook output just because banner shape drifted). | +60 |
| `client/src/external/parsers/stop-hook.test.ts` | NEW. Positive (real BLOAT GATE payload from observed JSONL), negative (random user text, partial banner), mixed-prose (legit message that quotes "Stop hook feedback:" mid-text), length-guard (huge input returns null). | +90 |
| `client/src/external/session-parser.test.ts` | Add tests: `parseOne` returns `kind:"mode-change"` for `type:"mode"`; returns `kind:"pr-link"` for `type:"pr-link"` with all three fields; user event with stop-hook payload returns `kind:"stop-hook"`. | +60 |
| `client/src/components/external/BubbleTranscript/BubblePills.tsx` | Add `ModeChangePill` (~22 LOC, sky-blue tinted, analog `PermissionModePill`). | +22 |
| `client/src/components/external/BubbleTranscript/PrLinkCard.tsx` | NEW. Left-aligned anchor card. `<a href={prUrl} target="_blank" rel="noopener noreferrer">` wrapping a row with `Github` icon (lucide) · `<prRepository> #<prNumber>` · `ExternalLink` icon. CSS-var palette, ~60 LOC. | +60 |
| `client/src/components/external/BubbleTranscript/PrLinkCard.test.tsx` | Vitest: renders with correct href, repo, number, target/rel attributes, data-testid. | +40 |
| `client/src/components/external/BubbleTranscript/StopHookCard.tsx` | NEW. Collapsed-by-default card modeled on `SkillCard.tsx`. `ShieldAlert` icon (lucide) · `STOP HOOK` label · gate name (mono) · chevron. Click toggles `expanded` state. Body in `<pre>` (preserve ASCII art). ~115 LOC. | +115 |
| `client/src/components/external/BubbleTranscript/StopHookCard.test.tsx` | Vitest: collapsed by default; click expands; body rendered verbatim; aria-expanded toggles. | +55 |
| `client/src/components/external/BubbleTranscript/TranscriptRow.tsx` | Add 3 dispatch branches before the `unknown` fallback at L253: `mode-change` → `ModeChangePill`, `pr-link` → `PrLinkCard`, `stop-hook` → `StopHookCard`. | +6 |
| `client/src/components/external/BubbleTranscript/TranscriptRow.test.tsx` | Add 3 dispatch tests + assertion that `unknown` no longer fires for these kinds. | +60 |
| `client/src/components/external/BubbleTranscript/filters.ts` | Add `mode-change` to `SYSTEM_KINDS`. | +1 |
| `client/src/hooks/useAutoScroll.ts` | Add `lastScrollTop` ref. **Initialize from `el.scrollTop`** at scroll-listener-effect attach time (external-review HIGH-3). Add `RUBBERBAND_TOLERANCE_PX = 8`. In `onScroll`: compute `movedUp = el.scrollTop < lastScrollTop.current`, `inRubberbandZone = distance < 8`, and `isProgrammaticEcho = (now - lastProgrammaticScrollAt) <= 50`. When `movedUp && !isProgrammaticEcho && !inRubberbandZone`: set `userDetached.current = true` + `setIsAtBottom(false)`. Existing threshold-based re-attach unchanged. Update `lastScrollTop` at end. | +20 |
| `client/src/hooks/useAutoScroll.test.ts` | (a) UPDATE test at L270-292 "DOES re-pin after the active-scroll guard window has elapsed" → new contract "STAYS detached after the guard window once user scrolled up with intent" (expected scrollTop=470, not 1300). (b) ADD: initial-mount `lastScrollTop` init does NOT spuriously detach. (c) ADD: upward delta in at-bottom zone (distance 30 → 40) DOES detach. (d) ADD: upward delta in rubber-band zone (distance 2 → 5) does NOT detach. | +75 |
| `client/e2e/transcript-renderer-fingerprints.spec.ts` | NEW. F0.5 E2E. Seed a JSONL fixture with `last-prompt`, one `mode`, one `pr-link`, one `assistant`, one stop-hook user-content via temp `USERPROFILE` + `SHIPWRIGHT_NETWORK_PROFILE=local` per memory. Open task page. Assertions: (a) no `[data-testid=bubble-unknown]` visible, (b) one `[data-testid=mode-change-pill]` (under system-toggle), (c) one `[data-testid=pr-link-card]` with correct text + href, (d) one `[data-testid=stop-hook-card]` with `aria-expanded=false`, click expands. | +130 |
| `shipwright_bloat_baseline.json` | Update `session-parser.ts.current` from 716 → ~744 (delta matches actual). ADR justification in F3-drop. | +0 net |

Total: ~12 files modified, 7 new. Net diff ~+700 LOC (mostly new test/component code; session-parser.ts +28 LOC).

## Build order (TDD, one AC per commit-boundary inside the same branch — final commit is one consolidated message)

1. **AC1 mode-change** — write parser test (RED), add `ModeChangeEvent` interface, add `case "mode"` to parseOne, write pill test, add `ModeChangePill`, add dispatch in `TranscriptRow`, add to `SYSTEM_KINDS`. GREEN.
2. **AC2 pr-link** — write parser test (RED), add `PrLinkEvent` interface, add `case "pr-link"` to parseOne, write card test, add `PrLinkCard` file, add dispatch in `TranscriptRow`. GREEN.
3. **AC3 stop-hook** — write helper test (RED), add `parsers/stop-hook.ts` with `detectStopHook`, write parser-integration test, add `StopHookEvent` interface, wire into `parseOne` `case "user"` (after `task-notification`, before falling through to plain `user`), write card test, add `StopHookCard` file, add dispatch in `TranscriptRow`. GREEN.
4. **AC4 useAutoScroll intent-based detach** — write test (RED, expects scrollTop NOT yanked after small upward delta), modify hook, GREEN.
5. **Boundary probe** — fixture-based round-trip from the real example JSONL parsed into events; assert (i) no `unknown` kind for `mode|pr-link`, (ii) stop-hook count matches the user-content fingerprint count.
6. **F0.5 E2E** — seed fixture, drive Playwright against real stack, all 4 assertions green.

## Alternative considered (rejected)

Split into 2 iterates — A: renderer (AC1-3) BUG, B: scroll (AC4) CHANGE.
Rejected because: (a) same `touches_io_boundary` setup serves both;
(b) user explicitly chose bundling at the scope question;
(c) one PR, one external review, one E2E cycle is cheaper than two;
(d) memory `feedback_never_squash_merge` — single coherent per-commit
story is preserved either way.

## Architect-split check (session-parser.ts ratchet)

User-content fingerprint detectors COULD be extracted to
`parsers/user-content.ts`, but they are not a load-bearing abstraction
— all called only by `parseOne case "user"`. The real architect-split
would be extracting **render-side accessors** (`assistantText`,
`userText`, `toolUses`, `toolResults`, etc., ~270 LOC), but that is
out-of-scope for this BUG fix and would balloon medium → large.

Accepting the +28 LOC ratchet on `session-parser.ts` (716 → 744) is
ADR-justified: discriminated-union expansion is exactly the parser's
job; no control-flow growth. Re-review when file crosses 800 LOC.

## Out-of-scope (per spec)

- Stop-hook gate-specific styling (BLOAT GATE vs others) — one renderer
- pr-link deduplication
- New "Unknown event" cases not observed in the user's sample
- `useTaskTranscript` polling cadence
