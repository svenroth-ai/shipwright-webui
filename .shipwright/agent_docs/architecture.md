# Architecture — shipwright-webui
<!-- shipwright:architecture v=2 last-sync=7dc6d4fa -->

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  USER TERMINAL (external) OR EMBEDDED-TERMINAL PANE (xterm.js)      │
│                                                                     │
│   $ claude --session-id <uuid> --name <title> --add-dir ...         │
│                       │                                             │
│                       ▼                                             │
│   ┌──────────────────────────────┐                                  │
│   │  Claude Code CLI             │                                  │
│   │   writes JSONL transcript    │                                  │
│   └──────────────────────────────┘                                  │
└──────────┬──────────────────────────────────────────────────────────┘
           │ writes
           ▼
   ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl
           ▲ reads (byte-range, stateless)
           │
┌──────────┴──────────────────────────────────────────────────────────┐
│  SHIPWRIGHT COMMAND CENTER (this repo)                              │
│                                                                     │
│  ┌────────────────────┐         ┌─────────────────────────────────┐ │
│  │ Vite (React 19)    │ ──/api──▶ Hono server (Node 20+)         │ │
│  │  :5173             │  proxy  │  :3847                          │ │
│  │                    │   WS    │                                 │ │
│  │  TaskBoardPage     │ ────────▶ external/ (registration shell)  │ │
│  │  TaskDetailPage    │         │  + 11 sub-routers:              │ │
│  │  ProjectsPage      │         │    tasks/  launch/  transcript/ │ │
│  │  InboxPage         │         │    inbox/  actions/ preview/    │ │
│  │  TriagePage        │         │    tree/   file/    run-config/ │ │
│  │  DiagnosticsPage   │         │    media/  pr-status/           │ │
│  │  SettingsPage      │         │  routes/{projects,settings,     │ │
│  │                    │         │         profiles,diagnostics,   │ │
│  │  TanStack Query +  │         │         triage}.ts              │ │
│  │  1 s polling       │         │                                 │ │
│  │  (no SSE)          │         │  terminal/ (WS pty pane)        │ │
│  │                    │         │   pty-manager.ts                │ │
│  │  Embedded terminal │         │   routes.ts (registers WS)      │ │
│  │  pane via WS       │ ◀───────▶ ws-upgrade-handler.ts           │ │
│  │  (xterm.js 6.0.0)  │         │   headless-mirror.ts            │ │
│  │                    │         │   snapshot-store.ts             │ │
│  └────────────────────┘         │   scrollback-store.ts           │ │
│                                 │   replay-snapshot.ts            │ │
│                                 │   image-paste.ts                │ │
│                                 │   boot-wipe.ts                  │ │
│                                 │   headless-probe.ts             │ │
│                                 │   terminal-reset.ts             │ │
│                                 │   ws-heartbeat.ts               │ │
│                                 │   idle-reaper.ts                │ │
│                                 │                                 │ │
│                                 │  core/                          │ │
│                                 │   launcher.ts                   │ │
│                                 │   session-{watcher,parser}.ts   │ │
│                                 │   inbox-derive.ts               │ │
│                                 │   sdk-sessions-store.ts (v1-v3) │ │
│                                 │   project-manager.ts            │ │
│                                 │   profile-loader.ts             │ │
│                                 │   run-config-reader.ts (RO)     │ │
│                                 │   project-actions-loader.ts     │ │
│                                 │   actions-substitute.ts         │ │
│                                 │   actions-schema-validator.ts   │ │
│                                 │   parameter-resolver.ts         │ │
│                                 │   preview-session-manager.ts    │ │
│                                 │   path-guard.ts (realpath)      │ │
│                                 │   gitignore-cache.ts            │ │
│                                 │   cli-compat.ts                 │ │
│                                 │   contract-version.ts           │ │
│                                 │   task-editability.ts           │ │
│                                 │   terminal-prompt-detect.ts     │ │
│                                 │   triage-{store,paths,write,    │ │
│                                 │            lock,enrich}.ts      │ │
│                                 │   campaign-{store,events,parse, │ │
│                                 │     paths,loop-state,write,…}.ts│ │
│                                 │  types/ (mirror of client/types │ │
│                                 │    — drift-guard via            │ │
│                                 │    no-cross-package-imports     │ │
│                                 │    + action-schema-sync; ADR-080)│ │
│                                 └───────┬─────────────────────────┘ │
└─────────────────────────────────────────┼───────────────────────────┘
                                          │ proper-lockfile guarded
                                          ▼
         ┌────────────────────────────────────────────────────┐
         │ ~/.shipwright-webui/                               │
         │   projects.json   sdk-sessions.json   settings.json│
         │   terminal-scrollback/<taskId>.{log,snapshot}      │
         └────────────────────────────────────────────────────┘
                                          │ read-only
                                          ▼
         <project.path>/shipwright_run_config.json (framework-owned)
         <project.path>/.shipwright/triage.jsonl    (producer-owned;
                                                     webui appends
                                                     status events)
         <project.path>/.shipwright/triage.outbox.jsonl (gitignored
                                                     per-tree buffer; webui
                                                     reads it in the union +
                                                     residence-writes flips)
         <project.path>/.shipwright-webui/actions.json         (user-editable)
         <project.path>/.shipwright-webui/pastes/   (image-paste cache)
```

## Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | react, react-dom, vite | — |
| Backend | @hono/node-server, hono, tsx | — |
| Database | — | — |
| Auth | — | — |
| Runtime | typescript | — |

## Layers Detected

- **docs**: `docs`, `project-docs`
- **infrastructure**: `scripts`


## Key Architecture Decisions

See `decision_log.md` for detailed ADRs. Profile-level decisions (stack, auth pattern, DB strategy, folder structure) are defined by the stack profile (`vite-hono`).

## Data Flow

Shipwright Command Center is a two-half local stack: a Hono backend on Node 20+ at `:3847` and a Vite-served React 19 frontend at `:5173`, communicating over a JSON HTTP API under `/api`. The Vite dev server proxies `/api` to the Hono port, so both halves run independently and refuse to silently half-start (Vite via `strictPort`, Hono via a bind-error handler).

The load-bearing architectural choice (ADR-034) is the external-launch model: the WebUI spawns no Claude process. Instead, on task creation the server pre-binds a `crypto.randomUUID()` session-id, and the launcher (`core/launcher.ts`) emits a copy-command for the user's shell (PowerShell, cmd.exe, or POSIX) carrying `--session-id <uuid> --name <title>`. The user pastes that command in their own terminal (or VS Code). The Claude CLI then writes its JSONL transcript at `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`, which the WebUI observes via `core/session-watcher.ts`. Discovery is filename-first (`<uuid>.jsonl`); first-line sessionId is a sanity check.

The transcript endpoint is stateless: clients pass `?fromByte=<offset>&expectFingerprint=<fp>` so multi-tab support works by construction. UTF-8-safe byte slicing cuts on linefeed boundaries only; EBUSY/EPERM/EACCES/ENOENT retry up to 6 attempts with exponential backoff. Client polling at 1 s replaces SSE — no chokidar, no heartbeat. The Inbox (`core/inbox-derive.ts`, cache key `(sessionUuid, mtimeMs, dismissedKey, contentLength)`) unifies three detection sources in `deriveSessionInbox()` with precedence `ask_tool > terminal_prompt > text_question`: (1) pending `tool_use` blocks in the JSONL; (2) `detectAwaitingUserQuestion()` — a plain-text question as the latest turn-ended assistant message (auto-clears on the next user turn, no persisted state); (3) `core/terminal-prompt-detect.ts extractTerminalPrompt` over the live `@xterm/headless` mirror (`PtyManager.peekTerminalText`, a post-pass outside the mtime cache) for a waiting `AskUserQuestion` picker that never reaches the JSONL (best-effort, live-mirror-only). Inbox cards pass `{ focusTerminal: true }` nav-state. Detail: decision_log ADR-113.

State lives in three files under `~/.shipwright-webui/`: `projects.json` (registry), `sdk-sessions.json` (task store, schemaVersion v1/v2/v3 with write-on-touch migration per ADR-038/044), and `settings.json`. All three are guarded by `proper-lockfile`; ELOCKED surfaces as HTTP 409. Stack profiles resolve in three steps (`SHIPWRIGHT_PROFILES_DIR` → `SHIPWRIGHT_MONOREPO_PATH/shared/profiles` → bundled `server/profiles/`).

Project configuration flows in via `<project>/.shipwright-webui/actions.json` (overlaying the bundled `default-actions.json`) and read-only consumption of `<project>/shipwright_run_config.json` (`core/run-config-reader.ts`). The WebUI never writes into `~/.claude/projects/` or `shipwright_run_config.json`; its only write surfaces are:

- `~/.shipwright-webui/{projects,sdk-sessions,settings}.json` — registry / task-store / settings, `proper-lockfile`-guarded (ELOCKED → 409).
- `<project>/.shipwright-webui/actions.json` — stub create + upload/reset (FR-01.27).
- `<project>/.shipwright-webui/<slug>.code-workspace` — idempotent VS Code bootstrap, POST `/api/projects` only (ADR-059).
- `PUT /api/external/projects/:projectId/file` — markdown-only project-file write: `.md`/`.markdown` allowlist, `realPathGuard`, content-hash `If-Match` (409 on drift), atomic tmp+rename (FR-01.35 / ADR-155).
- `<task.cwd>/.shipwright-webui/pastes/img-<unix-ms>-<hex>.<ext>` — embedded-terminal image paste (magic-byte sniff, 8 MiB cap, keep-last-N; ADR-067), plus an idempotent `.shipwright-webui/` append to `<task.cwd>/.gitignore` (a legacy `.claude-pastes/` line already counts as covering).
- `~/.shipwright-webui/terminal-scrollback/<taskId>.{log,snapshot}` — scrollback + cell-state snapshot, rotated at `SHIPWRIGHT_TERMINAL_SCROLLBACK_MAX_BYTES` (default 1 MiB); dir `0o700` / files `0o600` (POSIX only; Windows ignores); UUID-validated, realpath-at-op on `clear`/`rotate`, TTL daily sweep (≤100 groups, skips active tasks) (ADR-068-A1 / 087 / 088).
- Campaign lifecycle `status` `draft → active` flip via `core/campaign-write.ts setCampaignStatus` — `status.json` top-level `status` else `campaign.md` frontmatter, `.weblock` atomic; the ONLY webui write to campaign *state* (`campaign_init.py` / `campaign_progress.py` own the rest) (ADR-148 / FR-01.33).
- `${registryDir}/dismissed-campaigns.json` — webui-owned board dismiss/restore flag (`dismissed-campaigns-store.ts`), a quittance NOT a producer write (FR-01.33, PR #126).

Every write inside a project path flows through `realPathGuard` (symlink-escape refusal, null-byte reject); uploads add a `Content-Length` pre-check; the Preview spawn path uses `shell: false`; the pty-manager spawn target is whitelisted to shell binaries only (never `claude`) so embedded-terminal hosting stays Plan-D''-conform.

ADR-067 introduces the first WebSocket surface in the codebase: `GET /api/terminal/:taskId/ws` (via `@hono/node-ws`) is the authoritative ensure-or-create entrypoint for the per-task pty owned by `core/terminal/pty-manager.ts`. Writer ownership is bound to the live WS connection identity (cleared on close/error so a new attach can become writer); an **attachment-gated** idle ceiling (default 12 h via `SHIPWRIGHT_TERMINAL_IDLE_TIMEOUT_MS`) reaps the pty only when NO WS client is attached — armed on last-detach, disarmed on attach, so a session a user is watching is never reaped however long Claude waits (cohesive module `terminal/idle-reaper.ts`, iterate-2026-06-02); outbound is drop-while-saturated when `WebSocket.bufferedAmount` exceeds the configured cap. `POST /api/terminal/:taskId/spawn` is retained as an idempotent prewarm. The Origin gate matches the existing CORS loopback posture — adding any remote-access mode would require additional auth (explicit non-goal of this iterate).

Terminal WS replay evolved ADR-068-A1 → 088/089 → 087 (retired chunked-replay) → 092 (closed the live-pty re-attach regression). **Current flow:** on each `onOpen` the server pauses the pty, resolves the snapshot **live-mirror-first, disk-fallback** — `ptyManager.serializeMirrorIfLive(taskId)` (in-memory `@xterm/headless` mirror) else `snapshotStore.read(taskId)` (written by cleanup-time `finalizeMirrorSnapshot` or detach-time `flushMirrorSnapshot`) — emits exactly ONE `replay_snapshot` envelope `{data, cols, rows, terminalVersion}`, then resumes; the client writes it once via `term.reset()` + `term.write(data)` + `term.scrollToBottom()`. On last detach (`detachAndCount` → count 0) `flushMirrorSnapshot` persists to disk WITHOUT disposing the pty (server-restart resilience). No snapshot (missing / version-mismatch / `headless-probe.ts` import failure) ⇒ blank terminal + live shell (deliberate). Done / `launch_failed` tasks skip spawn+attach and get a `replayOnly` `ready` + snapshot + clean close ("Session ended" banner). Legacy chunked envelopes (`replay_start/chunk/separator/end`) are RETIRED; stale-server frames dropped client-side. Scrollback append is `fs.appendFileSync`; rotation is a 3-state machine (`p-queue`-serialized); a one-shot boot-wipe of legacy `*.log*` is marker-gated; `POST /clear-scrollback` and DELETE `/tasks/:id` (cascade-clears scrollback + snapshot — privacy) are the destructive paths. Auto-launch: `LaunchCoordinatorContext` dispatches a monotonic `launchToken`; `EmbeddedTerminal` sends `commands[shellKind]` plus a carriage return over the WS after a prompt-readiness handshake (250 ms quiesce, 3 s cap), cancelled on reader-role / unmount / 30 s. Detail: decision_log ADR-087/088/092/108/109.

Client-side, the virtualized BubbleTranscript persists per-row measurement sizes to `localStorage["webui.virtualizerCache.<sessionUuid>"]` (schemaVersion 1, JSON, capped at 1000 entries) so subsequent visits to a long session avoid the slow-scroll-up estimate-vs-measure cascade (ADR-066). Writes fire on `pagehide`, every 5 s, and React unmount; the cache is pruned to currently-active event keys before write and rehydrated on mount via TanStack Virtual's `initialMeasurementsCache`. On cold cache, a one-frame warmup raises `overscan` so all visible rows mount + measure before the user can scroll. This is browser-local state — no server involvement.

**Triage Tab** (read consumer + status-flip producer over `<project>/.shipwright/triage.jsonl`; ADR-101/106): five `/api/triage/*` endpoints (`counts`, `:projectId` list, `promote`/`dismiss`/`snooze`). The list view is a TS port of `shared/scripts/triage.py read_all_items` (last-status-wins, corrupt-line tolerant), Python-fixture-parity-gated; it reads the **union tracked ∪ gitignored `triage.outbox.jsonl`** and routes status flips residence-derived (ADR-166), annotating each item with `pendingDelivery` (ADR-169) + `campaignSlug`/`campaignStatus`. Promote is a cross-store transaction (`findByPromotedFromTriageId` idempotent retry + orphan-promote guard); a 5 s mtime cache fronts reads; per-project fault isolation via `Promise.allSettled`. **Fix now** copies the producer `launchPayload` (`stripControlChars` byte-port; ADR-116) to the clipboard — never a server launch (rule 1); **Start Campaign** performs the `draft → active` write above. Sidebar `Triage (N)` badge (orange) polls `counts` (30 s, backoff). All triage fields render as plain text (XSS-safe). Detail: decision_log ADR-101/106/116/166/169.

## See also

- [`README.md`](../../README.md) — quickstart, prerequisites, parallel-worktree setup, autostart on Windows
- [`docs/guide.md`](../../docs/guide.md) — full user-facing docs: installation, updates, autostart, custom actions, multi-session pipelines, Continue Pipeline UX, troubleshooting (718 lines)
- [`CLAUDE.md`](../../CLAUDE.md) — load-bearing project instructions; preserved by /shipwright-adopt. Architecture rules + DO-NOT regression guards now also live in `conventions.md`
- [`conventions.md`](conventions.md) — TS strict, file-size cap, render stack, regression guards, Conventional Commits
- [`decision_log.md`](decision_log.md) — full ADR catalogue (DEC-001 … ADR-170, plus carried-over h2 ADR-045b / 065 / 066); first 53 migrated from the pre-adopt root log, ADR-053 = adoption, the rest post-adoption. **SSoT for every ADR the Updates sections below point to.**
- [`component_inventory.md`](component_inventory.md) — React component inventory (refresh via `/shipwright-adopt`; current snapshot dated in the file header)
- [`design_tokens.md`](design_tokens.md) — raw Tailwind / CSS-var extraction
- [`../designs/visual-guidelines.md`](../designs/visual-guidelines.md) — canonical design tokens for `/shipwright-design` consumption (typography, colors, spacing, radius, shadows, component patterns)
- [`known_issues.md`](known_issues.md) — TODO/FIXME inventory (currently empty)

## Architecture Updates
_**One line per change, ≤600 chars** — always-loaded Layer-1 context; detail lives in the cited ADR (the SSoT — read it in `decision_log.md`), not here. Format: `- **<run_id|ADR-NNN>** (date) — one sentence.` Superseded entries stay (their context explains later ADRs); entries with no ADR number yet get one at the next `/shipwright-changelog` (spec under `planning/iterate/`)._
- **ADR-066** (2026-05-02) — persistent virtualizer measurement cache (`localStorage["webui.virtualizerCache.*"]`) + first-visit warmup.
- **ADR-067** (2026-05-03) — embedded terminal launcher (xterm.js + `@lydell/node-pty` + `@hono/node-ws`): new `server/src/terminal/` (`pty-manager`, `routes`, `image-paste`) + `EmbeddedTerminal.tsx` + `useTerminalSocket.ts`; first WS surface + image-paste write surface; ADR-034 amended (neutral shell pane, Claude stays user-initiated).
- **ADR-068-A1** (2026-05-04) — embedded-terminal auto-launch via WS data-frame + disk scrollback (`ScrollbackStore`, `LaunchCoordinatorContext`).
- **ADR-069** (2026-05-05, AC-1 retired by ADR-087) — writer-stuck watchdog + per-conn pause refcount (retained); scrollback ANSI sanitizer (retired).
- **ADR-080** (2026-05-09) — type-system isolation between workspaces: `server/src/types/` verbatim mirrors + `no-cross-package-imports.test.ts`; retires ADR-035's 4-baseline-error carve-out.
- **ADR-081** (2026-05-10) — `SHIPWRIGHT_NETWORK_PROFILE` (local|tailscale|open): `resolve{NetworkProfile,TailscaleIp,ProxyTarget}.ts` + Vite-proxy follower.
- **ADR-082** (2026-05-10) — `.env.local` wired into both dev-server processes.
- **ADR-084** (2026-05-11) — EmbeddedTerminal StrictMode mount-race fixes.
- **ADR-085** (2026-05-11) — Resume on idle new-plain converges to active.
- **ADR-086** (2026-05-11, retired by ADR-087) — skip disk-replay on attach for new-plain tasks.
- **ADR-088 / ADR-089** (2026-05-11) — server-side `@xterm/headless` mirror (`headless-mirror.ts`, `snapshot-store.ts`) behind a flag; single `replay_snapshot` WS envelope + default-on flip.
- **ADR-087** (2026-05-12) — cell-state snapshots become the SOLE replay primitive; `boot-wipe.ts`, `headless-probe.ts`; retires ADR-069/077/079/086 + chunked replay; failure mode = blank terminal + live shell.
- **ADR-091** (2026-05-12) — empirical confirm: a live pty loses state across SPA nav (test-only; closed by ADR-092).
- **ADR-092** (2026-05-12) — live-pty replay fix: `serializeMirrorIfLive` / `flushMirrorSnapshot` / `detachAndCount` (live-first, disk-fallback).
- **ADR-095** (2026-05-13, partly superseded by ADR-098) — `CLAUDE_CODE_NO_FLICKER=1` default + `withLiveSession` boundary helper.
- **ADR-096** (2026-05-13) — 60% snapshot-preservation heuristic in `finalizeMirrorSnapshot` (retained defense-in-depth).
- **ADR-097** (2026-05-13, partly superseded by ADR-098) — xterm.js 5.5→6.0 (exact-pin paired set) + snapshot envelope v2 + `windowsMode` removal.
- **ADR-098** (2026-05-13) — restore `CLAUDE_CODE_NO_FLICKER=1` default-on (Claude emits no DECSET 2026 in the main buffer; upstream #37283 open).
- **ADR-099** (2026-05-14, client superseded by ADR-108) — WebGL atlas-corruption workaround; server-side SGR re-emit retained in `replay-snapshot.ts`.
- **ADR-100** (2026-05-14) — `ExternalTask` 13-field leadwright extension (5 user-creatable / 8 daemon-owned); 409 `task_claimed`.
- **ADR-101** (2026-05-14) — WebUI Triage Tab + Promote bridge: `core/triage-{store,paths,write}.ts`, `routes/triage.ts`, `TriagePage`, `TriageBadge` (FR-01.30).
- **ADR-102** (2026-05-15) — Triage card/dialog restyle onto existing design tokens.
- **ADR-103** (2026-05-15) — close-task navigates back to the board.
- **ADR-104** (2026-05-15) — terminal reset banner via `terminalReset` on the WS `ready` envelope (smear half later corrected by ADR-109).
- **ADR-105** (2026-05-15) — TaskCard `ProjectPill` identity pill.
- **ADR-106** (2026-05-15) — Triage write 500 fix: `triage-lock.ts` disjoint `.weblock`; removed self-deadlocking double-lock.
- **ADR-107** (2026-05-15, planned, not implemented) — decouple the pty host from the Hono process (Option B).
- **ADR-108** (2026-05-16, supersedes ADR-099 client machinery) — client-side replay drain gate in `EmbeddedTerminal`.
- **ADR-109** (2026-05-16, supersedes ADR-093) — `convertEol:false` fixes Bug-B left-column smear; `embedded-terminal-convert-eol.test.ts`.
- **ADR-110** (2026-05-16) — remove the Resume-CTA activity gate; one-shot auto-inject guard + Copy-Resume; shared `lib/clipboard.ts`.
- **ADR-111** (2026-05-17) — remove orphaned Resume-CTA liveness-gate code (~419 LOC; retires Iterate M).
- **ADR-112** (2026-05-18) — Move-to-Backlog endpoint, In-Progress → `draft`; `taskLifecycle.ts` SSoT; `draft`-sticky transcript poller.
- **iterate-2026-05-18-edit-task-dialog** (2026-05-18) — Edit Task dialog (`EditTaskModal.tsx`); `taskEditability.ts` ↔ `task-editability.ts` parity; PATCH widened (4 launch-fields frozen once started).
- **ADR-113** (2026-05-18) — Inbox surfaces waiting terminal pickers (`core/terminal-prompt-detect.ts extractTerminalPrompt`) + focuses terminal on click.
- **ADR-114** (2026-05-18) — embedded-terminal keyboard copy/paste (`attachCustomKeyEventHandler`, `term.paste()`); co-located `terminal-clipboard.ts`.
- **ADR-115** (2026-05-19) — oxlint adopted as the linter; CORS test env-isolated via `vi.hoisted()`.
- **ADR-116** (2026-05-20) — Triage `launchPayload` rendering + Fix-now: `launchPayload.ts` (`stripControlChars` byte-port) + `LaunchPayloadBlock.tsx`.
- **ADR-117** (2026-05-21) — skip WS reconnect on clean close of a replay-only attach.
- **ADR-118** (2026-05-21) — Triage Fix-now opens `NewIssueModal` (lifted to TriagePage); 4 phase slashes namespaced `:skill`.
- **ADR-119** (2026-05-22) — Phase 0f compliance hygiene (slim 5 ADRs, arch marker, CLAUDE.md file-tree → summary).
- **ADR-120** (2026-05-22) — Hono SPA fallback to `client/dist/index.html` for non-`/api` GETs; `SHIPWRIGHT_STATIC_DIR` test seam.
- **ADR-121** (2026-05-22) — thread `projectId` through `FixNowIntent` → `NewIssueModal` (`initialProjectId`).
- **ADR-122** (2026-05-23) — VS Code-aligned terminal selection + copy-on-mouseup + mouse-mode banner.
- **ADR-123** (2026-05-23) — auto-focus xterm on Terminal tab activation (`setTimeout(0)` for Radix settle).
- **ADR-129** (2026-05-25) — one-finger pan-to-scroll in the embedded xterm.
- **ADR-124 / ADR-125 / ADR-126 / ADR-131 / ADR-133 + Campaign C non-ADR splits** (2026-05-26, Campaign C) — `InboxPage` (967→116), `EmbeddedTerminal` (1856→287), `BubbleTranscript` (1618→175), `NewIssueModal`, `TaskDetailHeader`, and `external/routes.ts` → sub-routers (C2) all split.
- **ADR-103-bloat / ADR-139** (2026-05-27) — `terminal/routes.ts` accepted as a deep-module exception; WS-upgrade handler extracted to `ws-upgrade-handler.ts`. (2026-06-13) The pure pty-env factory `buildSpawnEnv` was likewise extracted to `terminal/spawn-env.ts` to keep `routes.ts` under its ceiling; that move also strips inherited parent/child Claude-session markers (`CLAUDE_CODE_CHILD_SESSION` et al.) so embedded `claude` launches top-level and writes its JSONL transcript (fixes the empty Transcripts tab when the webui server was started from inside a Claude session).
- **ADR-138** (2026-05-29) — mode-change / pr-link / stop-hook JSONL events (`session-parser.ts`) + intent-based scroll detach (`useAutoScroll`).
- **ADR-141** (2026-05-30) — PR card bubble parity + open/merged badge via `gh` (`pr-status/` sub-router, `core/pr-status.ts`, `shell:false`); first external-network read.
- **ADR-142** (2026-05-30) — separate `DocumentMarkdown` renderer (controlled HTML) for file preview + new `PreviewPage` pop-out route.
- **ADR-143** (2026-05-31) — Re-open endpoint (`done → draft`) preserving the session; `TaskCardMenu.tsx`, `taskReopenApi.ts`.
- **ADR-144** (2026-05-31) — SmartViewer pop-out opens a centered in-app modal (`SmartViewerModal`), not a new tab.
- **ADR-145** (2026-05-31) — WS ping/pong liveness keepalive reaps stale writer slots; `ws-heartbeat.ts`.
- **ADR-149** (2026-06-02) — All-Projects create-menu is a project-first cascade (`CreateControls`, `ProjectCreateCascade`).
- **ADR-150 / FR-01.33** (2026-06-02) — read-only Campaigns lane: `GET /api/campaigns/:projectId`, `core/campaign-paths.ts` / `campaign-store.ts` / `campaign-parse.ts`, `campaignsApi.ts`, `useCampaigns.ts`, `CampaignLaneCard.tsx`.
- **iterate-2026-06-02-terminal-idle-attachment-gate** (2026-06-02, ADR pending) — idle ceiling attachment-gated (arms only at `attachCount===0`); extracted to `idle-reaper.ts`; grace 30 min → 12 h. Spec: `planning/iterate/2026-06-02-terminal-idle-attachment-gate.md`.
- **ADR-148** (2026-06-03) — WebUI writes campaign lifecycle status (Triage "Start Campaign", `draft → active`) via `core/campaign-write.ts` — first campaign-state write surface.
- **ADR-151** (2026-06-03) — campaign autonomous launch via a server-built command + body-only `campaignSlug`; `campaign-branch.ts`, `useLaunchCampaign.ts`, `CampaignAutonomousLaunchButton.tsx`.
- **ADR-152** (2026-06-03) — campaign lane cards collapse by default (per-slug `localStorage`); lane height-capped so the board can't be pushed off-screen.
- **ADR-153** (2026-06-03) — Campaigns lane filters on a producer-owned lifecycle status (`campaign-status-json.ts`); draft hidden = triage-only.
- **ADR-154** (2026-06-03) — markdown envelope preserves frontmatter + line-endings across the round-trip (`markdownTiptap.ts`).
- **ADR-155** (2026-06-03) — SmartViewer in-app Markdown editor + first project-file write surface (`PUT .../file`); `MarkdownEditorModal.tsx`, `MarkdownDiffView.tsx`, `markdownFileApi.ts`.
- **ADR-156** (2026-06-03) — separate Range-streaming `/media` route for video (`media/` sub-router); `/file` left atomic; `VideoRenderer.tsx`, `mediaApi.ts`.
- **ADR-157** (2026-06-04) — parse campaign Sub-Iterates table by header + strip Markdown emphasis (`campaign-parse.ts`).
- **ADR-158** (2026-06-04) — one-click single sub-iterate launch (`Launch (Cx)`): `campaign-step-branch.ts`, `useLaunchCampaignStep.ts`, `CampaignStepLaunchButton.tsx`; replaces the per-step copy affordance.
- **ADR-159** (2026-06-04) — markdown editor formatting toolbar (`MarkdownEditorToolbar.tsx`).
- **ADR-162 / ADR-163** (2026-06-07) — touch-scroll is a no-op in the DECSET-1049 alt-buffer (bench diagnosis), then routes by buffer type. **Superseded by planning ADR-133 (2026-06-15):** the alt-buffer arrow-key path made Claude's TUI cycle input history instead of scrolling; touch-pan now replicates the mouse/trackpad — a synthetic `WheelEvent` on `term.element` (xterm encodes the mouse-report or arrow-fallback) — while the normal buffer keeps `scrollLines` (`touch-scroll.ts`).
- **ADR-164** (2026-06-08) — campaign attached-run guard via `loop_state.json` (`campaign-loop-state.ts`) + server-side `409 campaign_run_already_attached`.
- **ADR-165** (2026-06-08) — full-viewport `term.refresh` after the replay-drain settles (`useReplayDrainGate`); unclean-open fix.
- **ADR-166** (2026-06-08) — triage reader unions tracked ∪ gitignored outbox; status writes residence-derived (Python-parity).
- **ADR-167** (2026-06-09) — live per-step `in_progress` overlay derived from `loop_state.json` (`readLoopRunState`).
- **ADR-168** (2026-06-09) — scroll-triggered full-viewport WebGL repaint (`scroll-repaint.ts`); table smear fix.
- **ADR-169** (2026-06-10) — `pendingDelivery` as route enrichment (`core/triage-enrich.ts`) parity-gated against the real triage CLI.
- **ADR-170** (2026-06-11) — Campaigns-board status from the tracked event log (`core/campaign-events.ts`): overlay completions + synthesize `derivedFromEvents` when the dir is absent.
- **iterate-2026-06-11-custom-action-slash-command** (2026-06-11, FR-01.37, ADR pending) — custom actions gain `slash_command` so `{task.initial_prompt}` fuses command + description (`actions-substitute.ts`, `actions-schema-validator.ts`). Spec: `planning/iterate/2026-06-11-custom-action-slash-command.md`.
- **iterate-2026-06-12-campaign-dismiss** (2026-06-12, FR-01.33, ADR pending, PR #126) — manual dismiss/restore for board cards via webui-owned `${registryDir}/dismissed-campaigns.json` (`dismissed-campaigns-store.ts`, `campaign-route-helpers.ts`, `CampaignDismissButton.tsx`, `CampaignsLane.tsx`, `useDismissCampaign.ts`) — a quittance, NOT a producer write. Spec: `planning/iterate/2026-06-12-campaign-dismiss.md`.
- **iterate-2026-06-14-tablet-responsive-view** (2026-06-14, FR-01.38, ADR pending) — tablet layout (≤1023px): `useIsCompactViewport` compact-band SSoT; sidebar rail at 1023; board swipe carousel + `lg:`-gated lists; new `PaneTabBar` keeps ONE persistent `PanelGroup` mounted so the terminal subtree never unmounts across a tab/breakpoint change; desktop ≥1024px byte-identical. Spec: `planning/iterate/2026-06-14-tablet-responsive-view.md`.
- **iterate-2026-06-14-phone-responsive-view** (2026-06-14, FR-01.39, ADR pending) — phone layout (<768px): `useIsPhoneViewport` + `useCoarsePointer` (shared `useMediaQuery`); sidebar becomes a Radix `Dialog` drawer; new coarse-pointer `TerminalKeyBar` writes Esc/Tab/Ctrl-C/arrows/Enter to the pty via the existing writer frame as a sibling of the persistent canvas; table/modal reflow; `viewport-fit=cover` + `100dvh`/safe-area; new `mobile-chromium` Playwright project; tablet/desktop byte-identical. Spec: `planning/iterate/2026-06-14-phone-responsive-view.md`.
- **iterate-2026-06-12-automerge-pr-review-alignment** (2026-06-12, ADR pending) — vendored Tier-3 PR-review reviewer under `scripts/ci/`; `.github/workflows/pr-review.yml` replaces `claude-review.yml` (CI-only, no app runtime change). Spec: `planning/iterate/2026-06-12-automerge-pr-review-alignment.md`.
- **iterate-2026-06-12-agent-docs-condense** (2026-06-12, docs, ADR pending) — agent-docs hygiene: System-Overview tree corrected (`idle-reaper`, 11 sub-routers incl. `media`/`pr-status`, campaign-* core family, `triage-enrich`); Data Flow tightened (write surfaces → scannable list); this section de-duplicated to one ADR-anchored line per change (full detail → `decision_log.md`). Fixed a stale ADR-110→ADR-116 `launchPayload` mislabel + the stale decision_log count. Spec: `planning/iterate/2026-06-12-agent-docs-condense.md`.
- **iterate-2026-06-14-actions-config-ux** (2026-06-14, FR-01.40, ADR pending) — per-project actions.json upload surface reused in the project edit modal + upload-route fix + Settings cleanup. `ActionsConfigRow` (+ `ResetActionsDialog`) extracted out of `ActionsConfigCard` (408→86 LOC) into `settings/ActionsConfigRow.tsx` + `settings/ResetActionsDialog.tsx`, with a `hideProjectHeader` flag; `ProjectSettingsDialog` (project edit modal, gear) renders it **compact** (gated on `!synthesized && path`), Settings renders it **full**. **Bugfix (completes FR-01.37):** `external/actions/upload.ts` now passes `action.slash_command` to `dryRunTemplate` (mirroring `get.ts` incl. try/catch) — uploading a custom `{task.initial_prompt}`+`slash_command` config via Settings was a 500. **Removal:** stale "Launcher preferences" card deleted from `SettingsPage`. No new write surface (POST/DELETE `/api/projects/:id/actions-upload` already exist; server stays validation authority). Spec: `planning/iterate/2026-06-14-actions-config-ux.md`.
- **iterate-2026-06-15-mobile-tablet-layout-polish** (2026-06-15, FR-01.41, ADR pending) — mobile/tablet layout polish (modifies FR-01.38/39): new `external/MobileTopBarSlot.tsx` (portal slot) + `external/BoardStatusFilter.tsx` (pills + phone icon-menu, extracted from `TaskBoardPage`); compact-band density/clipping fixes in `TerminalLaunchButton`/`ProjectsPage`/`SidebarNavItem` + flexible board lanes. No server/write-surface change; desktop byte-identical. Spec: `planning/iterate/2026-06-15-mobile-tablet-layout-polish.md`.
- **iterate-2026-06-15-phone-header-polish** (2026-06-15, FR-01.41 follow-up, ADR pending) — phone-only polish: top-bar `ProjectFilterDropdown` `fluid` is content-width (`max-w-[60vw]`) not full-width; the All-Projects `+ New` cascade branches via `useIsPhoneViewport()` to new `external/ProjectCreatePhoneMenu.tsx` — a flat downward drill-down (project → in-place actions) replacing the off-screen side submenu, reusing the cascade's loader + `onSelect(action,projectId)`→NewIssueModal. Tablet/desktop unchanged. Spec: `planning/01-adopted/spec.md` (FR-01.41 row).
- **iterate-2026-06-15-touch-scroll-wheel-events** (2026-06-15, FR-01.38, planning ADR-133) — embedded-terminal touch-scroll replicates the mouse/trackpad: `touch-scroll.ts` dispatches a pixel-mode `WheelEvent` on `term.element` when mouse-tracking is active or the alt-buffer is current (xterm encodes the mouse-report / arrow-fallback); normal buffer keeps `scrollLines`. Supersedes the ADR-131/132 arrow-key path Claude read as history-nav; drops the `sendData` coupling. Spec: `planning/adr/133-touch-scroll-wheel-events.md`.
- **ADR-171** (2026-06-11): Custom-action slash_command fuses description into the launch prompt
- **ADR-175** (2026-06-12): Manual board dismiss/restore for campaigns (webui-owned quittance, not producer status)
- **ADR-183** (2026-06-14): Actions-config upload surface reused in the project edit modal; upload-route slash_command fix
- **ADR-185** (2026-06-14): Phone responsive view: sidebar overlay drawer + on-screen terminal key bar
- **ADR-188** (2026-06-14): Tablet responsive view (≤1023px) — compact band, persistent-PanelGroup detail
- **ADR-192** (2026-06-15): Mobile/tablet layout polish: portal-slot top bar + extracted board status filter
- **ADR-193** (2026-06-15): Phone header polish: content-width top-bar dropdown + flat '+ New' drill-down
- **ADR-196** (2026-06-15): Touch-scroll replicates the mouse wheel (synthetic WheelEvent on term.element), superseding the ADR-132 arrow-key path
