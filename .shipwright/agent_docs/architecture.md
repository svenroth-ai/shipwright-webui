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
│                                 │   sdk-sessions-store.ts (v1-v4) │ │
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
│                                 │   jsonl-records.ts (leaf)       │ │
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

Shipwright Command Center is a two-half local stack: a Hono backend on Node 20+ at `:3847` and a Vite-served React 19 frontend at `:5173`, communicating over a JSON HTTP API under `/api`. The Vite dev server proxies `/api` to the Hono port, so both halves run independently and refuse to silently half-start (Vite via `strictPort`, Hono via a bind-error handler). The sections below group the data flow by theme rather than by the order features shipped.

### 1. The external-launch contract (webui spawns no Claude)

The load-bearing choice (ADR-034, amended by ADR-067/068-A1) is that the WebUI **never spawns a Claude process** (rule 1). On task creation the server pre-binds a `crypto.randomUUID()` session-id (rule 2). The launcher (`core/launcher.ts buildCopyCommands()`) only **builds command strings** — one per shell kind (PowerShell / cmd.exe / POSIX) carrying `--session-id <uuid> --name "<title>" --add-dir …` (`--plugin-dir` re-passed on every launch, rule 9). After an explicit CTA click (Launch / Resume / Relaunch), the embedded terminal **auto-executes** the matching command via a client-side WS data-frame (rule 19) — the pty spawn target is whitelisted to shell binaries only, never `claude` (rule 1/17). The user may instead copy that command and run it in their own terminal or VS Code; the WebUI observes the result either way. Claude writes its JSONL transcript at `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` (rule 2); `core/session-watcher.ts` observes it. Discovery is filename-first (`<uuid>.jsonl`, rule 3); the first-line sessionId is a secondary sanity check.

### 2. Reading transcripts (stateless, poll-based)

The transcript endpoint is stateless (rule 4): clients pass `GET /api/external/tasks/:id/transcript?fromByte=<offset>&expectFingerprint=<fp>`, so multi-tab support works by construction with no server-side offset cache. UTF-8-safe byte slicing cuts on linefeed boundaries only (rule 5); EBUSY/EPERM/EACCES/ENOENT retry up to 6 attempts with 50→1600 ms backoff (rule 6). Client polling at 1 s (`useTaskTranscript`) replaces SSE — no chokidar, no heartbeat (rules 7–8). Auto-scroll is CSS-first (`overflow-anchor: auto`) with `useAutoScroll` as the safety net.

### 3. The Inbox (detecting a session that needs the user)

`core/inbox-derive.ts deriveSessionInbox()` (cache key `(sessionUuid, mtimeMs, dismissedKey, contentLength)`) unifies three detection sources with precedence `ask_tool > terminal_prompt > text_question`: (1) pending `tool_use` blocks in the JSONL; (2) `detectAwaitingUserQuestion()` — a plain-text question as the latest turn-ended assistant message (auto-clears on the next user turn, no persisted state); (3) `core/terminal-prompt-detect.ts extractTerminalPrompt` over the live `@xterm/headless` mirror (`PtyManager.peekTerminalText`, a post-pass outside the mtime cache) for a waiting `AskUserQuestion` picker that never reaches the JSONL (best-effort, live-mirror-only). Inbox cards pass `{ focusTerminal: true }` nav-state. Detail: decision_log ADR-113.

### 4. Persistent state & configuration

State lives in three `proper-lockfile`-guarded files under `~/.shipwright-webui/` (ELOCKED → HTTP 409): `projects.json` (registry), `sdk-sessions.json` (task store, schemaVersion v1–v4, additive write-on-touch migration per ADR-038/044 — v4 adds the optional `boardColumn` override; rule 15), and `settings.json`. `SdkSessionsStore.persist()` re-reads and 3-way-merges under the lock, then writes atomically (tmp+rename) via `core/sdk-sessions-merge.ts`, so two webui instances sharing `~/.shipwright-webui` can't clobber each other's rows (rule DO-NOT #6). Stack profiles resolve in three steps: `SHIPWRIGHT_PROFILES_DIR` → `SHIPWRIGHT_MONOREPO_PATH/shared/profiles` → bundled `server/profiles/`.

Project configuration is read-only: `<project>/.shipwright-webui/actions.json` overlays the bundled `default-actions.json` (`core/project-actions-loader.ts` + `actions-substitute.ts`), and `<project>/shipwright_run_config.json` is consumed via `core/run-config-reader.ts` — the v2 read surfaces the optional `mode` (`multi_session | single_session`, absent→`multi_session` via `resolveRunMode`, an unrecognised value dropped+warned rather than rejecting the config). The WebUI **never** writes `shipwright_run_config.json` or `run_loop_state.json` (rule 12).

### 5. The Task Board (column decoupled from liveness state)

The Task-Board column is a sticky, user-owned status (`boardColumn ∈ {backlog, in_progress, done}`, server type in `core/board-column.ts`), decoupled from the machine-derived liveness `state` (rule 23). The board groups by `resolveBoardColumn(task) = task.boardColumn ?? deriveBoardColumn(state)` (`client/src/lib/boardColumnApi.ts`), so a task with no override falls back to the historical state→column mapping (zero behavior change without a drag) while a live task can be parked in any column and still show its Resume CTA + liveness badge (both key off `state`). Drag-and-drop lives in `TaskBoardColumns.tsx` (`@dnd-kit/core`; mouse-distance / touch-press-delay / keyboard sensors). The **sole** column write surface is `POST /api/external/tasks/:id/column` (sets `boardColumn` only — JSONL/state untouched; 400 `invalid_column`, 409 ELOCKED); `/close`, `/backlog`, `/reopen` sync it inline so a prior drag can't strand a card. **Exception (ADR-204):** a terminal `done` card is locked in *every* column, so moving it OUT of Done routes through `boardColumnApi.moveReopensTask(state, target)` → `POST /reopen` with the dropped `{ column }` (state → `draft`, lands unlocked) — `/reopen` is a *lifecycle* command allowed to set `state`; rule 23 only forbids `/column` from doing so. Columns and List view default to last-modified-descending (`client/src/lib/taskSort.ts`).

### 6. Write surfaces (the complete set)

Beyond the state files in §4, every in-project write flows through `realPathGuard` (symlink-escape refusal, null-byte reject) and uploads add a `Content-Length` pre-check. The Preview dev-server spawn uses `shell: false` exclusively through `core/preview-session-manager.ts` (rule DO-NOT #9/#10). The complete write set is:

- `~/.shipwright-webui/{projects,sdk-sessions,settings}.json` — registry / task-store / settings, `proper-lockfile`-guarded (ELOCKED → 409).
- `<project>/.shipwright-webui/actions.json` — stub create + upload/reset (FR-01.27).
- `<project>/.shipwright-webui/<slug>.code-workspace` — idempotent VS Code bootstrap, POST `/api/projects` only (ADR-059).
- `PUT /api/external/projects/:projectId/file` — markdown-only project-file write: `.md`/`.markdown` allowlist, `realPathGuard`, content-hash `If-Match` (409 on drift), atomic tmp+rename (FR-01.35 / ADR-155).
- `<task.cwd>/.shipwright-webui/pastes/img-<unix-ms>-<hex>.<ext>` — embedded-terminal image paste (magic-byte sniff, 8 MiB cap, keep-last-N; ADR-067), plus an idempotent `.shipwright-webui/` append to `<task.cwd>/.gitignore` (a legacy `.claude-pastes/` line already counts as covering).
- `~/.shipwright-webui/terminal-scrollback/<taskId>.{log,snapshot}` — scrollback + cell-state snapshot, rotated at `SHIPWRIGHT_TERMINAL_SCROLLBACK_MAX_BYTES` (default 1 MiB); dir `0o700` / files `0o600` (POSIX only); UUID-validated, realpath-at-op on `clear`/`rotate`, TTL daily sweep (≤100 groups, skips active tasks) (ADR-068-A1 / 087 / 088).
- Campaign lifecycle `status` `draft → active` flip via `core/campaign-write.ts setCampaignStatus` — `status.json` top-level `status` else `campaign.md` frontmatter, `.weblock` atomic; the ONLY webui write to campaign *state* (`campaign_init.py` / `campaign_progress.py` own the rest) (ADR-148 / FR-01.33).
- `${registryDir}/dismissed-campaigns.json` — webui-owned board dismiss/restore flag (`dismissed-campaigns-store.ts`), a quittance NOT a producer write (FR-01.33, PR #126).
- `POST /api/external/projects/:projectId/design-feedback` — the single-session design-gate round-feedback write: `<project>/.shipwright/designs/design-feedback-round{N}.md` (N disk-derived via `core/design-feedback.ts computeNextRound`; heading round normalized; `.md` contract-guarded + size-capped; exclusive `wx` create so two tabs don't clobber; transient gitignored scratch — never run_config/`run_loop_state.json`/JSONL). The paired reads `GET /design-gate` (`core/run-loop-state-reader.ts` derives the gate from `.shipwright/run_loop_state.json`) + `GET /designs/:rest{.+}` (serves the emitted viewer as text/html, `.shipwright/designs/`-rooted path-guard) are read-only (FR-01.45).
- `~/.shipwright-webui/deploy-status.json` + `deploy-swap.log` — the durable production-deploy verdict written by the detached swapper (`scripts/deploy-swap.mjs`), since the caller usually dies before it can report (ops tooling; no app-runtime write).

The WebUI never writes into `~/.claude/projects/` (rule DO-NOT #1) — title sync is `--name` at launch, never JSONL mutation.

### 7. The embedded terminal (pty over WebSocket)

`GET /api/terminal/:taskId/ws` (via `@hono/node-ws`, the codebase's WebSocket surface — ADR-067) is the authoritative ensure-or-create entrypoint for the per-task pty owned by `core/terminal/pty-manager.ts`. Writer ownership binds to the live WS connection identity (cleared on close/error so a new attach can become writer; WS ping/pong reaps stale writer slots). An **attachment-gated** idle ceiling (default 12 h via `SHIPWRIGHT_TERMINAL_IDLE_TIMEOUT_MS`, `terminal/idle-reaper.ts`) reaps the pty only when NO WS client is attached — armed on last-detach, disarmed on attach — so a session a user is watching is never reaped however long Claude waits. Outbound is drop-while-saturated past the `WebSocket.bufferedAmount` cap. `POST /api/terminal/:taskId/spawn` is an idempotent prewarm. The Origin gate matches the CORS loopback posture (remote access would need additional auth). `terminal/spawn-env.ts buildSpawnEnv` stamps `SHIPWRIGHT_WEBUI=1` (authoritative, after the caller-env merge) so `/shipwright-run` can detect the launch surface, and strips inherited `CLAUDE_CODE_CHILD_SESSION`-style markers so embedded `claude` launches top-level and writes a flat `<uuid>.jsonl`. Auto-launch: `LaunchCoordinatorContext` dispatches a monotonic `launchToken`; `EmbeddedTerminal` sends `commands[shellKind]` + a carriage return over the WS after a prompt-readiness handshake (250 ms quiesce, 3 s cap), cancelled on reader-role / unmount / 30 s.

### 8. Terminal replay (cell-state snapshots)

Replay evolved ADR-068-A1 → 088/089 → 087 (retired chunked replay) → 092 (closed the live-pty re-attach regression). **Current flow:** on each `onOpen` the server pauses the pty and resolves the snapshot **live-mirror-first, disk-fallback** — `ptyManager.serializeMirrorIfLive(taskId)` (in-memory `@xterm/headless` mirror) else `snapshotStore.read(taskId)` (written by cleanup-time `finalizeMirrorSnapshot` or detach-time `flushMirrorSnapshot`) — emits exactly ONE `replay_snapshot` envelope `{data, cols, rows, terminalVersion}` (envelope v2, xterm 6.0 exact-pinned; rule 22), then resumes; the client writes it once via `term.reset()` + `term.write(data)` + `term.scrollToBottom()`. On last detach (`detachAndCount` → 0) `flushMirrorSnapshot` persists to disk WITHOUT disposing the pty (server-restart resilience). No snapshot (missing / version-mismatch / `headless-probe.ts` import failure) ⇒ blank terminal + live shell (deliberate). Done / `launch_failed` tasks skip spawn+attach and get a `replayOnly` `ready` + snapshot + clean close ("Session ended" banner). Legacy chunked envelopes are RETIRED; stale-server frames dropped client-side. Scrollback append is `fs.appendFileSync`; rotation is a `p-queue`-serialized 3-state machine; `POST /clear-scrollback` and `DELETE /tasks/:id` (cascade-clears scrollback + snapshot) are the destructive paths. The terminal renders a faithful truecolor light/dark palette mirroring Claude Code's theme (`claude-theme-reader.ts` + the `terminal-appearance` route, `xterm-theme-options.ts` / `useTerminalAppearance.ts`; supersedes ADR-067's brand clamp), heals mid-stream WebGL atlas corruption via `webgl-atlas-repaint.ts`, and pans via a synthetic `WheelEvent` on touch.

### 9. Single-session pipeline mode

When `run_config.mode = single_session`, a run renders as a campaign-like card instead of a plain task: `external/PipelineLaneCard.tsx` (mode selector) → `external/SingleSessionRunCard.tsx` (progress bar via `lib/pipelineProgress.ts` + phase checklist + one `external/MasterRunLaunchButton.tsx` Launch/Resume CTA → `useLaunchMasterRun`). The server builds the `/shipwright-run` command in `external/launch/master-run-branch.ts` (body-only `masterRun`, `single_session`-gated, fail-closed, `409 master_run_already_attached`); the client wrapper is `lib/masterRunApi.ts`. `multi_session` / legacy runs keep `MasterTaskCard`. The design-gate review host (§6) reuses `MasterRunLaunchButton` as its Resume CTA (`DesignGatePanel` / `MockupReviewOverlay`, `useDesignGate` / `designReviewApi` over `external/design-review/*`). (Campaign `webui-pipeline-convergence`, W1–W3.)

### 10. Client-side rendering

The virtualized `BubbleTranscript` persists per-row measurement sizes to `localStorage["webui.virtualizerCache.<sessionUuid>"]` (schemaVersion 1, JSON, capped at 1000 entries) so revisiting a long session avoids the slow-scroll-up estimate-vs-measure cascade (ADR-066). Writes fire on `pagehide`, every 5 s, and unmount; the cache is pruned to active event keys before write and rehydrated on mount via TanStack Virtual's `initialMeasurementsCache`; a cold-cache one-frame warmup raises `overscan` so visible rows mount + measure first. This is browser-local — no server involvement. Motion is token-driven (A20 / FR-01.64); under `prefers-reduced-motion` every screen renders its complete final state.

### 11. Read-only observers (Triage, Compliance Grade)

Two features are pure consumers of producer-owned files under `<project>/.shipwright/`:

- **Triage Tab** — read consumer + status-flip producer over `triage.jsonl` (ADR-101/106). Five `/api/triage/*` endpoints (`counts`, `:projectId` list, `promote`/`dismiss`/`snooze`). The list is a TS port of `shared/scripts/triage.py read_all_items` (last-status-wins, **record-boundary recovering**, Python-fixture-parity-gated), reading the **union tracked ∪ gitignored `triage.outbox.jsonl`** with status flips residence-derived (ADR-166) and each item annotated `pendingDelivery` (ADR-169) + `campaignSlug`/`campaignStatus`. Promote is a cross-store transaction (idempotent retry + orphan-promote guard); a 5 s mtime cache fronts reads; per-project fault isolation via `Promise.allSettled`. **Fix now** copies the producer `launchPayload` (`stripControlChars` byte-port; ADR-116) to the clipboard — never a server launch (rule 1); **Start Campaign** performs the `draft → active` write (§6). All fields render as plain text (XSS-safe).
- **Compliance Grade** — read-only observer of `compliance/dashboard.md` (FR-01.43); the WebUI never writes it. `core/compliance-reader.ts` (`parseDashboard`, pure + fixture-tested) extracts the badge fields and slices the "Control Verdict" + "CI Security" markdown sections (excluding the dead-in-browser artifacts links). `GET /api/external/projects/:projectId/compliance` (`external/compliance/routes.ts`, mounted read-only; `{status: missing|invalid}` on graceful absence) feeds `lib/complianceApi.ts` + `useProjectCompliance` (30 s poll, `retry:false`). `ComplianceGradeBadge` (A→emerald / B→amber / ≤C→red) renders on the Projects table and the single-project board header; clicking opens `ComplianceDetailModal` (Radix Dialog), whose body renders the two slices via `DocumentMarkdown` (react-markdown + remark-gfm) 1:1 with the dashboard.

## See also

- [`README.md`](../../README.md) — quickstart, prerequisites, parallel-worktree setup, autostart on Windows
- [`docs/guide.md`](../../docs/guide.md) — full user-facing docs: installation, updates, autostart, custom actions, multi-session pipelines, Continue Pipeline UX, troubleshooting (718 lines)
- [`CLAUDE.md`](../../CLAUDE.md) — load-bearing project instructions; preserved by /shipwright-adopt. Architecture rules + DO-NOT regression guards now also live in `conventions.md`
- [`conventions.md`](conventions.md) — TS strict, file-size cap, render stack, regression guards, Conventional Commits
- [`decision_log.md`](decision_log.md) — full ADR catalogue (DEC-001 … ADR-263, plus carried-over h2 ADR-045b / 065 / 066); first 53 migrated from the pre-adopt root log, ADR-053 = adoption, the rest post-adoption. **SSoT for every change the Updates section points to** — each post-adoption ADR carries a `Run-ID:` line linking it to the run_id anchor used here, so the run_id → ADR mapping is one lookup away (that is *why* the Updates list no longer duplicates the ADR number).
- [`component_inventory.md`](component_inventory.md) — React component inventory (refresh via `/shipwright-adopt`; current snapshot dated in the file header)
- [`design_tokens.md`](design_tokens.md) — raw Tailwind / CSS-var extraction
- [`../designs/visual-guidelines.md`](../designs/visual-guidelines.md) — canonical design tokens for `/shipwright-design` consumption (typography, colors, spacing, radius, shadows, component patterns)
- [`known_issues.md`](known_issues.md) — TODO/FIXME inventory (currently empty)

## Architecture Updates
_**One line per change, ≤600 chars** — always-loaded Layer-1 context; detail lives in the cited decision-drop / ADR (the SSoT — read it in `decision_log.md`), not here. **The canonical anchor is the run_id**, one atomic line per change: `- **<run_id>** (date, flags) — one sentence. Spec: planning/iterate/<slug>.md.` The run_id↔ADR-NNN mapping lives in `decision_log.md` (keyed by `Run-ID:`) — DO NOT append a duplicate `ADR-NNN` bullet here (the release aggregator no longer does; the monorepo shape-gate enforces the run_id grammar from 2026-06-28). Superseded entries stay (their context explains later changes). Deep-historical bare-`ADR-NNN` lines with no run_id twin (pre-2026-06-11) are grandfathered as-is._
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
- **iterate-2026-06-02-terminal-idle-attachment-gate** (2026-06-02) — idle ceiling attachment-gated (arms only at `attachCount===0`); extracted to `idle-reaper.ts`; grace 30 min → 12 h. Spec: `planning/iterate/2026-06-02-terminal-idle-attachment-gate.md`.
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
- **iterate-2026-06-11-custom-action-slash-command** (2026-06-11, FR-01.37) — custom actions gain `slash_command` so `{task.initial_prompt}` fuses command + description (`actions-substitute.ts`, `actions-schema-validator.ts`). Spec: `planning/iterate/2026-06-11-custom-action-slash-command.md`.
- **iterate-2026-06-12-campaign-dismiss** (2026-06-12, FR-01.33, PR #126) — manual dismiss/restore for board cards via webui-owned `${registryDir}/dismissed-campaigns.json` (`dismissed-campaigns-store.ts`, `campaign-route-helpers.ts`, `CampaignDismissButton.tsx`, `CampaignsLane.tsx`, `useDismissCampaign.ts`) — a quittance, NOT a producer write. Spec: `planning/iterate/2026-06-12-campaign-dismiss.md`.
- **iterate-2026-06-12-automerge-pr-review-alignment** (2026-06-12) — vendored Tier-3 PR-review reviewer under `scripts/ci/`; `.github/workflows/pr-review.yml` replaces `claude-review.yml` (CI-only, no app runtime change). Spec: `planning/iterate/2026-06-12-automerge-pr-review-alignment.md`.
- **iterate-2026-06-12-agent-docs-condense** (2026-06-12, docs) — agent-docs hygiene: System-Overview tree corrected (`idle-reaper`, sub-routers incl. `media`/`pr-status`, campaign-* core family, `triage-enrich`); Data Flow tightened (write surfaces → scannable list); this section de-duplicated to one line per change (full detail → `decision_log.md`). Fixed a stale ADR-110→ADR-116 `launchPayload` mislabel + the stale decision_log count. Spec: `planning/iterate/2026-06-12-agent-docs-condense.md`.
- **iterate-2026-06-14-tablet-responsive-view** (2026-06-14, FR-01.38) — tablet layout (≤1023px): `useIsCompactViewport` compact-band SSoT; sidebar rail at 1023; board swipe carousel + `lg:`-gated lists; new `PaneTabBar` keeps ONE persistent `PanelGroup` mounted so the terminal subtree never unmounts across a tab/breakpoint change; desktop ≥1024px byte-identical. Spec: `planning/iterate/2026-06-14-tablet-responsive-view.md`.
- **iterate-2026-06-14-phone-responsive-view** (2026-06-14, FR-01.39) — phone layout (<768px): `useIsPhoneViewport` + `useCoarsePointer` (shared `useMediaQuery`); sidebar becomes a Radix `Dialog` drawer; new coarse-pointer `TerminalKeyBar` writes Esc/Tab/Ctrl-C/arrows/Enter to the pty via the existing writer frame as a sibling of the persistent canvas; table/modal reflow; `viewport-fit=cover` + `100dvh`/safe-area; new `mobile-chromium` Playwright project; tablet/desktop byte-identical. Spec: `planning/iterate/2026-06-14-phone-responsive-view.md`.
- **iterate-2026-06-14-actions-config-ux** (2026-06-14, FR-01.40) — the per-project actions.json upload surface is reused in the project edit modal: `ActionsConfigRow` (+ `ResetActionsDialog`) extracted from `ActionsConfigCard` (408→86 LOC), rendered compact in `ProjectSettingsDialog` and full in Settings; plus an upload-route fix (`external/actions/upload.ts` passes `slash_command` to `dryRunTemplate`, completing FR-01.37) and removal of the stale "Launcher preferences" card. Spec: `planning/iterate/2026-06-14-actions-config-ux.md`.
- **iterate-2026-06-15-mobile-tablet-layout-polish** (2026-06-15, FR-01.41) — mobile/tablet layout polish (modifies FR-01.38/39): new `external/MobileTopBarSlot.tsx` (portal slot) + `external/BoardStatusFilter.tsx` (pills + phone icon-menu, extracted from `TaskBoardPage`); compact-band density/clipping fixes in `TerminalLaunchButton`/`ProjectsPage`/`SidebarNavItem` + flexible board lanes. No server/write-surface change; desktop byte-identical. Spec: `planning/iterate/2026-06-15-mobile-tablet-layout-polish.md`.
- **iterate-2026-06-15-phone-header-polish** (2026-06-15, FR-01.41 follow-up) — phone-only polish: top-bar `ProjectFilterDropdown` `fluid` is content-width (`max-w-[60vw]`) not full-width; the All-Projects `+ New` cascade branches via `useIsPhoneViewport()` to new `external/ProjectCreatePhoneMenu.tsx` — a flat downward drill-down (project → in-place actions) replacing the off-screen side submenu, reusing the cascade's loader + `onSelect(action,projectId)`→NewIssueModal. Tablet/desktop unchanged. Spec: `planning/01-adopted/spec.md` (FR-01.41 row).
- **iterate-2026-06-15-touch-scroll-wheel-events** (2026-06-15, FR-01.38, planning ADR-133) — embedded-terminal touch-scroll replicates the mouse/trackpad: `touch-scroll.ts` dispatches a pixel-mode `WheelEvent` on `term.element` when mouse-tracking is active or the alt-buffer is current (xterm encodes the mouse-report / arrow-fallback); normal buffer keeps `scrollLines`. Supersedes the ADR-131/132 arrow-key path Claude read as history-nav; drops the `sendData` coupling. Spec: `planning/adr/133-touch-scroll-wheel-events.md`.
- **iterate-2026-06-20-mobile-terminal-touch-ux** (2026-06-20, FR-01.28/39) — new `repaint-on-settle.ts` (data-driven terminal repaint — refresh on each `onWriteParsed` until the async redraw settles) replaces the fixed 130/350ms trailing repaints in `useTerminalResize.ts`, fixing input-area smear on slow mobile transitions; touch-scroll now routes buffer-first — normal buffer pans scrollback even with mouse-tracking on, amending the touch-scroll wheel path for the `--resume` picker; phone task-detail header condensed via `useIsPhoneViewport`.
- **iterate-2026-06-22-terminal-idle-tab-switch-smear** (2026-06-22, FR-01.28) — new `activation-repaint.ts` (data-independent 130/350 ms trailing repaints) wired by `useTerminalResize.ts` on tab-activation + visibility/focus, closing the idle-session smear gap the data-driven `repaint-on-settle.ts` left (no writes, no repaint). Two complementary mechanisms; detail in the decision-drop.
- **iterate-2026-06-23-board-drag-done-reopen** (2026-06-23, FR-01.01) — a terminal `done` card dragged / ⋯-menu-moved OUT of Done now reopens (state `done → draft`) and lands UNLOCKED in the dropped column instead of stranded done+locked. New `boardColumnApi.moveReopensTask(state,target)`; `useSetBoardColumn` gains `reopen` → `reopenTask(taskId,column)` + optimistic `state→draft`; `/reopen` gains an optional `{column}` (defaults Backlog). `/column` still never touches `state` — rule-23 decoupling intact for live cards. Spec: `planning/01-adopted/spec.md` (FR-01.01 row).
- **iterate-2026-06-23-terminal-renderer-toggle** (2026-06-23, FR-01.28, DIAGNOSTIC) — new `terminal-renderer.ts` — runtime renderer override read by `xtermAddons.ts`. `?terminalRenderer=dom` query or `localStorage["shipwright:terminal-renderer"]="dom"` skips the WebGL addon so xterm uses its DOM renderer. Default unchanged (`webgl`). Lets a real-GPU A/B confirm or refute whether WebGL is the root cause of the smear class (5 `term.refresh` fixes did not kill it across active/idle/replay). Not the fix; the fix follows the A/B verdict.
- **iterate-2026-06-27-webgl-atlas-glyph-corruption** (2026-06-27, FR-01.28, BUG) — new `webgl-atlas-repaint.ts` (wired in `xtermAddons.ts` beside `onContextLoss`) routes all three WebGL atlas-mutation events (`onChangeTextureAtlas` + `onAddTextureAtlasCanvas` + `onRemoveTextureAtlasCanvas`) through one full-viewport `term.refresh`, healing the "wrong letter" glyph corruption (cells keep stale atlas coords after a mid-stream atlas regen; previously needed a manual resize). Real-browser proof: e2e spec 94 (`atlasRepaints=32`). Detail in the decision-drop.
- **iterate-2026-06-30-compliance-grade-webui** (2026-06-30): Component + data-flow — read-only per-project Compliance Grade: `core/compliance-reader.ts` (`parseDashboard`, fixture-tested) extracts the letter/score + Control-Verdict / CI-Security slices from `.shipwright/compliance/dashboard.md`; `GET /projects/:projectId/compliance` feeds `complianceApi.ts` + `useProjectCompliance` → `ComplianceGradeBadge` + `ComplianceDetailModal` (slices via `DocumentMarkdown`), read-only (FR-01.43). → decision_log (Run-ID).
- **iterate-2026-07-01-terminal-title-wrap-smear** (2026-07-01): Component — new `useTerminalSizeSync.ts`: `syncSizeNow` (safeFit + `resize`) fires on the ordered WS right before the launch command (`useAutoLaunch` `onBeforeDispatch`) so Claude renders its title pill at the client's real width, not the pty's hardcoded 120 cols; plus a writer-gated post-replay convergence (`useReplayDrainGate`), fixing the long-title input smear (FR-01.28, BUG). → decision_log (Run-ID).
- **iterate-2026-07-06-terminal-theme-modes** (2026-07-06): Component + data-flow — embedded terminal becomes a faithful truecolor light/dark terminal mirroring Claude Code's theme: new `claude-theme-reader.ts` + the `terminal-appearance` route (`GET /api/terminal/claude-theme`) feed client `xterm-theme-options.ts` / `useTerminalAppearance.ts`; `spawn-env.ts` supersedes ADR-067's brand clamp (FR-01.44). → decision_log (Run-ID).
- **iterate-2026-07-06-project-delete-cascades-tasks** (2026-07-06): Component + data-flow — new `core/cascade-delete-project-tasks.ts`: `DELETE /api/projects/:id` cascade-removes every task whose `projectId` matches (store row + best-effort scrollback + snapshot) and returns `{ ok, deletedTaskCount }`, so a runtime project delete no longer strands a phantom "Unassigned" row; the delete confirm warns the count (FR-01.25, BUG). → decision_log (Run-ID).
- **iterate-2026-07-06-terminal-copy-selection-cache** (2026-07-06): Component — new `useTerminalClipboard.ts` redraw-proof copy cache captures the xterm selection at settle (`useTerminalSelection.ts`) so Ctrl+C/Ctrl+Insert + a mouse-only Copy pill (`TerminalBanners.tsx`) copy it via the execCommand fallback, invalidated on gesture/keydown so SIGINT survives (FR-01.28, BUG; superseded by iterate-2026-07-07-terminal-osc52-clipboard). → decision_log (Run-ID).
- **iterate-2026-07-07-terminal-osc52-clipboard** (2026-07-07): Component — OSC 52 becomes the SOLE terminal copy path: new `terminal-osc52.ts` (`registerOscHandler(52)`) decodes + writes via `copyText` (execCommand, http-safe) and DENIES read requests; supersedes the WebUI's own Ctrl+C interception + copy-on-selection + the redraw cache (all removed), and Ctrl+C now passes through as SIGINT (FR-01.28, BUG). → decision_log (Run-ID).
- **iterate-2026-07-07-terminal-rightclick-double-paste** (2026-07-07): Component — the embedded terminal no longer forwards RIGHT-button mouse reports to the pty (new `terminal-mouse-report.ts` `isRightButtonMouseReport()` filters the `onData` sink), so Claude stops pasting on top of the browser context-menu Paste; left/middle/wheel still forwarded (FR-01.28, BUG). → decision_log (Run-ID).
- **iterate-2026-07-08-board-sort-last-modified** (2026-07-08): Component — Task-Board columns AND List view default to Last-Modified-descending via a shared `client/src/lib/taskSort.ts` helper (deterministic `taskId` tiebreak; dedupes two private last-activity copies); pure client render-order, identical across Desktop/Tablet/Phone (FR-01.01). → decision_log (Run-ID).
- **iterate-2026-07-09-w1-mode-aware-config** (2026-07-09): Data-flow — optional `run_config.mode` (`multi_session | single_session`) in `RunConfigV2` (client + server mirrors; `resolveRunMode` / `parseRunMode`) + an authoritative `SHIPWRIGHT_WEBUI=1` pty marker in `spawn-env.ts`; the reader drops an unrecognised mode + warns (campaign webui-pipeline-convergence W1). → decision_log (Run-ID).
- **iterate-2026-07-09-w2-master-launch-handoff** (2026-07-09): Component + data-flow — single-session master-launch mechanism: server `external/launch/master-run-branch.ts` builds `/shipwright-run` (body-only `masterRun`, single_session-gated, fail-closed); client `lib/masterRunApi.ts` + `hooks/useLaunchMasterRun.ts` feed the `webui:pending-auto-launch` handoff (campaign webui-pipeline-convergence W2). → decision_log (Run-ID).
- **iterate-2026-07-09-w3-single-session-board** (2026-07-09): Component — single-session runs render as a campaign-like card: new `external/PipelineLaneCard.tsx` → `external/SingleSessionRunCard.tsx` (bar via `lib/pipelineProgress.ts` + phase checklist + one `external/MasterRunLaunchButton.tsx` CTA → `useLaunchMasterRun`); `multi_session`/legacy keep `MasterTaskCard`; server adds `409 master_run_already_attached` (campaign webui-pipeline-convergence W3). → decision_log (Run-ID).
- **iterate-2026-07-10-preview-win32-spawn** (2026-07-10): Component + data-flow — new `core/preview-win32-spawn.ts` makes the Preview dev-server spawn work on Windows: backslash-safe tokenization + PATHEXT resolution + .cmd/.bat shims via `cmd /d /s /c` with discrete argv + `windowsVerbatimArguments`, `shell:false` preserved; bare argv0 resolves via PATH only, `%` refused; POSIX byte-identical (FR-01.17, BUG, deep-audit D03). → decision_log (Run-ID).
- **iterate-2026-07-10-store-multi-instance-clobber** (2026-07-10): Component + data-flow — new pure module `core/sdk-sessions-merge.ts` (`mergeSessions`/`classifyDiskRaw`/`withFsRetry`) makes `SdkSessionsStore.persist()` re-read + 3-way merge under the proper-lockfile lock and write atomically (tmp+rename), so two concurrent webui instances no longer clobber each other's rows (FR-01.08/09, BUG, deep-audit D04). → decision_log (Run-ID).
- **iterate-2026-07-10-design-gate-review-host** (2026-07-10): Component + data-flow — single-session design-gate mockup review hosting: the emitted viewer is served in a sandboxed iframe (`external/design-review/*` + `core/{run-loop-state-reader,design-feedback}.ts`; new `POST /design-feedback` write surface + RO `/design-gate`, `/designs/*`) with client `DesignGatePanel`/`MockupReviewOverlay`; Resume reuses `MasterRunLaunchButton` (FR-01.45). → decision_log (Run-ID).
- **iterate-2026-07-14-deploy-self-kill** (2026-07-14): Data-flow — the production deploy no longer kills the server from inside the process it is about to kill: kill + start + readiness + `~/.claude.json` heal move to the detached `scripts/deploy-swap.mjs` + `scripts/deploy-procs.mjs` (`taskkill /F /PID`, never `/T`); new ops write surface `~/.shipwright-webui/deploy-status.json` + `deploy-swap.log` (BUG, ops tooling, no app-runtime change). → decision_log (Run-ID).
- **iterate-2026-07-15-e2e-pty-spawn-cwd-267** (2026-07-15): Component — pty spawn-boundary hardening: `PtyManager.spawn` throws a typed `PtySpawnFailedError` on a node-pty CreateProcess failure, and the WS-upgrade + prewarm callers degrade cleanly (`task_cwd_unusable` 409 / neutral `pty_spawn_failed` 500) instead of an uncaught Windows 267 (ERROR_DIRECTORY) (FR-01.28). → decision_log (Run-ID).
- **iterate-2026-07-18-triage-jsonl-record-boundary** (2026-07-18): Component — new neutral leaf `core/jsonl-records.ts` becomes the single record-boundary authority for the append-only triage log; `triage-write.ts` probes for an unterminated tail before appending and `triage-store.ts` RECOVERS concatenated records instead of dropping the line, with corruption surfaced as bounded metadata at the `triage-board-read.ts` boundary (FR-01.30). → decision_log (Run-ID).
- **iterate-2026-07-19-events-reader-recovery** (2026-07-19): Component — extends the `core/jsonl-records.ts` record-boundary contract to the EVENT log: new `recordsFromLines` generator, adopted by all THREE independent projections over `shipwright_events.jsonl` (`event-log-reader`, `run-data-join projectGradeTrend`, `campaign-events`), so a concatenated line yields every record instead of none. `merge=union` makes that reachable by an ordinary merge; WebUI never writes the log, so only the recovery half applies here. → decision_log (Run-ID).
- **iterate-2026-07-19-mission-s3-pipeline-campaign-polish** (2026-07-19): Component — Mission scenarios 3+5 stop borrowing the iterate rail: new `core/mission-context/{pipeline-artifacts,campaign-artifacts,slice3-sources,types-slice3}.ts` + `external/mission-context/facts-slice3.ts` resolve a phase task by EXACT `phaseTaskId` (never phase/session — splits conflate) and a campaign into campaign-level vs single-active-unit artifacts, uncached so mid-run `status.json` changes are never stale. Scenario 6 hardened: wrong-shape actions files were HIDING the tab (FR-01.66). → decision_log (Run-ID).
