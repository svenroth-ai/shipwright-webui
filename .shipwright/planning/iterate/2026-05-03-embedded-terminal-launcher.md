# Iterate Spec: embedded-terminal-launcher

- **Run ID:** iterate-2026-05-03-embedded-terminal-launcher
- **Type:** feature
- **Complexity:** medium
- **Status:** draft
- **Source plan (contract):** `~/.claude/plans/du-bist-ein-experte-wild-prism.md` (Pfad C, approved)

## Goal

Replace the current "copy-command → switch to Warp → paste → run" launch loop with an embedded xterm.js terminal inside `TaskDetailPage`, so that (a) Claude-CLI sessions can be driven without leaving the WebUI and (b) clipboard image-paste works (Strg+V on a Clipboard-Image stores a PNG under `<task.cwd>/.claude-pastes/img-<ts>.png` and types its absolute path into the pty buffer). Solves [Anthropic claude-code Issue #51244](https://github.com/anthropics/claude-code/issues/51244) eigenständig im Wrapper. Plan-D''-conform: webui spawns a **neutral shell**, not Claude — Claude execution within the pane stays user-initiated (User must press Strg+V then Enter).

## Acceptance Criteria

- [ ] **AC-1 (Foundation):** `POST /api/terminal/:taskId/spawn` (or WebSocket upgrade at `/api/terminal/:taskId/ws`) opens a pty bound to the task's `cwd` using `node-pty-prebuilt-multiarch`. Default shell on Windows: `pwsh` → fallback `powershell.exe` → fallback `cmd.exe`; macOS/Linux: `$SHELL` or `/bin/bash`. Lifecycle: kill on server shutdown (always); kill on task close (default, configurable later).
- [ ] **AC-2 (WebSocket bidi):** Server streams pty stdout/stderr to the client over a WebSocket; client→server messages of shape `{type:"data",payload:string}` or `{type:"resize",cols,rows}` are pipelined to `pty.write` / `pty.resize`. UTF-8 safe, backpressure-aware (no unbounded buffering). Single-flight per task: first connection is writer, subsequent connections are read-only with `{type:"second-attach"}` notice.
- [ ] **AC-3 (Client EmbeddedTerminal):** `<EmbeddedTerminal taskId>` mounts xterm.js with `xterm-addon-fit` + `xterm-addon-web-links`. Connects via `useTerminalSocket` hook, calls `fit()` on container resize (ResizeObserver), forwards data both directions, renders prompt visible within ≤500 ms of mount.
- [ ] **AC-4 (TaskDetail Toggle-Tab):** TaskDetailPage gains a `Transcript / Terminal` toggle in the center pane. Selection is persisted globally in `localStorage["webui:embedded-terminal-default-tab"]` (`"terminal"|"transcript"`), default `"terminal"` on first use. Switching tabs does NOT remount the pty (only display); the WebSocket stays open.
- [ ] **AC-5 (Launch Flow without pre-fill):** Click on the task's launch CTA performs three actions atomically: (1) `navigator.clipboard.writeText(command)`, (2) toggle switches to `Terminal`, (3) xterm.js receives focus. **No** `pty.write(command)` — User triggers paste via Strg+V (handled by AC-7) and presses Enter.
- [ ] **AC-6 (Image-Paste — Strg+V on Clipboard-Image):** A DOM `paste` listener on the xterm container inspects `ClipboardEvent.clipboardData.items`. If any item has `type` starting with `"image/"`, the listener `preventDefault()`s the xterm-default text-paste, POSTs the blob to `POST /api/terminal/:taskId/paste-image` (multipart/form-data), receives the absolute path, and the server `pty.write`s that path into the buffer (followed by a single space). User then types the prompt and presses Enter.
- [ ] **AC-6a (Text-Paste regression):** Strg+V with text-only clipboard MUST still work — listener falls through to `socket.send({type:"data",payload:text})` after the image-detection branch. Validated by unit test on the paste-handler decision tree.
- [ ] **AC-7 (Cleanup — Keep-Last-N):** On every paste-image save, the server (a) creates `<task.cwd>/.claude-pastes/` if missing, (b) writes `img-<unix-ts>.png`, (c) lists `.claude-pastes/img-*.png`, sorts by mtime descending, keeps the `MAX_KEEP_PASTES` newest (default `20`, configurable via `SHIPWRIGHT_CLAUDE_PASTES_KEEP_LAST` env var) and `unlink`s the rest. Disk-footprint deterministic; no background-job, no boot-sweep.
- [ ] **AC-8 (.gitignore Toast):** First image-paste in a project where `.gitignore` exists but does NOT contain `.claude-pastes/` triggers a frontend toast `Add ".claude-pastes/" to .gitignore?` with an `Append` button. Click → `POST /api/terminal/:taskId/append-gitignore` appends a single line `.claude-pastes/` (newline-terminated) and returns 204. Idempotent: server pre-checks if line is already present and no-ops.
- [ ] **AC-9 (Plan-D'' compliance):** webui MUST NOT spawn `claude` directly via the pty. `pty-manager` whitelists shell binaries (`pwsh|powershell|powershell.exe|cmd|cmd.exe|bash|zsh|sh|fish`); a unit test fails if `claude` (or any non-shell) is configured as the spawn target. Spec 35 (`35-no-chat-panel.spec.ts`) MUST stay green — no `chat-*` testid is introduced; no `<textarea>` plus send-button pattern.
- [ ] **AC-10 (Path-guard for paste-image + .gitignore endpoints):** Both endpoints reuse `core/path-guard.ts` (`realpath + path.relative`, NOT `startsWith`) on the resolved `task.cwd` to refuse traversal/symlink-escape and null-byte input. New write surface (`<task.cwd>/.claude-pastes/`) is documented in `architecture.md` Data-Flow section.
- [ ] **AC-11 (Resize):** Browser-resize triggers xterm `fit()` → `socket.send({type:"resize",cols,rows})` → server `pty.resize(cols, rows)` so Claude renders correctly. Throttled to ≤4 resize messages/second to avoid wire-flood.
- [ ] **AC-12 (Spec 36 Playwright happy-path):** new `client/e2e/36-embedded-terminal.spec.ts` covers: (a) Toggle-Tab renders xterm canvas, (b) WebSocket connects (mock pty), (c) Strg+V on text clipboard echoes the text into the pty, (d) Strg+V on image clipboard hits `/paste-image` and the pty receives the path string. Spec 35 stays unchanged and green.

## Affected FRs

The following FRs are added or extended in `01-adopted/spec.md`:

- **FR-01.28 (NEW):** Embedded terminal — pty lifecycle + WebSocket bidi (`/api/terminal/:taskId/ws`, `/api/terminal/:taskId/spawn`, `/api/terminal/:taskId/close`).
- **FR-01.29 (NEW):** Image-paste — `POST /api/terminal/:taskId/paste-image`, `POST /api/terminal/:taskId/append-gitignore`. Includes Keep-Last-N cleanup invariant + path-guard contract.
- **FR-01.10 (EXTEND):** add Acceptance Criterion `(E)`: "Given the user clicks the launch CTA in TaskDetail, when the embedded-terminal Toggle-Tab is the active surface, then the command is copied to the clipboard, the Terminal tab gains focus, and the xterm canvas receives keyboard focus — but the command is NOT written into the pty (user-initiated Strg+V remains the trigger; Plan-D''-conform)."
- **FR-01.02 (EXTEND):** add Acceptance Criterion `(E)`: "Given a TaskDetail mounts, when the user toggles between `Transcript` and `Terminal`, then the selection is persisted globally in `localStorage["webui:embedded-terminal-default-tab"]` and the underlying terminal WebSocket is NOT torn down across the toggle (display-only switch)."
- **C-08 (NEW Constraint):** `pty-manager` MUST whitelist shell binaries (no `claude`/foreign exec); `paste-image` and `append-gitignore` endpoints MUST flow through `realPathGuard`. Violation = build failure via unit test.
- **QR-06 (NEW Quality Requirement):** Spec 36 (`client/e2e/36-embedded-terminal.spec.ts`) MUST stay green — embedded-terminal happy-path regression fence for ADR-067.

## Out of Scope

- **No pre-fill via `pty.write(command)`** at Launch (deferred to Phase-2 follow-up if Strg+V step proves annoying — explicitly captured in plan).
- **No `Task.preferredLauncher` schema migration** (current design assumes embedded-terminal is the surface; `sdk-sessions.json` schema unchanged).
- **No multi-tab "promote-to-writer" handoff** — second tab stays read-only; if user wants to type, they close the first tab. UX edge case acknowledged.
- **No automatic restart on Claude-CLI exit** — pty stays alive at shell prompt; user re-runs `claude --resume` themselves if they want.
- **No replacement of the existing copy-command card** — it stays available for users who prefer Warp; embedded-terminal is additive.
- **No node-pty Linux/macOS validation in this iterate** — primary target is Windows (developer's platform); `node-pty-prebuilt-multiarch` provides binaries but visual regression tests run only on Windows here.
- **No telemetry/analytics on pty usage.**
- **No PTY recording / replay** (would duplicate JSONL transcript).

## Design Notes

UI is a center-pane Toggle-Tab inside `TaskDetailPage`, replacing nothing — it sits next to the existing `BubbleTranscript` panel via tab switch. Visual style: minimal, inherits monospace from xterm.js theme; chrome (toolbar-less) follows existing `TaskDetail` pattern. Affected mockup files: none (no design-screen mockup pre-exists; the pattern reuses the established `TaskDetailThreePane` 3-pane layout — middle pane gets a tab strip).

Design tokens: monospace font from xterm.js default; background uses existing `--background` CSS var; toggle-tab uses Radix `<Tabs>` (already in deps). Transition between tabs is a simple display switch — no animation (xterm.js performance reasons).

Deviations from visual guidelines: none anticipated. xterm.js own theme overrides are limited to background-color binding to the active CSS var.

Components affected:
- **NEW:** `client/src/components/terminal/EmbeddedTerminal.tsx`, `client/src/hooks/useTerminalSocket.ts`.
- **MODIFIED:** `client/src/pages/TaskDetailPage.tsx` — Toggle-Tab + Launch-Flow side-effect; `client/src/components/external/TerminalLaunchButton.tsx` — Launch-Flow integration (Auto-Copy + Tab-Switch + Focus, no pre-fill).
- **NEW (server):** `server/src/terminal/pty-manager.ts`, `server/src/terminal/routes.ts`, `server/src/terminal/image-paste.ts`.
- **MODIFIED (server):** `server/src/index.ts` (mount terminal-routes + WebSocket upgrade), `server/src/config.ts` (add `SHIPWRIGHT_CLAUDE_PASTES_KEEP_LAST` env, default 20).

## Architecture impact (preview)

A new domain `server/src/terminal/` introduces the first WebSocket surface in this codebase (via `@hono/node-ws`). New writes appear under `<task.cwd>/.claude-pastes/img-*.png` — added to architecture.md Data-Flow paragraph as a write surface. ADR-067 documents the decision; ADR-034 wording is amended (additive rule: "Webui MAY host a neutral shell pane; Claude execution within that pane remains user-initiated").

## Post-External-Review Adjustments (2026-05-03)

External review (Gemini + GPT via openrouter, 18 findings — see `iterate-2026-05-03-embedded-terminal-launcher-external-review.json`) surfaced a set of HIGH-severity gaps that must be hard-bound into the ACs before build. These are folded in below; the mini-plan's commit-mapped file changes carry the corresponding implementation detail.

### Tightened / added Acceptance Criteria

- **AC-2 (refined — single creation path):** `GET /api/terminal/:taskId/ws` is the **authoritative** lifecycle entrypoint: WebSocket-upgrade ensure-or-creates the pty atomically. `POST /api/terminal/:taskId/spawn` is retained ONLY as an idempotent prewarm (returns the existing handle if one exists; never creates a duplicate). Eliminates the dual-creation race surfaced by external review F7.
- **AC-2a (NEW — backpressure):** Each WS connection has a per-connection outbound buffer cap of `1 MiB` (configurable via `SHIPWRIGHT_TERMINAL_WS_BUFFER_BYTES`); on saturation the policy is `drop-oldest` chunks with a single warning frame to the client (`{type:"backpressure",dropped:N}`). Server uses `WebSocket.bufferedAmount` to throttle. (External review F14.)
- **AC-2b (NEW — single-writer ownership):** Writer ownership is bound to the live WS connection identity, not a long-lived ID. On WS `close` or `error` the writer-slot is cleared synchronously so the next attach in any tab becomes the new writer. (External review F13.)
- **AC-2c (NEW — pty lifecycle):** PTY is killed when the **last** WebSocket connection closes (no active reader OR writer). Defensive ceiling: 30-minute inactivity timer (no read from pty AND no write into pty) forces kill regardless. (External review F4.)
- **AC-2d (NEW — auth/origin):** WS upgrade rejects connections whose `Origin` header is not in the existing CORS whitelist (loopback `localhost` family). Same posture as the rest of the loopback-only HTTP surface — no new auth model is introduced. Documented in ADR-067 as a relied-upon assumption. (External review F12.)
- **AC-3 (refined — mount strategy):** `<EmbeddedTerminal>` is mounted unconditionally inside `<Tabs.Content value="terminal" forceMount>`; tab inactivation uses CSS `data-state="inactive" → display: none` (or equivalent). The xterm instance + WebSocket persist across tab toggles. Verified by a unit test `tab toggle preserves xterm instance identity`. (External review F3.)
- **AC-3a (NEW — readiness handshake):** `<EmbeddedTerminal>` exposes a `ready: boolean` state (term mounted AND socket open AND role assigned). The Launch-Flow side-effect (AC-5) waits for `ready === true` before calling `term.focus()`; if not yet ready, retries on next `ready` transition (single retry, no busy-loop). (External review F8.)
- **AC-3b (NEW — xterm CSS):** EmbeddedTerminal imports `@xterm/xterm/css/xterm.css` (or via global stylesheet). Without it the cursor + canvas sizing is broken. Verified manually + in browser-verify smoke. (External review F1, F16.)
- **AC-3c (NEW — protocol inference):** WebSocket URL uses `location.protocol === "https:" ? "wss:" : "ws:"` so the same code works behind the (currently nonexistent) HTTPS reverse-proxy without mixed-content blocks. (External review F5.)
- **AC-6 (refined — image-wins precedence):** When `clipboardData.items` contains BOTH text AND image items (typical from Snipping Tool), the handler picks the FIRST `image/*` item, `preventDefault()`s, and uploads. Text in the same payload is **dropped** intentionally — image-wins is documented UX. Asserted by test case "mixed clipboard ⇒ image path; text dropped" in `EmbeddedTerminal.test.tsx`. (External review F10.)
- **AC-6a (refined — text-paste consistency):** Strg+V with text-only clipboard ALWAYS goes through `preventDefault()` + `socket.send({type:"data", payload: text})` — never through xterm's native paste. Single, predictable code path; tested in unit + E2E. (External review F9.)
- **AC-6b (NEW — shell-aware path quoting):** When the server `pty.write`s the saved image path into the buffer, the path is wrapped in shell-appropriate quotes. The chosen target shell determines the escaping: `pwsh`/`powershell.exe` → single-quoted with `''` doubling; `cmd.exe` → double-quoted; `bash`/`zsh`/`sh`/`fish` → single-quoted with `'\''` escaping. Trailing single space appended. Test cases: cwd `C:\My Project\` round-trips correctly on each shell; embedded `'` and `"` survive intact. (External review F2, F14.)
- **AC-6c (NEW — image filename uniqueness):** Saved files use `img-<unix-ms>-<8-hex-char-random>.png` to avoid collision under rapid pastes within the same millisecond. (External review F17a.)
- **AC-6d (NEW — image multipart cap):** Server pre-checks `Content-Length`; if > `9 MiB` (1 MiB headroom over the 8 MiB blob cap), respond `413 image_too_large` BEFORE buffering. Mirrors the existing `/actions-upload` pattern. (External review F15.)
- **AC-7 (refined — prune tiebreaker):** Sort key is **parsed timestamp from filename** (`Date.parse` on the `img-<ts>-…` prefix); fs `mtime` is fallback only. Avoids non-determinism on filesystems with low mtime resolution. (External review F17b.)
- **AC-8 (refined — symlink-safe gitignore):** `POST /api/terminal/:taskId/append-gitignore` resolves `<task.cwd>/.gitignore`, then runs `realPathGuard(task.cwd, resolvedPath)` BEFORE reading or writing. If `.gitignore` is itself a symlink whose target lands outside `task.cwd`, request fails 403 `gitignore_symlink_escape`. If `.gitignore` does not exist at all, request fails `404 gitignore_missing` (toast triggers only when the file exists). (External review F11.)
- **AC-9 (refined — shell whitelist):** Whitelist match is **basename-normalized** (`path.basename(target).toLowerCase()` against `{pwsh, powershell, powershell.exe, pwsh.exe, cmd, cmd.exe, bash, zsh, sh, fish}`). Tests cover absolute paths `/bin/zsh`, `C:\Program Files\PowerShell\7\pwsh.exe`, plain `cmd`, and `$SHELL=/usr/bin/fish`. (External review F16.)

### Adjusted out-of-scope

- The earlier "30-minute inactivity ceiling deferred" in the original out-of-scope list is **upgraded to in-scope** by AC-2c.
- `navigator.clipboard.read()` async-API fallback is **dropped from the design** (was listed as a Phase-4 fallback in the mini-plan): the primary `paste`-event path covers all target browsers; permission-prompt UX risk + reliability concerns of `clipboard.read()` outweigh the marginal coverage. Documented in mini-plan risks.

### Observations not folded (intentional)

- **F18 (global default-tab persistence may surprise existing Transcript-first workflows):** plan's chosen behavior is intentional. Spec 36 includes a regression case asserting that a user CAN flip the default back to Transcript and the choice survives.
- **F19 (theme-change drift):** noted as out-of-scope; the project has no dynamic theme switcher. Will revisit only if one lands.

## Post-Build Deviations (2026-05-03 — discovered during build / external code review)

A second external review pass at `--mode code` (Gemini + GPT via openrouter, run **after** the 5-phase build was complete and committed) surfaced 12 additional findings. The HIGH-severity ones were folded into a Phase-6 post-review fix commit. Three findings were resolved as documentation deviations rather than code changes — captured here for audit clarity:

1. **`@lydell/node-pty` instead of the spec-named `node-pty-prebuilt-multiarch`.** The plan listed `node-pty-prebuilt-multiarch ^0.10` (chosen for prebuilt-binary coverage). The actual install on Node 22.17 / win32-x64 / npm 10 failed with a deterministic `EINVAL spawn` from prebuild-install at `scripts/install.js:11` — the package's prebuild manifest lacks Node 22 win32-x64 binaries. Switched to `@lydell/node-pty@^1.1.0` (api-compatible: same `spawn(file, args, options) → IPty` shape; same `onData / onExit / write / resize / kill` surface). Native binary verified end-to-end: `pty.spawn(cmd.exe)` round-trips bytes back through `onData` on Windows. Rationale: the contract was "prebuilt binaries on Win/Mac/Linux"; @lydell/node-pty meets the contract via per-platform optionalDependencies (`@lydell/node-pty-{win32,darwin,linux}-{x64,arm64}`). Memory entry `feedback_no_dual_runtime_for_shipwright` does not apply (this is a pty backend swap, not a runtime substitution). The whitelist + injection seam in `pty-manager.ts` are unchanged — only the spawn-factory backing the `PtySpawnFn` is the new package.

2. **Spec 73 (`73-embedded-terminal.spec.ts`) instead of Spec 36.** The plan named the new Playwright file `36-embedded-terminal.spec.ts`, but Spec 36 is already taken by `36-rename-title.spec.ts` (`36b-clipboard-name.spec.ts` is the same family). Renumbered to 73 — first free slot in the 70s family that holds the iterate-3 specs (70a–70i, 72). All references in `spec.md` QR-06, conventions.md, ADR-067, and CLAUDE.md updated to the new number. No semantic change.

3. **Backpressure: drop-while-saturated instead of drop-oldest.** Two reviewers (Gemini + GPT) flagged that the AC wording was "drop-oldest" but the implementation drops the new chunk while saturated. Strict drop-oldest requires a server-side drain hook from the WS adapter (`@hono/node-ws` does not expose one) plus a periodic `bufferedAmount`-poll loop to flush a queue. Drop-while-saturated achieves the same functional outcome (interactive pty data flows in stream order; the loss window is "during saturation") without the unbounded server-side buffer growth that drop-oldest could exhibit if drains stall. Documented in the `pty-manager.ts` backpressure helper docstring; AC-2a wording updated accordingly. Backpressure-callback fires once per saturation episode, with `droppedBytes` = the byte size of the chunk we refused (a per-episode accounting; the cumulative count is reset when the conn drains).

### Phase-6 fixes folded BEFORE merge (post-code-review)

- **F6 (CRITICAL):** `attach()` is now idempotent for same-conn re-attach. The original writer kept its role on every onMessage call — without this, the writer becomes "reader" on its first keystroke. Added non-mutating `getRole(taskId, conn)` and `hasActiveWriter(taskId)` helpers. Routes `onMessage` switched to `getRole`.
- **F4:** WS Origin gate now refuses null/missing Origin (was `return true`).
- **F2:** `/append-gitignore` checks file existence FIRST, then runs `realPathGuard` only if the file exists. Missing `.gitignore` → 404 (not 403).
- **F3:** `/paste-image` now refuses to drive the pty when no live writer is bound (`ptyManager.hasActiveWriter` gate). The file is still saved on disk; the pty.write step is the conditional.
- **F5:** Windows shell resolver now probes `pwsh.exe → powershell.exe → cmd.exe` via `where`, caches the result.
- **F8:** Reader-role attachers receive an explicit `{type:"second-attach"}` envelope in addition to the `{type:"ready",role:"reader"}` envelope.
- **F9:** Gitignore-suggestion toast stays open + surfaces `gitignore_missing` etc. structured errors when `/append-gitignore` returns non-OK. Was dismissing regardless.
- **F11:** Spec 73 gained a browser-level paste-event case dispatching a synthetic ClipboardEvent with image-+-text DataTransfer onto the xterm container, asserting the `/paste-image` POST is issued with the image FormData entry.
