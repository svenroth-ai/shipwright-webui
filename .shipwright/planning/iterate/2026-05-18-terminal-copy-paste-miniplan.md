# Mini-Plan: terminal-copy-paste

- **Run ID:** iterate-2026-05-18-terminal-copy-paste
- **Complexity:** medium · **Risk flags:** none · **Cross-split:** no

## Approach

Register a single `term.attachCustomKeyEventHandler` on the xterm instance
(after `term.open(container)` in the mount effect). A pure classifier maps
the keyboard event to an intent; the handler applies xterm selection state
and either copies, pastes, shows a hint, or passes the key through to the
pty. Copy reuses the existing `lib/clipboard.copyText` (modern API →
`execCommand('copy')` fallback → works over Tailscale http). Paste reads
`navigator.clipboard` when available, else surfaces an inline hint.

**Paste fidelity (AC-8).** Pasted text is fed through `term.paste(text)`,
NOT a raw `socket.send`. `term.paste()` normalizes line endings and adds
bracketed-paste markers when the app enabled `ESC[?2004h` — without this a
multi-line prompt submits on its first line. `term.paste()` emits via
`term.onData`, which the existing handler already forwards to the socket.
The EXISTING DOM `paste` listener (right-click path) is changed the same
way: its text branch swaps `socket.send({type:"data",payload})` for
`term.paste(text)`. The image branch (FR-01.29 image-wins) is untouched.

`attachCustomKeyEventHandler` contract: return `false` suppresses xterm's
default handling; `true` lets xterm proceed. The classifier defaults every
non-handled key (and all `keypress`/`keyup` events) to passthrough so
normal terminal input is untouched.

Chord set = VS Code Windows-terminal parity: `Ctrl+C` (conditional) +
`Ctrl+Insert` for copy, `Ctrl+V` + `Shift+Insert` for paste. `Ctrl+Shift+C`
is NOT bound — it is Chrome's DevTools accelerator, not reliably
interceptable from a browser tab. All notices are English UI strings.

### Key-handler decision table (keydown only)

| Chord | Selection (non-empty)? | `ev.repeat`? | Action | return |
|---|---|---|---|---|
| `Ctrl+C` / `Ctrl+Insert` | yes | no | `preventDefault` → copy → clear selection on success + "Copied" | `false` |
| `Ctrl+C` / `Ctrl+Insert` | yes | yes | `preventDefault`, no-op (already copied) | `false` |
| `Ctrl+C` / `Ctrl+Insert` | no | — | passthrough (→ SIGINT for Ctrl+C; app sees Ctrl+Insert) | `true` |
| `Ctrl+V` / `Shift+Insert` | — | no | `preventDefault`+`stopPropagation` → read clipboard → `term.paste(text)`; clipboard unavailable → HTTPS hint; denied → "Paste failed" | `false` |
| `Ctrl+V` / `Shift+Insert` | — | yes | `preventDefault`, no-op (already pasted) | `false` |
| `Ctrl+Shift+C` / `Meta+*` / `Alt+*` / anything else / keyup / keypress | — | — | passthrough | `true` |

Chord detection uses `ev.key` (semantic — `c` / `v` / `Insert`), per
external review. Copy requires `ctrlKey && !shiftKey`; `Shift+Insert`
paste requires `shiftKey && !ctrlKey` — so `Shift+Insert` never matches
the `Ctrl+Insert` copy branch and `Ctrl+Shift+C` never matches copy.
`metaKey`/`altKey` set → always passthrough (macOS native, Claude Alt+V).

## Files

| File | Action |
|---|---|
| `client/src/components/terminal/terminal-clipboard.ts` | NEW — `classifyClipboardChord(ev)` pure fn; `readClipboardForPaste()` → `{ ok, text }` \| `{ ok:false, reason:"unavailable"\|"denied" }` |
| `client/src/components/terminal/terminal-clipboard.test.ts` | NEW — exhaustive chord-table unit tests + read-helper tests (mocked / absent `navigator.clipboard`) |
| `client/src/components/terminal/EmbeddedTerminal.tsx` | EDIT — register `attachCustomKeyEventHandler`; add `clipboardNotice` state + corner-pill render; **swap the DOM `paste` listener text branch from `socket.send` → `term.paste(text)`** |
| `client/src/components/terminal/EmbeddedTerminal.test.tsx` | EDIT — wiring tests: handler registered; copy path → `copyText`; non-secure paste path → notice; DOM-paste text branch → `term.paste` |
| `client/e2e/flows/terminal-copy-paste.spec.ts` | NEW — real-browser Playwright (clipboard perms granted) incl. multi-line paste-fidelity assertion |
| `.shipwright/planning/01-adopted/spec.md` | EDIT (main repo, gitignored) — FR-01.28 + FR-01.29 rows + `(E)` ACs |

## Work breakdown

1. RED: `terminal-clipboard.test.ts` — classifier + `readClipboardForPaste`.
2. GREEN: implement `terminal-clipboard.ts`.
3. Wire `attachCustomKeyEventHandler` into `EmbeddedTerminal.tsx`; add
   `clipboardNotice` state + pill render; route paste via `term.paste()`.
4. Swap the DOM `paste` listener text branch → `term.paste(text)` (AC-8).
5. Extend `EmbeddedTerminal.test.tsx` wiring tests.
6. Author + run `terminal-copy-paste.spec.ts` (E2E).
7. Update `spec.md` FR-01.28 + FR-01.29.

## Test strategy

- **Unit:** `classifyClipboardChord` is pure — exhaustive table incl. a
  negative assertion that `Ctrl+Shift+C` and `Shift+Insert` do NOT
  classify as copy, and that `keyup`/`keypress` are ignored.
  `readClipboardForPaste` with `navigator.clipboard` present (resolves) /
  absent / `readText` rejecting.
- **E2E (load-bearing — v0.8.2 false-positive lesson, conventions §Learnings):**
  real `page.keyboard.press` against Chromium with
  `context.grantPermissions(['clipboard-read','clipboard-write'])`.
  Drag-select → `Ctrl+C` → assert `navigator.clipboard.readText()`.
  `Ctrl+C`-no-selection → assert the shell still receives the interrupt.
  Plant clipboard text → `Ctrl+V` → assert it reaches the prompt.
  `dispatchEvent` on a fake textarea is explicitly NOT sufficient.
- **Paste fidelity (AC-8):** plant a multi-line string with a blank line
  between two sections; paste it; assert the full character count + the
  blank line arrive (no truncation, no first-line submit). Assert paste
  goes through `term.paste` (spy) so bracketed-paste markers are applied.

## Alternatives considered

- **Keep xterm's built-in `Ctrl+V`, add no interceptor** — rejected: it
  fails silently in non-secure contexts with no way to show the hint, and
  copy has no built-in at all.
- **Copy-on-select** — rejected by the user; clobbers the clipboard on
  every drag.
- **Edit `lib/clipboard.ts`** to add a paste-read helper — avoided to keep
  the blast radius off `src/lib/` (`touches_shared_infra`); the read
  helper lives in the co-located `terminal-clipboard.ts` instead.

## Risks

- `attachCustomKeyEventHandler` return-value: a wrong `false` breaks ALL
  terminal input. Mitigated — classifier defaults to passthrough; E2E
  types a full command to prove normal input survives.
- Right-click MUST stay on the browser's native context menu — a custom
  `contextmenu` paste would call `navigator.clipboard.readText()` and fail
  over Tailscale http. VS Code-for-Web only gets away with custom
  right-click because it is served over HTTPS. Do NOT override
  `contextmenu`.
- Stale `socket` closure inside the long-lived handler — mirror the
  existing `term.onData` socket-access pattern; verify during build.

## External Review resolution (openai + gemini via OpenRouter, --mode iterate)

Branch A — findings addressed in-design before build:

- **gemini HIGH (double-paste):** `Shift+Insert`/`Ctrl+V` natively fire a
  browser `paste` event. The key handler calls `ev.preventDefault()` +
  `ev.stopPropagation()` on the paste chord → cancels the native paste →
  exactly one `term.paste()`. Copy chord likewise `preventDefault()`s to
  suppress a native `copy` event. The DOM `paste` listener already
  `preventDefault`+`stopPropagation`s (capture phase) — only its payload
  call changes (`socket.send` → `term.paste`).
- **gemini HIGH (macOS):** classifier returns `passthrough` when
  `metaKey` (or `altKey`) is set — Cmd+C/Cmd+V get native browser
  handling (Cmd+V fires a real `paste` event → DOM listener). Alt+V
  (Claude TUI image-paste) is never intercepted.
- **gemini MED (sync execCommand):** verified `lib/clipboard.copyText` —
  in a non-secure context `navigator.clipboard` is *undefined*, so the
  `if` block is skipped and `execCommand('copy')` runs synchronously
  inside the keydown gesture. No `await` precedes it. No edit to
  clipboard.ts needed.
- **openai HIGH (handler lifecycle):** handler registered exactly once
  per xterm instance (in the mount effect, after `term.open()`); a fresh
  mount = a fresh Terminal = one registration. The handler needs no
  `socket` — paste routes via `term.paste()` → existing `onData` → socket
  — so the stale-socket closure risk does not apply.
- **openai MED (autorepeat):** held copy/paste chord — `ev.repeat` guard
  fires the action once. Held `Ctrl+C` with no selection still passes
  through (SIGINT spam preserved).
- **openai MED (clear-on-success only):** selection cleared ONLY after
  `copyText` resolves; preserved on failure so the user can retry. Also
  gives the gemini-LOW double-tap: 1st `Ctrl+C` copies+clears, 2nd has no
  selection → SIGINT.
- **openai MED (empty selection):** copy requires `hasSelection()` AND a
  non-whitespace `getSelection()`; else passthrough.
- **openai MED (Ctrl+Insert no-selection):** passthrough (return `true`),
  not swallow — apps that bind `Ctrl+Insert` still receive it.
- **openai MED (denied paste):** `readClipboardForPaste` →
  `unavailable` shows the HTTPS hint, `denied`/generic shows "Paste
  failed" — never silent.
- **openai MED (paste into disposed term):** `term.paste` guarded on
  `!disposedRef.current`.
- **openai LOW (notice timing):** single `clipboardNotice` state rendered
  as an absolute-positioned corner pill (NOT a banner-stack strip → no
  collision, no xterm reflow). "Copied" auto-dismisses 2.5s; errors/hint
  8s + manual ✕; a new notice replaces the prior.
- **openai LOW (no clipboard echo):** notices are fixed strings — never
  clipboard content or raw exception text.

Chord detection switched from `ev.code` to `ev.key` (openai MED #7) —
semantic key matches copy/paste user intent across layouts.
