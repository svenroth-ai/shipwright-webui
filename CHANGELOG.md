# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **Claude TUI flicker workaround + Resume button gating** (ADR-095 — campaign `headless-terminal-refactor`, Iterate G). Closes two user-reported UAT regressions after v0.10.0. (1) Cursor flicker during Claude TUI streaming output ("springt vorne und hinten des wortes der Cursor hin und her") — root cause is a widely-documented xterm.js 5.5.0 limitation (no DECSET 2026 / Synchronized Output support; tracked across Claude Code Issues #37283, #1913, #18084, JetBrains IJPL-204106, Wave Terminal #2787). Fix injects Anthropic's official workaround `CLAUDE_CODE_NO_FLICKER=1` into every pty spawned for the embedded terminal — Claude Code renders into the alt-screen buffer (vim/htop-style), bypassing per-frame ANSI cursor moves. Default-on; opt-out via `SHIPWRIGHT_TERMINAL_NO_FLICKER=0`. New `buildSpawnEnv` helper in `server/src/terminal/routes.ts` factors the env-construction logic out of `createNodePtySpawnFn` for testability; opt-out wins over caller-supplied override (external code-review fix). (2) Resume button visible even while Claude TUI was actively running ("der Resume knopf kopiert dann den Resume text in das Terminal, aber das brauchen wir gar nicht"). Fix surfaces `liveSession: boolean` on task-state responses (computed at response-time from `PtyManager.get(taskId)`, NOT persisted) and gates the header Resume CTA on it: when `state="idle" && liveSession === true`, the CTA is hidden — the user types directly into the live shell. Resume reappears when state=done / launch_failed / jsonl_missing or when pty exits. xterm.js 6.0 upgrade deferred to a future Iterate H (breaking-change + ADR-088 snapshot pin invalidation). New tests: `server/src/terminal/pty-env-flicker.test.ts` (9 cases including opt-out-vs-caller-override regression fence), `server/src/external/routes.live-session.test.ts` (5 cases including flip-flop / response-time-computation), `server/src/config.test.ts` (+3), `client/src/components/external/TaskDetailHeader.test.tsx` (+3 including "consumption proof" regression fence). 927/927 server + 780/780 client green.
- **xterm.js client config Vorbild-Alignment** (ADR-093 — follow-on to ADR-092). Iterate E fixed the **re-attach** rendering path; the user reported a residual **in-session** rendering bug where Claude TUI's status pane redraws stack visually in the terminal (clears on navigate-away/back). Diagnostic comparison against the `siteboon/claudecodeui` reference repo surfaced four xterm.js client option differences. `client/src/components/terminal/EmbeddedTerminal.tsx` constructor updated: `convertEol: false → true` (load-bearing — Claude TUI's status pane redraw assumes CR-LF-normalised line endings), `allowProposedApi: false → true`, `scrollback: 5000 → 10000`, explicit `windowsMode: false` added. `@xterm/addon-webgl@^0.18.0` loaded with try/catch fallback after `term.open(container)` for atomic full-frame redraws (Canvas/DOM fallback for headless/WebGL-disabled envs). Theme palette (ADR-067) untouched; no server-side changes. Operator UAT post-merge validates the hypothesis; on falsification F.1 (auto-refresh push) / F.5 (architecture shift) open.
- **Live-pty replay across SPA navigation** (ADR-092 — closes ADR-091). Navigating away from a TaskDetail with an active embedded terminal and back no longer renders a blank terminal. Two new write surfaces in `PtyManager`: (1) `serializeMirrorIfLive(taskId)` returns an in-memory SnapshotRecord from the live `@xterm/headless` mirror — used by the WS attach replay path as the PRIMARY source (live wins over disk to avoid serving stale snapshots after last-detach flushes); (2) `flushMirrorSnapshot(taskId)` writes the live mirror to disk WITHOUT disposing it — fired from the WS detach handler when `attachCount` drops to 0, providing server-restart resilience. New `detachAndCount(taskId, conn)` collapses the detach + post-count read into a single atomic observation, closing a race surfaced by external code review. Regression guard at `client/e2e/flows/v0-9-6-live-pty-replay.spec.ts` (promoted from the D-bis probe) hard-asserts outcome A; 4-type live-pty matrix at `client/e2e/flows/v0-9-6-live-pty-matrix.spec.ts` covers new-plain / new-task / new-iterate / new-pipeline on local + tailscale. 21 new server-side unit + integration tests. WS protocol unchanged — same `replay_snapshot` envelope (ADR-089) carries the live-mirror serialize output.

## [v0.9.0] - 2026-05-10

### Added

- AC-5: structured awaiting-launch diagnostic logs (SHIPWRIGHT_DEBUG_AWAITING_LAUNCH=1) emit each polled subdir + match outcome from session-watcher.findByUuid; expected ≤30 s wall-clock band documented in known_issues.md.
- AC-6: FolderTree adds italic styling to ignored entries (in addition to muted opacity) for clearer visual distinction.
- AC-7: replay-only mode for terminal tasks in done/launch_failed state — WS upgrade skips pty.spawn() and renders a 'Session ended — viewing historical terminal scrollback only' banner instead of a live cursor.
- Spec 79 — v0.8.2 polish live-browser smoke (5 tests): AC-2 dark-theme background verified via xterm.viewport getComputedStyle; AC-4 paste-image wall-clock <1500 ms against real Hono+fs; AC-7 done-state replay-only banner; AC-8 fresh-task disclosure-footer absence; AC-9 ready envelope schema (retentionDays + scrollbackDir + replayOnly + scrollbackBytes).
- VITE_HOST env var to opt the Vite dev server into non-loopback binding for multi-device access (Tailscale / LAN). Default stays loopback only — `VITE_HOST=true` binds 0.0.0.0 with allowedHosts unblocked, `VITE_HOST=<host|ip>` binds a specific interface. Hono backend port stays loopback (Vite proxies /api locally).
- **v0.8.7 AC-2** — Disk-scrollback now gains a single dim-grey ANSI marker frame (`──── shell stopped at HH:MM:SS ────`) on every intentional pty kill (Stop terminal session menu, idle-ceiling, DELETE task, server SIGTERM). Provides a structured visual separator between historical "shell lifetimes" during replay-on-attach. Marker is appended INSIDE pty.onExit (after dying-process flush) with a closing-flag dedupe so duplicate kill calls produce exactly one marker.
- **v0.8.7 AC-3** — Replay-time collapse of repeated PowerShell-startup banner bursts via the new `ScrollbackStore.readForReplay()` method. Long-running tasks that accumulated many pty respawn cycles (each writing ~1.8 KB boilerplate to disk) now show ONE banner + a `── N earlier banners collapsed ──` marker per shell-lifetime span on replay. Disk file is unchanged — `read()` and `bytes()` stay raw so privacy-disclosure copy + `scrollback-meta` envelope size accounting remain accurate. Bounded regex (`[^\x07]{0,256}` for OSC, `[^\r\n>]{0,512}` for prompt) prevents ReDoS; cross-AC-2-marker collapse is forbidden so user content between bursts is preserved.
- **v0.8.7 AC-4** — EmbeddedTerminal renders a dim footer banner "Scrollback enthält N beendete Shell-Sessions" with a "Clear history" button when ≥2 of the AC-2 stop markers are present in the replay. Marker count derived from a replay-payload accumulator that survives ConPTY's startup screen-clear sequences (`\x1b[2J\x1b[H`); chunk-split markers are handled correctly across arbitrary WS frame fragmentation. Footer hides automatically after `clear-scrollback` succeeds (count resets on next replay).
- **v0.8.8 AC-3** — Boot-time PATH self-heal. When `resolveClaudeBin()` finds the binary via the AC-2 curated fallback (i.e., parent dir not on PATH), the server prepends that dir to `process.env.PATH` so subsequent child-process spawns (node-pty pwsh, preview-session-manager) inherit the augmented PATH. Detects the existing PATH key case-insensitively on Windows (`Path` vs `PATH`) and updates it in place. Idempotent: no-op when parent dir is already present (case-aware comparison + trailing-slash normalization).
- **v0.8.8 AC-4** — `/api/diagnostics` now includes a `claudeCli.diagnostic` block when `supported === false`, surfacing: `whereOutput` (raw `where`/`which` output), `pathSample` (first 8 PATH entries), `checkedFallbacks` (curated paths annotated with `(exists)` / `(missing)`), and `envOverride` (SHIPWRIGHT_CLAUDE_BIN status with annotation). Operators self-diagnose CLI-detection failures without reading the server log. Block omitted on the happy path (no UI noise).
- `server/src/test/no-cross-package-imports.test.ts` — comment-aware regex drift-guard rejecting `from "../../../client/..."` static imports (any depth, any intermediate path), dynamic `import(...)`, and multi-line `import \n from` splits. 8 vitest cases including 7 sanity sub-tests. Companion to existing `server/src/types/action-schema-sync.test.ts` content-parity test.
- `SHIPWRIGHT_NETWORK_PROFILE` env-flag (`local` | `tailscale` | `open`) — switches both Vite + Hono dev-server bind in one place via `.env.local`. Tailscale auto-detect via `tailscale ip -4` (2s timeout, env-override fallback). Profile=open emits AC-3-exact security warning at startup. ADR-081.
- `.env.example` — documents the network-profile flag with three uncomment-able blocks plus tailscale-IP override + legacy VITE_HOST/HONO_HOST escape hatch.

### Changed

- AC-4: image-paste latency reduced on Windows by parallelising fs.stat / unlink inside pruneKeepLastN and running prune + gitignore-read concurrently in savePastedImage; SHIPWRIGHT_DEBUG_PASTE_TIMING gates structured timing logs.
- AC-6: pasted-image dir migrated from <task.cwd>/.claude-pastes/ to <task.cwd>/.shipwright-webui/pastes/ (forward-only — existing files stay); .gitignore suggestion now appends .shipwright-webui/ and accepts the legacy line as already-covering.
- AC-8: privacy disclosure footer now renders only when the server reports scrollbackBytes > 0 for the current task; fresh tasks with no persisted scrollback no longer show it.
- AC-9: privacy disclosure copy now interpolates the actual retention TTL (SHIPWRIGHT_TERMINAL_SCROLLBACK_TTL_DAYS) and resolved scrollback dir from the WS ready envelope; new follow-up scrollback-meta envelope carries the precise byte count without delaying the auto-launch handshake.
- AC-6 follow-up: FolderTree footer toggle renamed from 'Hide ignored entries' to 'Show ignored entries' with inverted binding (per-project storage flag unchanged). Default behavior identical — checkbox now reads positively per spec wording.
- Hono backend now binds to 127.0.0.1 (loopback) by default. Set HONO_HOST=true (or <host|ip>) to bind on a non-loopback interface for direct API access. This is a breaking change vs. <=v0.8.3 implicit `::` bind; the typical Vite-proxy-to-localhost workflow is unaffected.
- Embedded terminal canvas now has 8px outer padding (`p-2 rounded-md`) so it no longer hugs the tab-panel edge; privacy disclosure footer inset to `bottom-2 left-2 right-2 rounded-md border` to match. xterm's `FitAddon` resizes to the padded inner box automatically.
- Privacy disclosure footer copy now mentions Claude Code's TUI image-paste path (`~/.claude/image-cache/<sessionId>/`) so users understand the path-of-record split between WebUI's shell-prompt path (`<task.cwd>/.shipwright-webui/pastes/`) and Claude Code's own clipboard pipeline. Long-form documentation in `.shipwright/agent_docs/known_issues.md` § "Image-paste path-of-record".
- **v0.8.7** — `createExternalRoutes()` now requires `ptyManager: { get(taskId) }` as an explicit constructor argument (was implicitly assumed). Construction throws if missing or invalid (TypeScript-required + runtime guard, per external code review). Existing test setups updated; production callsite in `index.ts` passes the singleton. AC-1 state-machine integration depends on this wiring.
- **v0.8.8 AC-2** — `resolveClaudeBin()` now uses a 3-step lookup chain: (1) `SHIPWRIGHT_CLAUDE_BIN` env override (loud reject if path is missing), (2) primary `where claude` / `which claude` with INFO-line filtering + existsSync verification (fixes `where`'s STDOUT INFO-banner false-positive on Windows), (3) curated install-path fallback per platform (Windows: `~/.local/bin/{claude.exe,claude.cmd}`, npm-global, winget shim, Program Files; POSIX: `~/.local/bin`, `~/.npm-global/bin`, `/usr/local/bin`, `/opt/homebrew/bin`). Closes the empirically-observed gap where the Hono server's `process.env.PATH` didn't include the claude install dir even though the binary was present on disk.
- Server `tsconfig.json` + `vitest.config.ts` — dropped unused `@shared/*` path alias pointing into `client/src/types` (latent footgun; nothing in `server/src/**` consumed it).
- Vite `/api` proxy target now follows the resolved Hono bind (was hardcoded `localhost:3847`) — closes ECONNREFUSED gap when Hono binds non-loopback under `tailscale` profile. Proxy uses 127.0.0.1 even when bind is 0.0.0.0 (wildcard not routable as HTTP destination).

### Removed

- Removed the v0.8.3 Ctrl+V image-paste interceptor (`attachCustomKeyEventHandler` + `clipboard-paste.ts` + Spec 80 e2e). It never produced a reliable round-trip in the user's daily flow; Alt+V via Claude Code's TUI clipboard pipeline (lands under `~/.claude/image-cache/<sessionId>/`) is the supported image-paste path. The DOM `paste` event listener (right-click → Paste menu) remains as defense-in-depth.
- Removed the "Terminal" header CTA on `awaiting_external_start` / `active` tasks. The button only flipped to the inline Terminal Tabs.Trigger that already lives inside the page — duplicate UX. Header CTA matrix is now: `draft` → Launch, `idle` → Resume, all other states → no primary CTA (status badge only).
- Removed the brown "Terminal" CTA on TaskCard for `awaiting_external_start` / `active` states. The card body click already routes to the task detail page (which lands on the Terminal tab when persisted preference says so); the dedicated CTA duplicated that affordance. Card CTA matrix is now: `draft` → green Launch, `idle` → orange Resume, all other states → no CTA. Mirrors the v0.8.5 AC-6 cleanup at the TaskDetailHeader level.

### Fixed

- AC-1: Spec 74 modal flake — clear-history menu item drops preventDefault and opens the confirm modal in the next animation frame so the dropdown closes cleanly under Windows ConPTY (3 previously-flaky e2e tests now stable).
- AC-2: black-on-black input under Claude Code TUI eliminated by switching the embedded terminal to a dark theme (bg #1a1a1a / fg #f5f0eb) at session start; new WCAG-AA contrast unit tests guard the palette.
- AC-3: Ctrl+V image-paste parity with Alt+V — paste listener moved from the container to document capture phase so xterm's textarea-level handling can no longer pre-empt image-wins precedence.
- AC-8 follow-up: privacy disclosure footer null-handling — when scrollbackBytes is unknown (no ready/scrollback-meta envelope yet) the footer stays hidden instead of flickering. Caught during user review.
- Embedded terminal **Ctrl+V image-paste** now reaches our handler: xterm.js's Ctrl+V binding bypasses DOM ClipboardEvent and uses async `navigator.clipboard.readText()` — v0.8.2's document/capture-phase paste listener never fired. Replaced with `term.attachCustomKeyEventHandler` that suppresses xterm's default + drives `navigator.clipboard.read()` with image-wins precedence; image blobs upload to the same `/api/terminal/:taskId/paste-image` route as the right-click → Paste path. Firefox / non-secure-context falls through to xterm's text-only readText path unchanged.
- Embedded terminal over Tailscale / LAN no longer stays mute. The WS-upgrade Origin gate + HTTP CORS middleware now honor `HONO_HOST` (any non-empty value → accept any non-empty Origin) and a new `WEBUI_TRUSTED_ORIGINS` env var (comma-separated explicit allowlist; takes precedence over HONO_HOST). Default remains loopback-only — set one of the two env vars to widen. Boot log prints the resolved policy. Side-fix: stricter loopback matching (WHATWG-URL parsed `hostname` equality) closes a substring-attack lookalike gap in the previous `origin.includes("localhost")` check. Docs: guide §9.1.
- Embedded terminal: text/cursor now sits 8px inset from the dark canvas edge (single-layer `bg-[#1a1a1a] rounded-md p-2` wrapper instead of v0.8.3's outer-ring-only padding). Conditional banners (read-only / replay-only / about-to-run) span full wrapper width as a header strip on the dark frame.
- New-plain Claude tasks (no initial slash command) now transition `awaiting_external_start → active` the moment the WS upgrade succeeds, instead of waiting forever for a JSONL line that arrives only after the user's first message. Task badge matches user mental model "Claude is reachable in the terminal = active".
- Embedded terminal calls `term.clear()` before each scrollback replay so a future WS-reconnect path that hits the same xterm instance cannot stack a second copy of historical scrollback on top of the first. Defense-in-depth; for the typical fresh-mount-then-replay flow this is a visual no-op.
- Embedded terminal wrapper no longer carries rounded corners — square edges match the rest of the WebUI's chrome. Padding and dark-canvas behaviour from v0.8.5 unchanged.
- Embedded terminal "100 banner accumulation" on Task → Board → Task navigation is fixed. Root cause: ConPTY emits a SIGWINCH-driven READLINE redraw on every `pty.resize()` call even when dimensions are unchanged — each ~1 KiB of "version banner + prompt + input echo". With React 19 StrictMode mounting EmbeddedTerminal twice + initial-mount and active-tab `resize` calls per visit, 5-6 redundant redraws hit the same xterm buffer per visit. Server-side `PtyManager.resize` now dedupes no-op calls; client-side `EmbeddedTerminal` tracks last-sent (cols, rows) and skips redundant `resize` WS frames. Spec 82 e2e regression-fences the contract.
- **v0.8.7 AC-1** — `new-plain` tasks now transition `active → idle` when their pty is gone (idle-ceiling, server-restart, /close, DELETE cascade), unblocking the Resume CTA in TaskDetailHeader. Previously the badge stayed stuck on "active" indefinitely after pty teardown because the transcript-poll's `result.status === "missing"` early-return short-circuited before the existing `active → idle` transition could fire.
- **v0.8.8 AC-1** — Resume on `new-plain` tasks now emits a fresh `claude --session-id <uuid>` launch instead of `claude --resume <uuid>`. Closes the broken-Resume UX hole opened by v0.8.7 AC-1: when v0.8.7 unblocked the Resume CTA for new-plain tasks (idle-on-pty-gone), clicking it would type `--resume` into PowerShell, Claude would respond with "No conversation found" because new-plain tasks never write JSONL until the user's first TUI message. The fix preserves task identity (same session-uuid) while opening a fresh Claude TUI.
- Server `npm run build` now exits 0 — retired the 4 documented tsc baseline errors (cross-package type imports + missing `@types/proper-lockfile`) so `scripts/install-windows.ps1` step [3/4] runs clean. Shared shapes now mirrored under `server/src/types/`; comment-aware drift-guard test prevents regression. ADR-080.
- v0.8.9 — embedded-terminal replay-on-attach: live shell now renders at the TOP of the viewport. Previously the replayed scrollback (incl. separator banner) sat in xterm's active area and the live shell appeared at the bottom of the visible window. Fix: after replay_end, push replay into scrollback via term.rows × \r\n then \x1b[H to home the cursor. Replay history stays accessible by scrolling up. (ADR-079, FR-01.28 v0.8.9 AC-1, Spec 85)

## [v0.8.1] - 2026-05-06

### Fixed

- Embedded terminal scrollback no longer corrupts visual history on re-attach (AC-1). ScrollbackStore now strips cursor-control / repaint sequences before persistence while preserving SGR colors and text; legacy v0.8.0 scrollback files self-heal on first replay (no migration script needed). New e2e Spec 77 covers TUI-heavy replay fidelity.
- Embedded terminal no longer leaves a re-attached tab stuck as read-only under high pty-output volume (AC-3). pty-manager gains per-conn pause refcount + writer-stuck watchdog (drainage-based, capability-detected per-conn). New e2e Spec 78 reproduces the original UAT scenario.

## [v0.8.0] - 2026-05-05

### Added

- Embedded xterm.js terminal in TaskDetail with WebSocket-bidirectional pty + Strg+V image-paste support — replaces external-terminal-only launches for Claude sessions and closes the Claude-CLI clipboard-image gap (Anthropic Issue #51244). New Toggle-Tab in TaskDetailPage with localStorage-persisted choice, lazy-loaded EmbeddedTerminal, automatic tab-flip + focus on launch CTA, image-paste flow with Keep-Last-N retention under <task.cwd>/.claude-pastes/ and an optional .gitignore-suggestion toast (ADR-067).
- Embedded-terminal one-click auto-launch — clicking Launch in TaskDetailHeader now flips to the Terminal tab and writes the launch command directly into the embedded shell (zero clipboard interaction; ADR-068-A1)
- Disk-backed terminal scrollback persistence (24h TTL, configurable via SHIPWRIGHT_TERMINAL_SCROLLBACK_TTL_DAYS) — terminal history survives nav-away, page-reload, browser-restart, and OS-reboot; replay-on-attach via WS chunked envelopes (ADR-068-A1)
- TaskDetailHeader: 'Stop terminal session' + 'Clear terminal history' (with confirm-modal) menu items + 'About to run' preview disclosure + privacy footer note in Terminal pane (ADR-068-A1)

### Changed

- POST /api/terminal/:taskId/close semantics: now kills pty only — scrollback retained on disk; new POST /api/terminal/:taskId/clear-scrollback handles destructive history cleanup (Decision #18 — separate Stop vs Clear)

### Fixed

- Embedded terminal: post-code-review hardening — writer-conn now stays writer on subsequent messages (CRITICAL: would have broken xterm input in real browser testing); /append-gitignore correctly returns 404 when .gitignore is missing; /paste-image gates pty.write on a live writer; WS Origin gate refuses missing Origin; reader-role attachers receive explicit {type:'second-attach'} envelope; gitignore-suggestion toast stays open with structured error message when /append-gitignore fails; Spec 73 gains a browser-level paste-event case (synthetic image+text ClipboardEvent on xterm container) (ADR-067 phase 6).
- Embedded terminal Phase-6.1 — caught by integration smoke (1273 unit tests didn't): ESM require-not-defined error broke every WS upgrade in dev; Vite proxy was missing ws:true (embedded-terminal unreachable in npm run dev); TaskDetailHeader launch CTA didn't dispatch webui:launch-copied so the tab-flip never fired from the primary surface. Plus second-review hardening: task.cwd realpath-validated up front; paste-image auto-spawns pty + response carries ptyWritten; paste-image error toast surfaces upload failures; missing Content-Length now rejected (chunked-transfer cap bypass); empty-text paste preventDefault for predictable single-path. 12 Playwright tests green against the real stack (ADR-067 phase 6.1).
- Embedded terminal Phase-6.2 — caught only by user-side live smoke (1273 unit tests + 12 Playwright tests didn't): React StrictMode triple-WS race left the read-only banner stuck on fresh tasks (per-effect cancelled flag now isolates stale handlers); xterm white-on-beige (foreground bound to brand --color-text + 16 ANSI slots pinned to brand-readable values; Claude Code true-color downgraded via TERM=dumb + FORCE_COLOR=1 since supports-color overrides everything else on Windows); navigator.clipboard.writeText silently rejected during React re-render (textarea+execCommand fallback added to both launch surfaces). Plus auto-promote on writer detach so the StrictMode race resolves cleanly via {type:writer-promoted} envelope (ADR-067 phase 6.2).
- Embedded terminal Phase-3 review fold — 8 HIGH + 4 MEDIUM external-review findings: the prompt-readiness handshake hard-cap is now a CANCEL boundary (not permission to inject blindly); explicit `coord.cancelLaunch("timeout")` on expired pending entries surfaces a deterministic cancel-reason instead of silently returning; LaunchCoordinator unmount-cancel reverted (StrictMode dev mount→cleanup→mount loop was cancelling every dispatch); sessionStorage handover idempotent on StrictMode re-fire; reader-role attachers cancel pending launches with `role-not-writer` reason; pendingFocus retry-on-ready cleared after consumption (was sticky); WS connection lifecycle traced with stable connToken so subscribe/unsubscribe pairs survive reconnect; PtyManager.detach() no longer logs "no entry" on legitimate close (ADR-068-A1 phase 3).
- Embedded terminal Phase-5 review fold + Codex final-pass — separate "Stop terminal session" action (clean kill-pty) split from "Clear terminal history" (destructive scrollback wipe with confirm-modal) because the prior single action mixed two different intents; honest TTL disclosure copy ("default 24h, configurable via SHIPWRIGHT_TERMINAL_SCROLLBACK_TTL_DAYS") replaced vague "may be retained" wording; Terminal CTA in TaskDetailHeader is now a pure tab-flip on `active`/`awaiting_external_start` states (dispatches `webui:focus-terminal-tab` instead of writing the launch command — the pty is already running, no need to re-execute); AC-16 about-to-run preview banner shows the actual command bytes that will hit the pty before injection so the user has a clipboard-style visual gate; `paste-image` flow surfaces structured upload errors via toast instead of swallowing them silently (ADR-068-A1 phase 5 + Codex final-pass).
- Auto-launch from TaskCard / NewIssueModal now reaches the embedded terminal deterministically (post-finalization UAT-fold). Previously failed in roughly half of clicks: when a new WebSocket attached to an existing pty (StrictMode dev double-mount; or a genuine multi-tab handoff), the server emitted `ready{role:"reader"}` followed within ~5 ms by `writer-promoted` once the previous writer's close handler fired, but the client cancelled the pending launch immediately on the first reader signal — losing the launch before the promotion landed. `TaskDetailPage.handleTerminalReady` now defers the reader-cancel by a 1500 ms stability window; the cancel is cleared when the role flips to writer (the typical promotion case) and only fires when the role genuinely stays reader (real second-tab scenario). New `client/e2e/flows/76-autolaunch-reader-writer-race.spec.ts` regression guard drives all 3 previously-failing UAT flows × 3 repetitions and observes outcome via WebSocket frame capture (looks for `claude --session-id` in the data-frame stream).
- Cumulative auto-launch session fixes (post-finalization UAT-fold): (a) cold-pty prompt-readiness handshake gained a 1500 ms no-data grace path because Windows pwsh `$PROFILE` / oh-my-zsh / Starship cold starts can stay silent for 500–1500 ms — sometimes exceeding the prior 3 s hard cap; absolute cancel boundary raised to 15 s for worst-case profile init. (b) `actionId` persists across Save-to-Backlog launches: `POST /api/external/tasks` now accepts `actionId` in the body, and `sdk-sessions-store`'s loader preserves `actionId` / `phase` / `phaseLabel` / `description` / `autonomy` on disk-reload (was silently dropping all five). (c) `wantResume` default narrowed to `task.state === "active" || "idle"` (was `state !== "draft"`); `awaiting_external_start` / `launch_failed` / `jsonl_missing` no longer emit `claude --resume <uuid>` for sessions that never started. (d) pty survives WS detach — `pty-manager.detach()` no longer kills the pty when the last subscriber leaves; orphan GC now via 30 min idle ceiling + explicit user actions. (e) `EmbeddedTerminal` refs reset on `taskId` change so the prior task's "data seen" / "consumed token" state can't short-circuit the next task's prompt-readiness handshake. New `client/e2e/flows/75-launch-matrix-and-session-persistence.spec.ts` adds API-level launch-matrix coverage (4 direct-launch tests assert correct slash command per action-id, 4 backlog-launch tests assert `task.actionId` is recovered server-side, 1 session-persistence test verifies pty identity across WS detach/re-attach).
- Plain Claude (new-plain) tasks no longer show a phase pill on TaskCard, TaskList, or TaskDetailHeader. The `derivePhaseFromTitle` keyword fallback was firing on free-form chat titles (e.g. "build my prototype" → phase=build), but Plain Claude is a free chat scoped to the project's directory and has no phase by design. All three call-sites now early-return when `task.actionId === "new-plain"` (TaskList keeps the em-dash placeholder for stable column width).

## [v0.7.0] - 2026-05-02

### Added

- Auto-generate .code-workspace on POST /api/projects so projects open in VS Code with one double-click (terminal-in-editor layout).
- **Settings → Configure actions** now lists every registered project with a state badge (Custom / Bundled / Malformed) and lets you upload or reset `.webui/actions.json` directly from the UI. Files are validated against the actions schema (JSON-parse + `validateActionsSchema` + contract version + `command_template` placeholder dry-run) before they overwrite anything on disk; oversized payloads (>256 KB) are rejected via a `Content-Length` pre-check, and every write goes through the same `realpath + path.relative` traversal guard the rest of the file/tree routes use. Reset is enabled even when the on-disk file is malformed so you can recover without opening a terminal. The reset confirmation uses the same Radix dialog pattern as the rest of the WebUI.

### Changed

- Transcript layout: all system chips (system, custom-title, agent-name, permission-mode, slash-command, task-notification) now render left-aligned with the assistant bubbles instead of centered.

### Fixed

- Transcript flicker during slow scroll-up: useAutoScroll now suppresses programmatic re-pin for 250 ms after the last user scroll event, so 1 Hz polling ticks no longer yank the user back to the bottom while they are still within the near-bottom threshold.
- Background-task completion notifications (Claude Code v2.1.119+) now render as a centered status chip in the transcript instead of a right-aligned user bubble showing raw <task-notification> XML.
- Transcript scroll-up flicker on long sessions (>=200 visible events): virtualizer now keys row measurements to event identity and batches ResizeObserver updates per paint frame, so dynamic-height rows stop jerking the visible window during scroll.
- Eliminate slow scroll-up content cascade on long virtualized BubbleTranscript transcripts (200+ events). Per-row measurement sizes are persisted to localStorage per session and rehydrated on mount; on a cold cache, a one-frame warmup pass measures all visible rows before the user can scroll. Solves "Er zieht den Code nach" symptom (ADR-066, 5th attempt; ADR-063 + ADR-064 reverted, ADR-062 + ADR-065 preserved).
- Eliminate residual scroll-up flicker on tool-heavy virtualized transcripts by filtering null-rendering events (tool_result-only-and-all-folded user events; filename-less attachment events) out of the virtualizer's items list — closes the 4th attempt at this bug after ADR-062/063/064. (ADR-065)

## [0.6.0] - 2026-04-27

### Added

- **Multi-session pipeline integration (v2 run-config orchestrator).** WebUI now reads `shipwright_run_config.json` schemaVersion 2 from registered projects and renders one Master TaskCard per Run on the TaskBoard, grouped above the kanban columns. Each phase_task is shown with phase / splitId / status / sessionUuid; awaiting_launch tasks expose a green Continue button that copies the framework's launch command. A new "+ New ▾ → Continue Pipeline" entry surfaces when an in-progress run has at least one ready phase_task; the modal pre-populates from `readyToLaunchTasks[]` and supports parallel branches (per_split runs) via a radio list. Failure / needs_validation / complete / stale states render with copy-able `recover-phase-task` snippets. v1 run-configs and missing configs render the legacy flat task path unchanged. Continuation always funnels through one shared code path (`useContinuePipeline`) so every entry surface (Master CTA, dropdown menu, future TaskDetail header) stays consistent. Server-side launch verification re-reads run-config on every `phaseTaskRef` launch and rejects mismatched session-uuids / non-actionable status / unmet prerequisites — the client never dictates the resolved command.

## [0.5.0] - 2026-04-26

### Added
- feat(webui): support custom action ids from `.webui/actions.json` — user-defined slash skills (e.g. `/content-orchestrator`) can be wired into the "+ New ▾" menu without forking. NewIssueModal renders a new **generic mode** for custom ids: heading from `action.label`, subheading from `action.description`, no phase picker, no autonomy toggle, static command-preview hint. Server-side `actionId` allowlist relaxed; the actions catalog lookup is now the single source of truth (`unknown_action_id` 400 on miss). `ExternalTask.actionId` widened from a 4-id union to `string`.

### Changed
- build(webui): `install-windows.ps1` now runs `npm run build` in both `server/` and `client/` in step 3, and the generated VBS launcher invokes `node dist/index.js` instead of `tsx src/index.ts`. Single production-style runtime path on autostart, no TypeScript runtime in the hot loop, dev-only `tsx` stays out of the autostart artefact.

### Documentation
- docs(webui): `docs/guide.md` is now the source-of-truth user guide. Written for Shipwright users comfortable with Claude Code in VS Code but new to running a local web app — covers what the Command Center is and when to use it, the why-copy-paste rationale (max flexibility, no CLI/SDK lock-in, no surprise side effects, multi-tab by construction), recommended setup (Warp + Command Center next to your editor), step-by-step installation, daily workflow, custom actions, Windows autostart, and troubleshooting. README links to it as the quickstart's complement.

## [0.4.2] - 2026-04-26

### Fixed
- fix(webui): TaskList (Board view → List) Phase column actually renders the phase. Was hardcoded to `—` since 2026-04-22 with a stale "ADR-045 — deferred" comment. Now uses the same source-priority chain as TaskCard / TaskDetailHeader (server-persisted phase first, title-keyword fallback as last resort, em-dash when neither resolves). Visually identical chips across kanban + list.

## [0.4.1] - 2026-04-26

### Fixed
- fix(webui): phase persists across all launch paths — the launch handler now reads `actionId ?? task.actionId`, `phase ?? task.phase`, `phaseLabel ?? task.phaseLabel`, so subsequent launches via TaskCard / Resume / any path that doesn't carry the full action context re-use the values persisted at create time. Once set, always used.
- fix(webui): NewIssueModal can no longer submit before the actions catalog resolves. Fast typists previously could trigger a phase-less create when `useProjectActions` was still loading; submit is now gated on `projectActions` being present (and on `currentPhase` for new-task mode).
- fix(webui): phaseStyle.derivePhaseFromTitle uses word boundaries — `\b(?:design|ui|mockup)\b` no longer matches "ui" inside "webui" or "suite", which previously produced a bogus Design badge for adopt-titled tasks.
- feat(webui): phaseStyle.derivePhaseFromTitle gained an `adopt` branch with verb-inflection support (adopt, adopted, adopten, adopting, adopts). Explicitly excludes the noun form `adoption` because that signals different user intent.
- fix(webui): forgotten in v0.4.0 — server `ExternalTask.actionId` union now includes `"new-plain"`.

## [0.4.0] - 2026-04-25

### Added
- feat(webui): Plain Claude session button — a ghost-style icon-only button (Terminal) sits LEFT of the "+ New ▾" split-button. Click opens a slim NewIssueModal variant (Title + Description + Project context only — no Phase, no Autonomy, no Advanced) and creates a `claude --session-id <uuid> --name "<title>"` paste command that drops you straight into a chat scoped to the project's directory. No Shipwright skill, no slash command — just Claude in the right cwd.
- feat(webui): new bundled action `new-plain` in default-actions.json — uses the legacy `{task.description?}` placeholder so the substituter is untouched. The pasted command pre-seeds the description as Claude's first user message when present.

## [0.3.2] - 2026-04-25

### Fixed
- fix(webui): ProjectContextStrip no longer wraps "Creating in" + project name across two lines when Advanced parameters opens a vertical scrollbar (whitespace-nowrap + shrink-0 on each segment).
- fix(webui): project path now shows the last two segments (`…/03 Development/shipwright-webui`) instead of the `C:\Users\…` prefix — the end-of-path is the relevant identifier; full path remains in the hover tooltip.

## [0.3.1] - 2026-04-25

### Fixed
- fix(webui): Advanced parameter rows now align consistently — every field type (boolean, string, enum) uses the same fixed-width left slot for the checkbox, so labels line up regardless of param type. Required fields render an inline "Required" pill next to the label instead of a 60px-wide left gutter that mis-aligned the column.
- fix(webui): TaskCard now shows the phase badge for legacy tasks (launched before the phase-on-create wiring). The title-keyword fallback heuristic (extracted into `derivePhaseFromTitle()` and shared with TaskDetailHeader) keeps the kanban card in sync with the task detail. `data-phase-source="task"|"title-fallback"` exposes the provenance.

## [0.3.0] - 2026-04-25

### Added
- feat(webui): explicit enable-checkbox per Advanced parameter — optional string/enum params now have a left-side enable-checkbox; off → value disabled, on → pre-fills schema default for non-sensitive fields
- feat(webui): `phase.supports_autonomy` schema field gates the AutonomyToggle in Task mode — bundled markers on build/test/security
- feat(webui): auto-helpText "If omitted: schema default is X; skill may apply its own default." rendered for optional params without an explicit helpText
- feat(webui): inline empty-hint "Value empty — flag will not be emitted" makes skip-emit semantics visible without opening the live preview
- feat(webui): non-interactive "Required" badge replaces the disabled-checkbox affordance for required fields (better a11y per external review)
- feat(webui): `aria-describedby` chains enable-checkboxes to helpText for screen readers
- feat(webui): build.section gets a handful helpText pointing to the planning/-folder pattern

### Changed
- feat(webui): required parameters now render OUTSIDE the Advanced collapsible — generic over `required: true`
- feat(webui): Advanced count reflects only optional params (excludes required)
- feat(webui): `paramsToPreview` + `explicitParamEntries` signatures take `paramEnabled` — disabled fields no longer appear in the launch body or preview

### Fixed
- fix(webui): reset-form effect no longer fires on every React-Query refetch — user-typed values now survive background `actions.json` re-resolutions; same fix applied to the schemaKey-driven seed effect
- fix(webui): sensitive parameter values are cleared from in-memory state on toggle-OFF (audit hardening — was retained across re-toggles)

### Validator (breaking for misauthored configs)
- feat(webui): `boolean + required:true` is now a hard validator reject (`invalid_param_required`) — unrepresentable under opt-in semantics; bundled configs unaffected
- feat(webui): `phase.supports_autonomy` must be boolean when set (`invalid_phase_supports_autonomy`)

## [0.2.1] - 2026-04-25

### Fixed
- fix(webui): skill flags belong in initial-prompt, not as Claude CLI args
- fix(webui): opt-in Advanced parameters + initial-prompt preview

## [0.2.0] - 2026-04-25

### Added
- feat(webui): server-side CLI parameters resolution + validation
- feat(webui): NewIssueModal Advanced parameters section
- feat(webui): live CLI parameters in CommandPreviewPanel
