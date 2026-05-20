# Mini-Plan: embedded-terminal-launcher

- **Run ID:** iterate-2026-05-03-embedded-terminal-launcher
- **Branch:** `iterate/embedded-terminal-launcher`
- **Base:** `main` (resolved via `git symbolic-ref refs/remotes/origin/HEAD`)
- **Type / Complexity:** feature / medium
- **5 internal commits, 1 PR at the end** — per the approved plan's "eine Iterate, ein Branch, fünf interne Commits."

## Approach (high-level)

Plan-D''-conform embedded terminal: webui hosts a **neutral shell** pty (`pwsh` / `bash` / `zsh`), never `claude` directly. Three new server modules under `server/src/terminal/`, two new client components under `client/src/components/terminal/` + `client/src/hooks/`. The Toggle-Tab in `TaskDetailPage` gates `Transcript` vs `Terminal` and persists the selection in `localStorage`. Image-paste is the keystone: a DOM `paste` listener (capture-phase) on the xterm container detects `image/*` ClipboardItems, POSTs the blob to `/api/terminal/:taskId/paste-image`, and the server `pty.write`s the saved file's absolute path into the buffer (Anthropic-CC-VS-Code-extension parity). Strg+V on text falls through to `socket.send({type:"data",payload:text})` so we keep regression-safe text paste.

## File-level changes (commit-mapped)

### Commit 1 — Foundation (server pty + WebSocket smoke)

| File | Action | Notes |
|---|---|---|
| `server/package.json` | edit deps | add `node-pty-prebuilt-multiarch ^0.7` (prebuilt binaries; falls back to `node-gyp` only on unknown arch — Windows-build-pain avoided), `@hono/node-ws ^0.4` (Hono WS adapter compatible with `@hono/node-server`). |
| `server/src/config.ts` | edit | add `SHIPWRIGHT_CLAUDE_PASTES_KEEP_LAST` (default `20`), `SHIPWRIGHT_PTY_SHELL_OVERRIDE` (test-only, default unset). Both via `getConfig()`. |
| `server/src/terminal/pty-manager.ts` | NEW (~180 LOC) | Pure module. Exports class `PtyManager` with `spawn(taskId, cwd) -> handle`, `write(taskId, data)`, `resize(taskId, cols, rows)`, `kill(taskId)`, `subscribe(taskId, listener) -> unsubscribe`, `attach(taskId) -> {role: "writer"\|"reader"}`. **Whitelist enforced**: only `pwsh\|powershell\.exe\|cmd\.exe\|bash\|zsh\|sh\|fish` may be the spawn target — unit-test asserts that `"claude"` throws `PtySpawnRejectedError`. Internal Map<taskId, PtyHandle> with refcount + last-writer ID. Lifecycle: `killAll()` for shutdown hook. **No** transcript persistence — pty output is fire-and-forget; persistence stays in Claude's JSONL (Plan-D'' rule). |
| `server/src/terminal/routes.ts` | NEW (~140 LOC) | `createTerminalRoutes(deps: { ptyManager, store })`. Endpoints: `GET /api/terminal/:taskId/ws` (WebSocket upgrade via `upgradeWebSocket` from `@hono/node-ws`), `POST /api/terminal/:taskId/spawn` (idempotent — first call spawns, subsequent calls return existing handle metadata), `POST /api/terminal/:taskId/close` (kill pty, return 204). Each handler resolves task via `store.getById(taskId)`, refuses unknown task with 404. Reuses existing `errorHandler` middleware. Image-paste lives in commit 4. |
| `server/src/index.ts` | edit | (a) construct `PtyManager` once after `sdkSessionsStore` is loaded; (b) `app.route("/", createTerminalRoutes({ ptyManager, store: sdkSessionsStore }))`; (c) call `injectWebSocket(server)` from `@hono/node-ws` after `serve(...)` to attach the WS handler to the underlying http.Server; (d) add `ptyManager.killAll()` to the existing `shutdown` + `process.on("exit")` chain. |
| `server/src/terminal/pty-manager.test.ts` | NEW (~120 LOC) | Vitest. Cases: spawn rejects non-shell binary, spawn returns handle, write+subscribe round-trip via stub pty (mocked `node-pty-prebuilt-multiarch.spawn`), resize forwards cols/rows, kill cleans up Map, killAll iterates, second `attach()` returns reader role, writer-disconnect promotes-or-kills (per chosen policy: pty stays alive, no auto-promote — fits AC-2). |

**Done-when**: `cd server && npm run typecheck` clean, `cd server && npm test` green, manual: `npm run dev` + a tiny WS client (test script) connects to `/api/terminal/<existing-taskId>/ws` and receives a shell prompt.

### Commit 2 — Client `<EmbeddedTerminal>` + WebSocket hook

| File | Action | Notes |
|---|---|---|
| `client/package.json` | edit deps | add `@xterm/xterm ^5.5`, `@xterm/addon-fit ^0.10`, `@xterm/addon-web-links ^0.11`. (xterm v5 uses scoped `@xterm/*` packages.) |
| `client/src/hooks/useTerminalSocket.ts` | NEW (~110 LOC) | Hook returning `{ status, send, subscribe, lastError, role }`. Opens `new WebSocket(\`ws://${location.host}/api/terminal/${taskId}/ws\`)`, dispatches incoming JSON to listeners, exposes `send(msg: { type: "data", payload } \| { type: "resize", cols, rows })`. Reconnect with exponential backoff, capped at 5 attempts. Closes socket in cleanup. |
| `client/src/components/terminal/EmbeddedTerminal.tsx` | NEW (~150 LOC) | Renders a div mounted as the xterm.js container. Mounts `Terminal` from `@xterm/xterm` + loads `FitAddon`, `WebLinksAddon`. Connects via `useTerminalSocket`. Listens to `data` events from socket → `term.write`. Listens to xterm's `onData` → `socket.send({type:"data", payload})`. ResizeObserver on container → `fitAddon.fit()` → `socket.send({type:"resize", cols, rows})`, throttled to 250 ms (≤4/sec). On unmount: `term.dispose()`. Theme: background bound to `getComputedStyle(document.body).getPropertyValue("--background")` once at mount. |
| `client/src/components/terminal/EmbeddedTerminal.test.tsx` | NEW (~60 LOC) | Vitest + @testing-library/react. Mocks `@xterm/xterm` to spy on `write`/`dispose`, mocks `useTerminalSocket`, asserts: incoming `data` reaches `term.write`, outgoing `term.onData` reaches `socket.send`, ResizeObserver triggers `fit()`. |

**Done-when**: standalone `__test_terminal__` route (or storybook page if exists; otherwise transient `/test-terminal` route gated behind `import.meta.env.DEV`) renders xterm with bidirectional data flow against the running server. Type-check clean.

### Commit 3 — TaskDetail integration (Toggle-Tab + Launch-Flow, no pre-fill)

| File | Action | Notes |
|---|---|---|
| `client/src/pages/TaskDetailPage.tsx` | edit | Center pane gains a `<Tabs>` from Radix wrapping `<Tabs.List>` + two `<Tabs.Content>`: `transcript` (existing `BubbleTranscript`) and `terminal` (new `<EmbeddedTerminal taskId={task.id} />`). Tab state lifted into a `useTabPersistence("webui:embedded-terminal-default-tab", "terminal")` hook (NEW: 25 LOC, in `client/src/hooks/useTabPersistence.ts`). |
| `client/src/components/external/TerminalLaunchButton.tsx` | edit | After `navigator.clipboard.writeText(command)` succeeds, call new `onLaunchSideEffect?.()` callback OR (preferred) dispatch `window.dispatchEvent(new CustomEvent("webui:launch-copied", { detail: { taskId } }))`. `TaskDetailPage` listens, sets `tab="terminal"`, then calls `terminalRef.current?.focus()`. **No** `pty.write` injection. |
| `client/src/hooks/useTabPersistence.ts` | NEW (~25 LOC) | Generic localStorage-backed `useState`-shaped hook with key + default. Writes through on change. |
| `client/src/pages/TaskDetailPage.test.tsx` | edit (or NEW if absent) | Adds case: tabs render, last selection persists across mount, `webui:launch-copied` event flips tab to `terminal`. |

**Done-when**: full happy-path on a real task — open detail → click `Launch` → tab flips to `Terminal` → cursor blinks in xterm → user manually types `Strg+V` (already in clipboard) → command appears → `Enter` → Claude runs and JSONL grows under `~/.claude/projects/...`. The `Transcript` tab still polls and shows the same conversation.

### Commit 4 — Image-paste + Cleanup + .gitignore toast

| File | Action | Notes |
|---|---|---|
| `server/src/terminal/image-paste.ts` | NEW (~110 LOC) | Pure module. `savePastedImage({ task, ptyManager, blob, mimeType })`: (a) resolve `task.cwd` (validate exists), (b) compute `target = path.join(task.cwd, ".claude-pastes")`, (c) `pathGuard(task.cwd, ".claude-pastes")` then `mkdirSync({recursive:true})`, (d) `realPathGuard` after mkdir, (e) write `img-${Date.now()}.png`, (f) call `pruneKeepLastN(target, getConfig().keepLastPastes)`, (g) return absolute path. Pure helper `pruneKeepLastN(dir, n)` exported for unit tests. **Mime-type whitelist**: `image/png\|image/jpeg\|image/webp\|image/gif`. Reject anything else with `400 unsupported_image_type`. **Size cap**: `≤8 MiB`. |
| `server/src/terminal/routes.ts` | edit | Add `POST /api/terminal/:taskId/paste-image` (parse multipart via `c.req.parseBody()`, expects field `image: File`, calls `savePastedImage`, on success calls `ptyManager.write(taskId, absolutePath + " ")` then returns `{ path: absolutePath, kept: <list of 20 newest filenames> }`). Add `POST /api/terminal/:taskId/append-gitignore` (idempotent — read `<task.cwd>/.gitignore` if exists, no-op if `.claude-pastes/` already present, else append `\n.claude-pastes/\n`; returns `204`). Both use `realPathGuard`. |
| `server/src/terminal/image-paste.test.ts` | NEW (~80 LOC) | Vitest. Cases: writes file with timestamped name; prune keeps N newest; rejects symlink-escaped cwd; mime-type whitelist; null-byte rejected; size cap honored. |
| `client/src/components/terminal/EmbeddedTerminal.tsx` | edit | Add `containerRef.addEventListener("paste", pasteHandler, { capture: true })` (cleanup in unmount). Handler: scan `clipboardData.items` for `image/*` first match → `ev.preventDefault()`, `await fetch("/api/terminal/<id>/paste-image", { method:"POST", body: FormData with blob })` (multipart). On 200: server already wrote path into pty buffer, nothing more to do client-side EXCEPT show toast. On image-success in a project where `.gitignore` lacks `.claude-pastes/` (server returns `gitignoreSuggestion: true` field): trigger toast (use existing toast primitive — `client/src/components/common/` has none yet, so add a minimal `<Toast>` if absent OR reuse a simple inline banner). If item NOT image: re-dispatch a synthetic clipboard event back to xterm OR fall through to xterm's default behavior (better: do NOT preventDefault on text — let xterm handle natively). |
| `server/src/terminal/routes.ts` | edit (paste-image) | Server-side gitignore-presence check happens during `paste-image` handler: read `<task.cwd>/.gitignore`, return `{path, gitignoreSuggestion: <bool>}`. Append-handler is separate. |
| `client/src/components/terminal/PasteToast.tsx` | NEW if no toast exists (~50 LOC) | Minimal banner shown on `gitignoreSuggestion: true`, with `Append` button calling `POST /append-gitignore` and an `X` dismiss. Else extend existing toast surface if found. |
| `server/src/config.ts` | already done in Commit 1 | (`SHIPWRIGHT_CLAUDE_PASTES_KEEP_LAST` already added.) |

**Done-when**: real image-paste flow on Windows works end-to-end; second paste creates `img-<ts2>.png`, 21st paste prunes the oldest; first paste in a project without gitignore entry surfaces toast → click `Append` → `.gitignore` modified.

### Commit 5 — Tests + Compliance + Docs

| File | Action | Notes |
|---|---|---|
| `client/e2e/36-embedded-terminal.spec.ts` | NEW | Playwright. Cases: (a) navigate to `/tasks/<id>`, toggle tab to `Terminal`, xterm canvas renders within 1 s; (b) keyboard-type a string, mock-server echoes back, xterm shows it; (c) Strg+V on stubbed text-clipboard echoes text into pty (server receives `{type:"data"}`); (d) Strg+V on stubbed image-clipboard hits `/paste-image` (route stubbed) and the pty receives the path string. Spec MUST not introduce any `chat-*` testid or `<textarea>` + send button (Spec 35 stays green). |
| `client/e2e/35-no-chat-panel.spec.ts` | verify-only | Re-run; must stay green. No edit. |
| `client/src/test/doc-sync.test.ts` | edit | Update file-map assertion to include the new files (`server/src/terminal/{pty-manager,routes,image-paste}.ts`, `client/src/components/terminal/EmbeddedTerminal.tsx`, `client/src/hooks/useTerminalSocket.ts`). |
| `CLAUDE.md` | edit | Update top of file: ADR-034 wording paragraph + add new ADR-067 line at bottom. (a) Architecture rule #1 → "Webui spawns no Claude process directly. Webui MAY host a neutral shell pane (xterm.js + node-pty); Claude execution within that pane stays user-initiated (User must press Strg+V then Enter)."; (b) DO-NOT regression guards gain entry #17 (Iterate 4 — ADR-067) "pty-manager spawn target MUST be a whitelisted shell binary; never `claude` directly. paste-image + append-gitignore endpoints MUST flow through `realPathGuard` on `task.cwd`. Mime-type whitelist + 8 MiB size cap on `paste-image` are non-negotiable."; (c) Structure section: add `server/src/terminal/`, `client/src/components/terminal/`, `client/src/hooks/useTerminalSocket.ts`. |
| `.shipwright/agent_docs/conventions.md` | edit | Add same ADR-034-amendment paragraph + new DO-NOT entry #17 (the file imports CLAUDE.md verbatim). Append `## Convention Updates` line `**ADR-067** (2026-05-03): Embedded terminal launcher with image-paste`. |
| `.shipwright/agent_docs/architecture.md` | edit | Update ASCII diagram (add `terminal/` cluster on server side + `EmbeddedTerminal` on client side). Update Data-Flow paragraph: add new write surface `<task.cwd>/.claude-pastes/img-*.png` + new endpoint family `/api/terminal/:taskId/{ws,spawn,close,paste-image,append-gitignore}`. New Architecture-Updates line `**ADR-067** (2026-05-03): Embedded terminal launcher`. |
| `.shipwright/planning/01-adopted/spec.md` | edit | Append FR-01.28 (Embedded terminal pty + WebSocket), FR-01.29 (Image-paste + .gitignore toast). Extend FR-01.10 + FR-01.02 ACs (per iterate spec). Append C-08 Constraint + QR-06 Quality Requirement. |
| `.shipwright/agent_docs/decision_log.md` | append | ADR-067 (written via `write_decision_log.py`). |
| `CHANGELOG-unreleased.d/Added/iterate-2026-05-03-embedded-terminal-launcher_001.md` | NEW (drop) | "Embedded xterm.js terminal in TaskDetail with WebSocket-bidirectional pty + Strg+V image-paste support, replacing external-terminal-only launches for Claude sessions." |

**Done-when**: full unit + Playwright run green; Spec 35 + Spec 36 both green; doc-sync test green; type-check clean for both halves.

## Test strategy

- **Unit** (Vitest, both halves): `pty-manager.test.ts` (whitelist, lifecycle, subscribe), `image-paste.test.ts` (write, prune, path-guard, mime, size cap), `EmbeddedTerminal.test.tsx` (render + WS data flow + ResizeObserver), tab-persistence test, paste-handler decision-tree test.
- **Integration**: server boot-to-WS-handshake smoke test (Vitest) — spin Hono app on ephemeral port, connect with `ws` lib, assert prompt arrives.
- **E2E** (Playwright): `36-embedded-terminal.spec.ts` per above. Spec 35 unchanged.
- **Performance Budget** (`/shipwright-test` Step 3.8 triggered by `touches_build`): Lighthouse on `dev_url` + bundle gate. xterm.js + addons add ~120 KB gz to client bundle — within budget.
- **Browser Verify** (mandatory on UI iterate): `/shipwright-preview` + manual happy-path on Windows: image-paste from Snipping Tool, .gitignore toast, multi-tab read-only.

## Alternative considered (per medium iterate requirement)

**Alt-1: Single-shot HTTP polling instead of WebSocket** — server keeps a buffer per pty, client polls `/api/terminal/:taskId/output?fromByte=k` at 100 ms cadence. Reuses existing polling architecture (no `@hono/node-ws` dep). **Rejected**: 100 ms is too laggy for keystroke echo (feels broken at >50 ms); 50 ms polling is wasteful. Proper bidirectional duplex is the only sane fit for an interactive shell. WebSocket is the established Web platform answer. The architecture rule "no SSE for transcript" was about a different problem (passive read of a JSONL file); WS for an active pty stream is not in conflict.

**Alt-2: Pre-fill via `pty.write(command)` at Launch instead of clipboard-only** — would shave one keystroke per launch. **Rejected**: explicitly chosen against in plan §"Begründung gegen Pre-Fill" — Strg+V keeps the user-initiated boundary explicit (Plan-D''-conform), preserves Warp-fallback (clipboard still has the command), and matches existing muscle memory. Documented as Phase-2 candidate if the extra Strg+V step proves annoying after weeks of use.

**Alt-3: VS Code extension instead of in-app embedded terminal** — would inherit official Anthropic-CC-VS-Code-extension's image-paste UX for free. **Rejected**: this iterate's whole premise is that the WebUI is the user's task-management surface. Forcing a VS-Code-only path would split the surface (kanban here, terminal there) and re-introduces the Surface-Wechsel pain that drove the plan in the first place. VS Code stays available as a parallel option (existing `.code-workspace` writer per ADR-059).

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `node-pty-prebuilt-multiarch` install fails on Windows | low | high | The package ships prebuilt binaries for Win/Mac/Linux x64 + arm64. Documented fallback in CLAUDE.md "Dev-server troubleshooting" section: if install fails → install VS Build Tools 2022 + Python 3 + retry with `npm install --build-from-source`. Decision deferred to actual Phase-1 install attempt. |
| `@hono/node-ws` API churn | low | medium | Pinned to `^0.4`. The adapter API surface is small (`upgradeWebSocket`, `injectWebSocket`); migration cost is ≤1 file if v0.5 ships incompatible changes. |
| xterm.js paste-event hijacks before our listener | medium | high | Solution: register listener with `{capture: true}` so it fires before xterm's. If still not enough, fall back to `attachCustomKeyEventHandler` for Ctrl+V detection + `navigator.clipboard.read()` async API (browsers grant clipboard-read on localhost without prompt). Validate during Phase 4. |
| Multi-tab race: two tabs both opening pty | medium | low | Server-side: `PtyManager.attach(taskId)` returns `{role: "writer"\|"reader"}`. Reader's outbound `data` messages dropped with optional warning frame. UX: small ribbon in EmbeddedTerminal when `role === "reader"`. Documented edge case; no auto-promotion. |
| WebSocket survives across hot-reload but pty does not | low | medium | Server `injectWebSocket` re-creates handler on tsx-watch reload; existing WS connections close cleanly. Client reconnect logic (5 attempts, exp-backoff) handles dev-loop. Documented. |
| Scope creep into "transcript-replay-into-xterm-on-attach" | medium | medium | Out of scope per spec. xterm shows fresh shell prompt on first connect; no JSONL replay. If user wants replay, switch to Transcript tab. |
| Spec 35 false-positive on xterm hidden helper textarea | low | high | xterm.js v5 renders a hidden `<textarea>` with `aria-label="Terminal input"` for accessibility. Spec 35's textarea check pattern: confirm it filters by `chat-*` testid or visible position. **If** Spec 35 flags it, narrow Spec 35's selector to exclude `[aria-label="Terminal input"]` rather than disable Spec 35 — change is additive, not weakening. Verify in Phase 5. |
| Image-paste blob size huge (full-screen 4K screenshot ~5–8 MiB) | low | low | 8 MiB cap is intentional. Larger requires user to crop first. Documented in `paste-image` 413 response. |
| Mime-type spoofing (e.g. text/plain claiming image/*) | low | low | Server reads first bytes; PNG/JPEG/WEBP/GIF magic-number sniff before write. Reject mismatch. |
| Path-guard on `<task.cwd>/.claude-pastes/` symlink-escape | low | high | Both `pathGuard` (string) AND `realPathGuard` (filesystem) called on the resolved target after `mkdirSync`. Test covers symlink hostile case. |
| New constraint C-08 (whitelist) bypassed by test override env | low | medium | `SHIPWRIGHT_PTY_SHELL_OVERRIDE` is documented as test-only and gated by `process.env.NODE_ENV === "test"` so production code paths cannot reach it. Unit test asserts the gate. |

## Dependency footprint

- **server (added):** `node-pty-prebuilt-multiarch` (~5 MB inc binaries), `@hono/node-ws` (~12 KB).
- **client (added):** `@xterm/xterm` (~250 KB raw, ~110 KB gz), `@xterm/addon-fit` (~3 KB gz), `@xterm/addon-web-links` (~5 KB gz). Total ~120 KB gz client overhead — bundle-budget acceptable.

## Open questions for build-time resolution

1. **Mime-type sniff library** — bring in `file-type` (~30 KB) or hand-write 8-byte magic number checks (PNG/JPEG/WEBP/GIF have well-known signatures)? Decision: hand-written sniff, ~20 LOC, no new dep.
2. **Toast primitive** — does the existing client already have one? Quick grep in Phase 4 → if yes reuse, if no add minimal `PasteToast` (the only consumer). Avoid `react-hot-toast` etc. (over-kill).
3. **Test seam for `node-pty`** — manual hand-rolled mock vs `vi.mock("node-pty-prebuilt-multiarch")` factory? Decision: factory mock for cleanliness; pty-manager's tests don't need a real binary.

## What is NOT in this mini-plan (out of scope reminder)

- No `Task.preferredLauncher` schema migration.
- No JSONL replay into xterm on attach.
- No second-tab "promote-to-writer" handoff.
- No PTY recording/replay storage.
- No telemetry.
- No Linux/macOS automated CI validation (manual smoke on those is acceptable; primary platform is Windows).
- No removal of the existing copy-command card (additive, not replacement).

## Post-External-Review Adjustments (2026-05-03)

External review (Gemini + GPT via openrouter, 18 findings — see `iterate-2026-05-03-embedded-terminal-launcher-external-review.json`) refines the implementation contract. Iterate spec carries the AC-level changes; the per-commit deltas below are the developer-facing layer.

### Commit 1 — Foundation deltas

- **`pty-manager.ts` API addendum:**
  - `attach(taskId, ws) -> {role}`: bind writer ownership to the WS conn identity; `detach(ws)` clears writer-slot synchronously on `close`/`error`. (F13)
  - Lifecycle: `lastConnectionClosed(taskId)` triggers `kill(taskId)`; 30-min idle timer (no read/write activity) is the safety ceiling. (F4)
  - Whitelist match basename-normalized (`path.basename().toLowerCase()` against `{pwsh, pwsh.exe, powershell, powershell.exe, cmd, cmd.exe, bash, zsh, sh, fish}`). Test cases: `/bin/zsh`, `C:\Program Files\PowerShell\7\pwsh.exe`, plain `cmd`, `$SHELL=/usr/bin/fish`. (F16)
  - Shell-quoter helper exported alongside: `quotePathForShell(absPath, shellKind: "pwsh"|"cmd"|"posix") -> string` — used by the paste-image flow in commit 4. (F2/F14)
- **`routes.ts` API addendum:**
  - `GET /api/terminal/:taskId/ws` is the authoritative ensure-or-create entrypoint. WS upgrade calls `ptyManager.spawn(...)` if no handle exists, else `attach(...)`. `POST /api/terminal/:taskId/spawn` is retained as idempotent prewarm. (F7)
  - WS upgrade rejects requests whose `Origin` header does not match the existing CORS whitelist (loopback `localhost` family). Same posture as the rest of the HTTP surface. (F12)
  - Backpressure: per-conn outbound buffer cap `1 MiB`; on saturation drop-oldest with single `{type:"backpressure",dropped:N}` warning frame; cap configurable via `SHIPWRIGHT_TERMINAL_WS_BUFFER_BYTES`. (F14)
- **`config.ts` additions:**
  - `SHIPWRIGHT_TERMINAL_WS_BUFFER_BYTES` (default `1048576` = 1 MiB)
  - `SHIPWRIGHT_TERMINAL_IDLE_TIMEOUT_MS` (default `1800000` = 30 min)
  - (already planned) `SHIPWRIGHT_CLAUDE_PASTES_KEEP_LAST` (default `20`)
  - (already planned, test-only) `SHIPWRIGHT_PTY_SHELL_OVERRIDE`
- **Tests:** add cases for backpressure drop-oldest, writer-owner clears on close, last-connection-close kills pty, idle-timeout trips kill, basename normalization, shell quoter for all three shell kinds.

### Commit 2 — Client mount deltas

- **`EmbeddedTerminal.tsx`:**
  - Add `import "@xterm/xterm/css/xterm.css";` at top. (F1/F16)
  - WebSocket URL: `const wsProto = location.protocol === "https:" ? "wss:" : "ws:"; new WebSocket(\`${wsProto}//${location.host}/api/terminal/${taskId}/ws\`)`. (F5)
  - Expose imperative `ready: boolean` via `useImperativeHandle` so parent can wait before focusing. (F8)
- **`useTerminalSocket.ts`:** track `socket.readyState === OPEN` AND `role !== null` to derive `ready`.

### Commit 3 — TaskDetail integration deltas

- **TaskDetailPage tabs:** use Radix `<Tabs.Content value="terminal" forceMount>` AND `<Tabs.Content value="transcript" forceMount>`; rely on `data-state="inactive"` CSS to hide. xterm + WS persist across toggles. Add unit test: tab toggle preserves xterm instance identity (mock `Terminal` constructor, assert called once across two toggles). (F3)
- **Lazy-load (perf):** wrap `EmbeddedTerminal` import in `React.lazy(() => import("@/components/terminal/EmbeddedTerminal"))` + `<Suspense fallback={...}>`; keeps xterm bundle out of the main chunk for users who never open a TaskDetail. (F6)
- **Launch-flow readiness handshake:** TaskDetailPage waits for `embeddedTerminalRef.current?.ready === true` before calling `.focus()`. If not ready, listen for next `ready: true` transition (single retry). (F8)

### Commit 4 — Image-paste deltas

- **`image-paste.ts`:**
  - Filename: `img-${Date.now()}-${randomBytes(4).toString("hex")}.png`. (F17a)
  - Prune: sort by parsed timestamp from filename (`Date.parse` on `img-<ts>-…` prefix); fs `mtime` is tiebreaker only. (F17b)
- **`routes.ts` paste-image:**
  - Pre-check `Content-Length`; if > `9 MiB` (1 MiB headroom over 8 MiB blob cap), respond `413 image_too_large` before `parseBody`. Mirrors `/actions-upload`. (F15)
  - After saving, look up the spawned shell kind from `ptyManager` for that `taskId`, call `quotePathForShell(absPath, shellKind)`, then `pty.write(quoted + " ")`. (F2/F14)
- **`routes.ts` append-gitignore:**
  - Resolve `<task.cwd>/.gitignore` via `pathGuard` THEN `realPathGuard` BEFORE read/write. Symlink whose target escapes `task.cwd` → 403 `gitignore_symlink_escape`. Missing `.gitignore` → 404 `gitignore_missing`. Toast in client triggers only when server's `paste-image` response carries `gitignoreSuggestion: true` (which itself requires `.gitignore` to exist + lack `.claude-pastes/` line). (F11)
- **EmbeddedTerminal paste-handler decision tree:**
  ```ts
  // Image-wins precedence (F10)
  // 1. find first item with type starting "image/"
  // 2. if image found: preventDefault, upload (multipart), return
  // 3. else if text item present: preventDefault, socket.send({type:"data", payload:text})  (F9)
  // 4. else: do nothing (preventDefault not called → fall through)
  ```
- **Drop `navigator.clipboard.read()` async-API fallback** entirely (was listed as Phase-4 fallback). The `paste` event in capture phase is the only supported path. (F20)

### Commit 5 — Tests + Compliance deltas

- Spec 36 cases gain: (a) tab-toggle preserves xterm instance, (b) launch-flow waits for ready before focus, (c) mixed-clipboard image-wins, (d) cwd-with-spaces round-trip via shell-quoting, (e) WS reconnect after disconnect re-uses existing pty (server-side handle persists; readiness handshake fires anew).
- ADR-067 documents:
  - WS upgrade as the authoritative pty creation path
  - Origin/CORS-based authorization posture (loopback-only) and explicitly notes that this is a relied-upon assumption for future remote-access designs (a future remote-access mode would require additional auth)
  - Shell-aware path quoting contract
  - Inactivity-ceiling lifecycle policy
