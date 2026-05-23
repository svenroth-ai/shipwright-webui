# Mini-Plan: terminal-selection-uxd

- **Run ID:** iterate-2026-05-23-terminal-selection-uxd
- **Spec:** `.shipwright/planning/iterate/2026-05-23-terminal-selection-uxd.md`

## Files to edit

| File | Change |
|---|---|
| `client/src/components/terminal/EmbeddedTerminal.tsx` | Add three Terminal options (`rightClickSelectsWord`, `macOptionClickForcesSelection`, `wordSeparator`); add `term.onSelectionChange` subscription that only updates `latestSelectionRef`; add native `mouseup` + `keyup` listeners on `term.element` that perform the actual `copyText()` call (preserves transient-user-activation), de-duplicated via `lastCopiedSelectionRef`; add `MutationObserver` + dismissable banner gated by `.enable-mouse-events` class on the xterm root element (initial state read synchronously). Banner close button uses `onMouseDown={ev => ev.preventDefault()}` so terminal focus is not lost. |
| `client/src/components/terminal/EmbeddedTerminal.test.tsx` | Extend the existing xterm mock to capture `onSelectionChange` callback + the Terminal-constructor arg (`vi.fn().mockImplementation((opts) => { capturedOpts = opts; ... })`); add a fake `term.element = document.createElement('div')` so the component can attach native listeners. Add four describe blocks: `terminal options — VS Code parity`, `copy-on-selection — debounce + dedup`, `mouse-mode banner`, `banner focus preservation`. |
| `client/e2e/flows/86-terminal-selection.spec.ts` | NEW. Boot dev stack (or use `BASE_URL`), create a task, focus the terminal, write benign text, drag-select via `page.mouse.down/move/up`, assert `term.getSelection()` returns non-empty AND `navigator.clipboard.readText()` matches it. |
| `client/playwright.config.ts` | Add `'clipboard-read', 'clipboard-write'` to context permissions if missing. |

## Files NOT edited (explicitly)

- `client/src/components/terminal/terminal-clipboard.ts` — keep the Ctrl+C/V chord logic intact (DO-NOT regression: existing AC4 of spec).
- `client/src/components/terminal/terminal-clipboard-handler.test.ts` — no change; key-event tests remain authoritative.
- `client/src/lib/clipboard.ts` — `copyText` already abstracts the secure-context vs `execCommand` decision; reuse as-is.
- `server/**` — no backend changes.
- `client/package.json` — no version bumps (ADR-097/098 exact-pin).
- All `~/.shipwright-webui/*.json` writers — no change.

## Implementation sequence (TDD)

1. **RED 1** — extend the existing mock in `EmbeddedTerminal.test.tsx`:
   - the Terminal-constructor argument is captured: `vi.fn().mockImplementation((opts) => { capturedTerminalOpts = opts; return { ...existingShape, element: document.createElement('div') } })`. A real DOM element on `term.element` is required because the component attaches native `mouseup` listeners to it.
   - register an `onSelectionChange` capture: `onSelectionChange: vi.fn((cb) => { selectionChangeHandler = cb; return { dispose: vi.fn() } })`.
2. **RED 2** — add `describe("terminal options — VS Code parity")` with one assertion per new option (`rightClickSelectsWord`, `macOptionClickForcesSelection`, `wordSeparator`); expect FAIL.
3. **RED 3** — add `describe("copy-on-selection — debounce + dedup")` covering:
   - 50 fires of `selectionChangeHandler()` with `mockSelection = "abc"` → `copyText` not called (debounce).
   - one `mouseup` on `term.element` after the fires → `copyText` called exactly once with `"abc"`.
   - a second `mouseup` with the same `mockSelection` → `copyText` NOT re-called (dedup).
   - one `mouseup` with empty selection → `copyText` NOT called.
   - Auto-copy on `mouseup` does NOT fire the `notify("copied")` pill (verified by the existing notice spy).
   Expect FAIL — listeners not yet attached.
4. **RED 4** — add `describe("mouse-mode banner")`:
   - terminal mounted, then `term.element.classList.add('enable-mouse-events')` → banner visible.
   - then `.remove(...)` → banner hidden.
   - dismiss button click → banner hidden.
   - `.remove(...)` then `.add(...)` (off→on transition) → banner re-renders.
   - terminal mounted with `.enable-mouse-events` ALREADY on the element → banner visible synchronously (initial-state sync read; uses `act()` to flush). Expect FAIL.
5. **RED 5** — add `describe("banner focus preservation")`:
   - banner close button's `onMouseDown` handler is registered with `preventDefault` invoked.
6. **GREEN 1** — add the three Terminal options to the constructor call in `EmbeddedTerminal.tsx`. Run vitest, confirm RED 2 passes.
7. **GREEN 2** — wire the selection→copy pipeline:
   - Add `latestSelectionRef` (ref) and `lastCopiedSelectionRef` (ref).
   - Register `term.onSelectionChange(() => { latestSelectionRef.current = term.getSelection(); })`. The handler ONLY updates the ref. Add the disposable to the existing disposables list.
   - After `term.open(container)`, attach a native `mouseup` listener on `term.element` (and `keyup` for Shift+Arrow keyboard-selection). The handler reads `latestSelectionRef.current`, trims it, and calls `void copyText(text)` only when text is non-empty AND `text !== lastCopiedSelectionRef.current`. On promise resolve set `lastCopiedSelectionRef.current = text`. On reject, silently no-op (do NOT surface a pill).
   - Use `addEventListener` with `{ capture: false }` so xterm's own listeners run first; remove both listeners in the unmount cleanup.
   - Run vitest, confirm RED 3 passes.
8. **GREEN 3** — wire the mouse-mode banner:
   - `useState<boolean>` for `mouseEventsActive` and `bannerDismissed`.
   - On `term.open(container)` completion: synchronously set `mouseEventsActive = term.element.classList.contains('enable-mouse-events')`.
   - Attach a `MutationObserver` watching `term.element` for `attributes` (`attributeFilter: ['class']`). On each fire, read `classList.contains('enable-mouse-events')` and call setters. When transitioning off→on, also reset `bannerDismissed` to false.
   - Render the banner JSX when `mouseEventsActive && !bannerDismissed` — absolute-positioned top-right, `border-sky-800 bg-[#0f1d2e] text-sky-300`, padding-x-2 py-1 rounded text-xs. Close `×` button has `onMouseDown={ev => ev.preventDefault()}` + `onClick={() => setBannerDismissed(true)}` + `aria-label="Hinweis schließen"`.
   - Dispose observer on unmount.
   - Run vitest, confirm RED 4 + RED 5 pass.
9. **REFACTOR** — read the entire diff. Confirm:
   - All new refs / state live with sibling refs / state (close to the existing clipboard-notice + reset-banner state).
   - Disposables array gets the new selection-change dispose AND the native-listener removal AND the observer.disconnect.
   - No dead code.
   - File still under reasonable size (1900 LOC pre-change; aim ≤ 2000 post-change — split-warning if larger).
10. **Run `tsc --noEmit`** on client; fix any type errors.
11. **Run oxlint** on client; fix any warnings introduced by the diff.
12. **Author E2E spec** `86-terminal-selection.spec.ts`.
13. **Run F0** — full client + server vitest + tsc; expect green.
14. **Run F0.5** — Playwright spec 36 via `surface_verification.py`.

## Alternative approach considered (and rejected)

**Alternative A: Selection-style overrides via `?selectionMode=line` toggle in the URL.**
Rejected: adds URL state surface for a feature that should be discoverable and auto-correct. VS Code's `wordSeparator` is config-driven (per-user setting), not URL-state. Our minimum-viable change is to match VS Code's defaults in code; a future iterate could surface this as a `~/.shipwright-webui/settings.json` field if users actually need to customise it.

**Alternative B: Detect mouse-mode by sniffing `pty.onData` for SGR sequences server-side, push state down through the WS `ready` envelope.**
Rejected: redundant. xterm.js already exposes mouse-mode state by toggling the `.enable-mouse-events` CSS class on its root element when DECSET 1000/1002/1003 fires. Reading that class via `MutationObserver` is the local, lossless signal. Wiring a parallel server signal would duplicate state and add WS protocol surface.

**Alternative C: Inject a CSS rule `.xterm.enable-mouse-events::before { content: "Shift+Drag…" }` to make the hint purely CSS.**
Rejected: not dismissable, not internationalisable, and pseudo-elements don't reliably overlay GPU-rendered canvas content on all browsers. JS + DOM badge is more controllable.

## Test strategy

- **Unit (vitest, client)**: 3 new describe blocks in `EmbeddedTerminal.test.tsx` covering the three GREEN steps above. Mock surface extension is the only structural change — the existing FakeWebSocket + DataTransfer shims are unchanged.
- **E2E (Playwright)**: 1 new spec exercising drag-select-to-clipboard in a non-mouse-mode shell. Uses the existing `window.__embeddedTerminal` dev hook (already present at `EmbeddedTerminal.tsx:1056`) for `term.getSelection()` introspection; uses `navigator.clipboard.readText()` for the clipboard assertion (with `'clipboard-read'` permission granted to the Playwright context).
- **Smoke**: re-run one existing terminal spec (e.g. `78-reattach-under-pty-load.spec.ts` or any existing terminal-touching spec) to confirm no regression. Captured under AC5.

## Risk mitigation

- **MutationObserver leak:** `useEffect` cleanup calls `observer.disconnect()`. Asserted via the existing mount/unmount mount-counter pattern + a teardown spy in the new banner test.
- **copy-on-selection on non-secure context:** `copyText` already falls back to `document.execCommand('copy')`; we silently swallow rejections (the existing Ctrl+C pill remains the authoritative success signal — duplicate notifications on every selection event would be noisy).
- **Banner blocking terminal interaction:** absolute-positioned, `pointer-events: auto` only on the badge itself + its dismiss button; surrounding pane retains click-through.
- **Word-separator string contains `\` — escape-fence:** the chosen string `" ()[]{}',\"\`|;:!?"` is the literal VS Code default. The TS source literal MUST escape the backslash and the backtick; the assertion in the unit test must match the same escaping.
