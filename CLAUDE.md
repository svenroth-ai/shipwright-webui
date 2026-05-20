# Shipwright Command Center (WebUI)

## WHAT
- **Purpose**: Local web application for managing multiple Shipwright SDLC projects in parallel.
- **Architecture**: Hono backend (Node.js) + React 19 frontend (Vite 6), monorepo in `webui/`. **External-launch model (Plan D'' variant a, 2026-04-19; embedded-terminal auto-execute since Iterate 5 / ADR-068-A1)**: webui owns no Claude subprocess. The user clicks Launch / Resume / Relaunch on the TaskDetail header; the same pre-bound `--session-id <uuid>` command is auto-executed inside the embedded terminal pane (xterm.js + node-pty, shell-only whitelist) via a client-side WS data-frame. Users may still copy the command and run it in their own terminal — webui observes the resulting JSONL at `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` either way.
- **Stack**: TypeScript strict, Hono, React 19, Vite 6, TailwindCSS 4, Radix UI, TanStack React Query.

## Architecture reference

Plan of record: [`~/.claude/plans/plan-d-double-prime-external-launch.md`](../.claude/plans/plan-d-double-prime-external-launch.md).
PoC findings that shaped the implementation: [`~/.claude/plans/external-launch-poc-results.md`](../.claude/plans/external-launch-poc-results.md).
Decision record: `.shipwright/agent_docs/decision_log.md` ADR-034.

Two hard rules, survivors of every review round:
1. **Webui spawns no Claude process directly.** Users launch in the embedded-terminal pane (ADR-067 + ADR-068-A1) or copy the command to their own terminal; webui only observes the JSONL. The pty-manager shell-only whitelist is the architectural enforcement line.
2. **Server is stateless on transcript reads.** Client passes `?fromByte=<offset>&expectFingerprint=<fp>`; no per-session byte-offset cache lives server-side. Multi-tab works by construction.

## Structure
```
<repo-root>/
  CHANGELOG-unreleased.d/       # Keep-a-Changelog drop-zone for /shipwright-changelog (Added/Changed/Deprecated/Fixed/Removed/Security sub-dirs)
  docs/                         # User-facing guide (guide.md) — linked from "Key Environment Variables" below
  scripts/                      # install-windows.ps1, dev-restart.js
  server/                       # Hono backend (port 3847)
    src/
      index.ts                  # Server entry (~170 LOC — minimal wiring only)
      config.ts                 # Env config
      config/
        default-actions.json    # Shipwright phase + action catalog (Iterate 3)
      core/
        launcher.ts             # Copy-command generator (PS / cmd.exe / POSIX). Exports qPs/qCmd/qPosix for reuse. Iterate v2: optional slashCommand emits as trailing positional arg for phase-task launches.
        session-watcher.ts      # Filename-first JSONL discovery + byte-range reader
        session-parser.ts       # Typed events from raw JSONL + unknown-fallback
        inbox-derive.ts         # Pending tool_use extraction (best-effort)
        terminal-prompt-detect.ts # iterate-2026-05-18: extractTerminalPrompt — waiting AskUserQuestion picker detected from the live @xterm/headless mirror (a waiting picker never reaches the JSONL); /inbox emits it as the terminal_prompt kind
        sdk-sessions-store.ts   # Persistent task store (schemaVersion v1/v2/v3; projectId + iterate-v2 phaseTaskId/runId/parentRunMaster fields; findByPhaseTaskId() for idempotency)
        run-config-reader.ts    # Iterate v2: reads <project.path>/shipwright_run_config.json; per-row fault isolation + torn-read retry + 5s last-good cache. Read-only.
        cli-compat.ts           # Claude CLI version gate (MIN_SUPPORTED_CLI)
        project-manager.ts      # Project metadata CRUD (still used)
        profile-loader.ts       # Stack profile loading (wizard)
        project-actions-loader.ts  # mtime-cached resolver for .webui/actions.json → default-actions.json fallback (ADR-044)
        actions-substitute.ts   # placeholder substitution ({project.path}, {task.uuid}, …) w/ per-shell escape (ADR-044)
        preview-session-manager.ts # Preview subprocess lifecycle (spawn shell:false, keyed by projectId, kill-on-shutdown) (ADR-044)
        path-guard.ts           # Shared path-traversal guard (realpath + path.relative, NOT startsWith) for tree + file routes (ADR-044)
        gitignore-cache.ts      # mtime-keyed gitignore rule cache for FolderTree
      terminal/
        pty-manager.ts          # Embedded-terminal pty lifecycle: shell-only whitelist, idempotent ensure-or-create, writer/reader roles, backpressure, 30min idle ceiling, ScrollbackStore append on pty.onData (ADR-067, ADR-068-A1)
        routes.ts               # /api/terminal/:taskId/{ws,spawn,close,paste-image,append-gitignore,clear-scrollback}. WS upgrade is authoritative ensure-or-create; Origin gate = loopback CORS. WS onOpen replay = single `replay_snapshot` envelope; legacy chunked envelopes RETIRED (ADR-067, ADR-087)
        image-paste.ts          # savePastedImage / pruneKeepLastN / appendGitignoreLine — magic-byte mime sniff; realPathGuard; 8 MiB cap (ADR-067)
        scrollback-store.ts     # Disk-backed scrollback per-task `<registryDir>/terminal-scrollback/<taskId>.log` (rotated to .log.1 at 1 MiB). 4-state FSM, per-task PQueue, UUID validation + realpath-at-op-time + 0600/0700 perms, EBUSY rename retry, sweepExpired (TTL 1d). Disk content has no replay consumer post-Iterate-C (ADR-068-A1, ADR-087)
        boot-wipe.ts            # One-shot wipe of legacy *.log* at first boot post-deploy; `.iterate-c-wiped.marker` idempotency; snapshots preserved (ADR-087)
        headless-probe.ts       # Boot-time dynamic-import probe of @xterm/headless + addon-serialize; on failure downgrades headlessMirrorEnabledEffective=false (ADR-087 MEDIUM-B2)
        fixtures/               # claude-tui-scrollback.log — real-shell byte-stream fixture for snapshot validation (ADR-088)
      external/
        routes.ts               # /api/external/{tasks,launch,transcript,inbox,actions,preview,actions-stub,projects/:id/tree,projects/:id/file,projects/:id/run-config}
      middleware/
        error-handler.ts        # Centralized error response middleware
        logger.ts               # Request logging
      routes/
        projects.ts             # GET/POST/PATCH/DELETE /api/projects
        diagnostics.ts          # GET /api/diagnostics (CLI + launcher + sessions)
        settings.ts             # GET/PUT /api/settings
        profiles.ts             # GET /api/profiles
      lib/                      # Network-profile resolvers: resolveHonoHost / resolveTailscaleIp / resolveNetworkProfile / resolveTrustedOrigins / bind-errors
      test/                     # Cross-package-import guard (no-cross-package-imports.test.ts) + env-file-loading test
      types/                    # Shared TS shapes mirrored from client/src/types/ (task, settings, project, action-schema, run-config-v2) — see DO-NOT guard #7
    profiles/                   # Bundled stack profiles (snapshot of shipwright/shared/profiles/) — see "Profile resolution (post-split)" below
    scripts/                    # sdk-poc.ts, pwsh-baseline.mjs (sync-profiles helper, baseline probes)
    package.json
    tsconfig.json
  client/                       # React 19 / Vite 6 frontend
    e2e/                        # Playwright E2E specs (30/32/33/34/35)
    src/
      main.tsx
      App.tsx
      router.tsx                # react-router-dom route definitions
      layouts/                  # Layout shells (Main)
      pages/
        TaskBoardPage.tsx       # Task list + create (/)
        TaskDetailPage.tsx      # Three-pane shell (FolderTree / SmartViewer / EmbeddedTerminal); header-level state-dependent Launch/Resume CTA; hosts LaunchCoordinatorContext + SessionMetadata + BubbleTranscript
        ProjectsPage.tsx        # Project registry + wizard
        InboxPage.tsx           # Pending interactions (best-effort)
        DiagnosticsPage.tsx     # CLI + launcher + sessions snapshot
        SettingsPage.tsx        # Minimal stub (settings moved into user's Claude client)
      components/
        external/
          BubbleTranscript.tsx       # Chat-style transcript (replaces TranscriptViewer)
          MarkdownText.tsx           # react-markdown wrapper (XSS-safe + code cap)
          ToolOutputBlock.tsx        # ANSI-stripped tool output
          TerminalLaunchButton.tsx   # Shared launch CTA (compact / primary / inline)
          EditableTaskTitle.tsx      # In-place title edit on TaskDetail
          TaskCard.tsx               # TaskBoard card (state icon + menu + launch)
          ConfirmDeleteDialog.tsx    # Delete confirm for non-terminal states
          SessionMetadata.tsx        # State badge + UUID + cwd + timestamps
          EditTaskModal.tsx          # iterate-2026-05-18: re-edit task fields; lifecycle-gated (launch-shaping fields freeze once started)
          TaskDescriptionDisclosure.tsx  # iterate-2026-05-18: collapsible read-only description block in TaskDetailHeader
          # Iterate 3 additions (LaunchRow + CopyCommandCard were removed — replaced by header-level state-dependent CTA):
          FolderTree.tsx             # Lazy-expand gitignore-aware tree (left pane of TaskDetail)
          SmartViewer/               # Right pane of TaskDetail — 5 renderers (Markdown/Code/Text/Image/Mermaid; mermaid lazy-imported, 609 KB chunk)
          NewIssueModal.tsx          # Shared New-* modal body (Pipeline / Iterate / Task variants)
          PreviewButton.tsx          # Dev-server spawn trigger; visibility-gated by profile.stack.frontend
          CreateMenuSplitButton.tsx  # Sidebar "+ New ▾" split-button (Pipeline / Iterate / Task / Continue Pipeline)
          TaskDetailThreePane.tsx    # react-resizable-panels wrapper; persists widths + collapsed state in localStorage
          # iterate/multi-session-run-orchestrator-v2 additions:
          MasterTaskCard.tsx         # One card per Run (run-config v2). Children list + state-conditional banners (failed / needs_validation / complete / stale).
          ContinuePipelineModal.tsx  # "+ New ▾ → Continue Pipeline" target. Picker for readyToLaunchTasks[]; delegates to useContinuePipeline.
          CopySnippet.tsx            # Small monospace snippet + copy button (used for `recover-phase-task` snippets).
        terminal/
          EmbeddedTerminal.tsx       # xterm.js panel lazy-loaded into TaskDetailPage. forwardRef → focus/ready/role. DOM paste-handler (capture phase) image-wins precedence (paste-image route for images, socket.send for text). Resize throttled 250ms. Consumes LaunchCoordinatorContext.pendingLaunch + auto-execute WS data-frame after prompt-readiness handshake. `onReplaySnapshot` writes once via term.reset+write+scrollToBottom (ADR-067, ADR-068-A1, ADR-087)
        common/
          DiagnosticsBanner.tsx # Warns when CLI < MIN_SUPPORTED_CLI
        sidebar/                # Sidebar navigation
        wizard/                 # Project Wizard (4-step modal)
        settings/               # ActionsConfigCard.tsx — Settings-page actions config UI
        triage/                 # Triage Tab: TriageItemCard / TriageDetailModal / PromoteModal / LaunchPayloadBlock / TriageBadgeUI. Read-only view of .shipwright/triage.jsonl; promote → ExternalTask, dismiss/snooze → status events. `<LaunchPayloadBlock>` renders producer-generated `launchPayload` with control-chars stripped via `lib/launchPayload.ts` (Python-canonical, byte-equal parity fixture); **Fix now** copies cleaned payload to clipboard. Missing/empty payload → loud-failure placeholder. All fields plain text (ADR-101, ADR-110)
      external/
        session-parser.ts       # Client-side parser (typed events for rendering)
      hooks/                    # TanStack Query + polling hooks; useTerminalSocket = WS bridge for EmbeddedTerminal (ws/wss inferred, ready handshake, reconnect backoff). Single `replay_snapshot` envelope; stale-server chunked frames silently dropped (ADR-067, ADR-087)
      lib/                      # externalApi.ts + utilities
      contexts/                 # React contexts. LaunchCoordinatorContext (scoped to TaskDetailPage) — pendingLaunch token + dispatchAutoLaunch/cancelLaunch/consumeLaunch (ADR-068-A1)
      stores/                   # Zustand stores (chatStore, turnStatusStore)
      test/                     # Vitest test utilities
      types/                    # Shared TypeScript types
    index.html
    vite.config.ts
    package.json
    tsconfig.json
```

## HOW

### Development

This repo has **no root `package.json`** — `server/` and `client/` are independent workspaces. Run each in its own terminal:

```bash
# Install (once)
cd server && npm install
cd client && npm install

# Terminal 1 — Hono backend (tsx watch, port 3847)
cd server && npm run dev

# Terminal 2 — Vite client (port 5173 by default, proxies /api to 3847)
cd client && npm run dev
```

Other scripts (run from the respective subdir):

```bash
npm run build                 # Production build
npm run test                  # Vitest
npm run test:e2e              # Playwright (client only)
npm run lint                  # oxlint (client + server)
npm run typecheck             # tsc --noEmit
```

### Key Environment Variables
```
PORT=3847                     # Hono server port (override via env)
VITE_PORT=5173                # Vite dev server port (override via env)
```

Default is a single dev-server stack. For parallel worktrees set both vars explicitly — see [shipwright docs/guide.md §8.5 "Parallel Development with Worktrees"](https://github.com/svenroth-ai/shipwright/blob/main/docs/guide.md#85-parallel-development-with-worktrees). The Vite proxy reads `PORT` at startup so `/api` routes to the matching Hono instance.

### Profile resolution (post-split)

This repo ships bundled stack profiles at `server/profiles/`. The loader
(`server/src/core/profile-loader.ts`) resolves in this order:

1. `SHIPWRIGHT_PROFILES_DIR` — explicit override.
2. `SHIPWRIGHT_MONOREPO_PATH` + `/shared/profiles` — dev-loop helper for
   when you're iterating on the shipwright monorepo and want live edits
   to take effect without re-syncing the snapshot.
3. Bundled `server/profiles/` (default).

The snapshot is a copy of `shipwright/shared/profiles/`. Refresh via
`npm run sync-profiles` (from `server/`) or copy manually. See
`server/profiles/README.md`.

### Conventions
- TypeScript strict mode everywhere.
- Hono routes in `server/src/routes/`, one file per resource. External-launch routes live at `server/src/external/routes.ts`.
- React components in `client/src/components/`, grouped by UI area.
- TanStack React Query for data fetching + sequential polling for transcript updates.
- TailwindCSS 4 for styling, Radix UI for accessible primitives.
- Files under 300 lines — split if larger.
- Conventional Commits (feat:, fix:, refactor:, test:, docs:, chore:).

### Architecture rules (post-Plan-D'' + Iterate 2)
1. **Webui never spawns Claude.** `core/launcher.ts` produces command strings; the embedded-terminal pane auto-executes them via a client-side WS data-frame after an explicit Launch / Resume / Relaunch click (ADR-068-A1), or the user copies and runs them in their own terminal. The pty-manager shell-only whitelist (ADR-067) is the architectural enforcement line. Regression guard: Playwright spec `35-no-chat-panel.spec.ts`.
2. **Task state is derived from `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` + the persistent store.** Session UUID is pre-bound at task creation via `crypto.randomUUID()`.
3. **Discovery is filename-first.** `<uuid>.jsonl` is the primary match (PoC finding 1); first-line sessionId is a secondary sanity check.
4. **Transcript endpoint is stateless.** `GET /api/external/tasks/:id/transcript?fromByte=<n>&expectFingerprint=<fp>` — multi-tab support comes for free.
5. **UTF-8-safe chunking.** Server reads are cut on `\n` boundaries only.
6. **Torn-read retry budget.** `core/session-watcher.ts` retries EBUSY/EPERM/EACCES/ENOENT up to 6 attempts with 50→1600 ms backoff.
7. **No SSE for transcript.** Sequential 1 s polling on the client via `useTaskTranscript`.
8. **No chokidar.** Heartbeat-free; watcher state is derived on demand from mtime probes.
9. **Plugin dirs must be re-passed on every launch.** `--plugin-dir` does not reliably survive `--resume`.
10. **MIN_SUPPORTED_CLI is pinned.** See `core/cli-compat.ts`. Anything older shows a banner via `/api/diagnostics`.

### Preview-capability precedence (Iterate 3, plan § 2.1)

Iterate 3 introduces a Preview dev-server spawn path (not Claude — see ADR-044). Three sources interact:

1. **Profile `stack.frontend` presence** — the capability gate (is this project a frontend project at all?).
2. **Profile `dev_server.command`** — the spawn target (which command actually starts the dev-server).
3. **`.webui/actions.json` → `actions.preview.enabled`** — the policy override (user-level opt-out).

`stack.frontend` AND `dev_server.command` must both be present for `<PreviewButton>` to render. `actions.preview.enabled = false` hides it regardless. Boot-time coherence check warns when `stack.frontend` is set but `dev_server.command` is missing (button would render, spawn would 500). The full diagram lives in [`.shipwright/agent_docs/architecture.md`](.shipwright/agent_docs/architecture.md).

### DO-NOT regression guards (Iterate 2 / ADR-035)
1. **DO NOT write into Claude's JSONL files under `~/.claude/projects/`.** Webui is a read-only polling observer of that directory. Title sync uses Claude's first-party `--name` CLI flag at launch time, not JSONL mutation or a sidecar file.
2. **Auto-scroll pattern is CSS-first.** `overflow-anchor: auto` + `scroll-padding` on the scroll container is the primary path. `useAutoScroll` (ResizeObserver-light, ref-based, ~50 LOC) is the safety net for Chrome+polling cases. Do NOT reach for stale libraries like `react-scroll-to-bottom`. See ADR-035.
3. **DO NOT re-introduce a chat composer.** External-launch architecture is load-bearing. See ADR-034. Spec 35 fails the build if a chat-* surface re-appears.
4. **DO NOT re-add `@assistant-ui/*` packages.** Rendering is bespoke via `react-markdown` + `remark-gfm` + `rehype-highlight` + `strip-ansi`. The full stack is in `client/package.json` already.
5. **DO NOT run `claude --resume <uuid>` as a webui-initiated side-effect command** while the user's session may be active in their terminal. SQLite lock + JSONL interleave risk (EBUSY on Windows). Title updates take effect on next user-initiated launch only.
6. **Multi-writer state files** (`sdk-sessions.json`, any future sidecars) MUST use `proper-lockfile`, not just temp-file + rename. The PATCH /tasks/:id endpoint surfaces ELOCKED as 409 so the client can retry instead of silently overwriting.
7. (ADR-080) **Type-system isolation between workspaces.** Server and client are independent npm workspaces (no root `package.json`); `server/tsconfig.json` enforces `rootDir: ./src`, so cross-package imports break `tsc`. Shared shapes (`Task`, `GlobalSettings`, `Project`) live in `server/src/types/` as verbatim mirrors of `client/src/types/*.ts`; each header names its canonical origin. Drift caught by `action-schema-sync.test.ts` (content-parity) + `no-cross-package-imports.test.ts` (regex sweep). DO NOT add cross-package imports as a shortcut.
8. (ADR-044) **Schema v2 is write-on-touch.** `sdk-sessions.json` v1 rows load as `projectId: "unassigned"` in memory and rewrite to v2 on next mutation. DO NOT batch-rewrite on boot (ADR-038 explicitly rejected). `schemaVersion` header field must load both v1 and v2 during forward-compat window.
9. (ADR-044) **Preview spawn uses `shell: false`.** User-controlled `dev_server.command` + `shell: true` would be command-injection. All Preview subprocess entrypoints flow through `core/preview-session-manager.ts`. DO NOT add a parallel spawn path.
10. (ADR-044) **Path-guard is `realpath + path.relative`, NOT `startsWith`.** Symlinks, unicode, Windows junctions defeat prefix checks. All tree + file routes share `core/path-guard.ts`; null-byte input hard-rejected.
11. (ADR-044) **DO NOT hardcode `shipwright-run` / `shipwright-iterate` / phase strings (`build`, `plan`, `design`, …) in components** — read from `/api/external/projects/:id/actions`. Meta-test `client/src/test/doc-sync.test.ts` keeps this file-map honest.
12. **DO NOT write into the user's `shipwright_run_config.json`.** WebUI is a read-only observer of run-config. Framework orchestrator owns every mutation; webui write surface is only `sdk-sessions.json` + `.webui/actions.json` stub creation. All consumption flows through `core/run-config-reader.ts` (server) / `useRunConfig()` (client).
13. **Phase-task launches must use the pre-bound `sessionUuid` from run-config — never re-generate.** `/launch` `phaseTaskRef` branch re-reads run-config server-side and rejects mismatched uuids (`409 phase_task_session_uuid_mismatch`). Client never sends `sessionUuid`/`slashCommand` directly; only `phaseTaskRef.phaseTaskId`. `phaseTaskRef` + `actionId` are mutually exclusive (`400 mixed_launch_intents`).
14. **All pipeline-continuation entry points share `useContinuePipeline()`.** Master TaskCard CTA + Continue Pipeline modal + future TaskDetail header all funnel through the single hook so re-fetch + idempotent shadow-task lookup + verified launch happen atomically. Parallel launch paths bypass the staleness re-check.
15. **Schema v3 is additive + write-on-touch.** `sdk-sessions.json` gains optional `phaseTaskId` / `runId` / `parentRunMaster`. Loader accepts v1+v2+v3; persist always writes v3. DO NOT batch-rewrite on boot.
16. **Stale `in_progress` detection uses run-config timestamps only.** `phase_task.startedAt` / `claimAttemptedAt` against `config.updated_at` — never JSONL mtime.
17. (ADR-067) **pty-manager spawn target MUST be a whitelisted shell binary** (`pwsh / powershell.exe / cmd.exe / bash / zsh / sh / fish`); never `claude`. Basename-normalised whitelist match + WS-upgrade Origin gate (loopback-only) = Plan-D″ enforcement. `paste-image` / `append-gitignore` MUST flow through `realPathGuard`. 8 MiB image cap + 9 MiB Content-Length precheck + magic-byte mime sniff are non-negotiable. Image-paste uses `quotePathForShell` for paths with spaces. WS upgrade is the AUTHORITATIVE pty creation path; `POST /spawn` is idempotent prewarm only.
18. (ADR-068-A1) **Scrollback path-guard is `realpath` AT EVERY OPERATION** (not just boot-time). UUID `/^[0-9a-fA-F-]{36}$/` validated on every public `ScrollbackStore` method. File-naming: `<taskId>.log` (NOT sessionUuid — multi-launch + resume + fork share one task). Rotate/read/clear/closeStream go through per-task `PQueue`; append uses WriteStream's own serialization. Rotation 4-state FSM (NORMAL → ROTATING → ROTATION_FLUSH → NORMAL); overflow during rotation throws (cap 4 MiB). Replay-on-attach uses `pty.pause/resume` — NEVER drop chunks (ANSI/UTF-8 corruption). POST `/close` keeps scrollback; `/clear-scrollback` is the destructive path.
19. (ADR-068-A1) **Auto-execute is via CLIENT-SIDE WS data-frame, NOT server-side `pty.write`.** `LaunchCoordinatorContext.dispatchAutoLaunch(commands, resume)` queues a `pendingLaunch` token; `EmbeddedTerminal` consumes it via `consumedTokens` dedup and sends `socket.send({type:"data", …})` once `role === "writer"` AND prompt-readiness handshake clears (250ms quiesce, 3s cap). Launch command built EXCLUSIVELY by `core/launcher.ts buildCopyCommands()`; `.webui/actions.json` is NOT consumed in the auto-launch path. Pending-launch is cancelled on role-loss, unmount, or 30s timeout. The explicit Launch/Resume/Relaunch CTA click satisfies the Plan-D″ "user-initiated" clause; pty-manager whitelist remains the architectural enforcement line.
20. (ADR-087, amended by ADR-097) **Cell-state snapshots are the SOLE replay primitive.** Server emits exactly ONE `replay_snapshot` envelope per WS attach (or zero when no snapshot exists). Legacy chunked envelopes (`replay_start/chunk/separator/end`) are RETIRED in routes.ts + useTerminalSocket.ts; client silently drops stale-server chunked frames. ADR-069/077/079/086 superseded. Failure mode (no snapshot / version mismatch / `@xterm/headless` import fails): blank terminal with live shell. DO NOT re-introduce any compensation, fallback chunked path, or dual-accept loader without fresh M2 fixed-point re-verify. DELETE `/tasks/:id` cascade-clears scrollback + snapshot (privacy boundary, MEDIUM-B1). Boot-time one-shot wipe of legacy `*.log*` gated by `.iterate-c-wiped.marker`. **Full detail:** [.shipwright/planning/adr/087-cell-state-snapshot-iterate-c.md](.shipwright/planning/adr/087-cell-state-snapshot-iterate-c.md) + [088-headless-mirror-iterate-a.md](.shipwright/planning/adr/088-headless-mirror-iterate-a.md).
21. (ADR-092) **WS replay precedence is LIVE-mirror FIRST, disk-snapshot FALLBACK.** `routes.ts` calls `serializeMirrorIfLive(taskId)` first; only on null falls back to `tryReadSnapshot(taskId)`. Disk-first inversion REJECTED (disk holds stale state if last-detach flushed and shell kept producing). **Snapshot-on-detach uses `detachAndCount(taskId, conn)` atomically** — when `remainingAttachCount === 0`, `void ptyManager.flushMirrorSnapshot(taskId)` fires (fire-and-forget). DO NOT split the count check across detach (race-vulnerable to concurrent attach). DO NOT call `mirror.dispose()` from `flushMirrorSnapshot` — pty must stay alive for subsequent `pty.onData`. Regression-guard: `v0-9-6-live-pty-replay.spec.ts` hard-asserts outcome A.
22. (ADR-097 + ADR-098) **xterm.js + paired addons are exact-pinned to 6.0.0** — `@xterm/xterm` / `@xterm/addon-fit` 0.11.0 / `@xterm/addon-web-links` 0.12.0 / `@xterm/addon-webgl` 0.19.0 (client) and `@xterm/headless` 6.0.0 / `@xterm/addon-serialize` 0.14.0 (server). NO caret ranges (client/server skew breaks the version-gate). **Snapshot envelope is v2**; loader rejects v1 with `SnapshotStoreError("unknown_version", …)` and falls back to "no replay" (blank terminal + live shell, per ADR-087). DO NOT re-introduce v1 acceptance without a fresh M2 fixed-point re-verify. **`CLAUDE_CODE_NO_FLICKER` default is ON** (opt-out only via literal `SHIPWRIGHT_TERMINAL_NO_FLICKER=0`); DO NOT revert to default-OFF without empirical proof that Claude Code emits DECSET 2026 in the main buffer (Issue #37283 still open). DO NOT add `windowsMode` to the `EmbeddedTerminal` Terminal options (removed in 6.x). Iterate H's 60% preservation heuristic in `finalizeMirrorSnapshot` is RETAINED as defense-in-depth.

### Title integration (`--name`)

Webui owns the task title in `sdk-sessions.json`. Every launch command (initial OR resume) emits `--name "<title>"` after `--session-id` / `--resume`. Claude pre-seeds the picker title from this flag and produces `custom-title` + `agent-name` events in the JSONL. There is no mid-session sync. Renames take effect on the NEXT user-initiated launch — see `core/launcher.ts`, `external/routes.ts` PATCH handler, and `client/src/components/external/EditableTaskTitle.tsx`.

### Dev-server troubleshooting

If recent code changes don't show up in the running webui, `tsx watch` has
probably gone stale on Windows. Kill the PID on :3847 explicitly:

```bash
# Windows:
netstat -ano | findstr :3847
taskkill //F //PID <pid>
cd server && npm run dev
```

If `npm run dev` fails with `EADDRINUSE`, another worktree's dev server may
be running on the same port. Since v0.3.2 the Hono server exits with a
deterministic operator message:

```
FATAL: Port 3847 is in use. Override via PORT=<other> or stop the
existing process (e.g. "npm run dev:fresh" or netstat/taskkill).
```

`EACCES` and `EADDRNOTAVAIL` get analogous loud messages. Vite already
fails loud via `strictPort: true` in `client/vite.config.ts` — so both
halves of the stack now refuse to silently half-start.

`npm run dev:fresh` (the dev-restart.js helper) reads `PORT` and
`VITE_PORT` from the environment. Kill scope is limited to the two
configured ports — it never reaches beyond them. The historic
`VITE_ALT_PORT=5177` hardcode was removed in v0.3.2 because it broke the
per-worktree contract; if you happen to run Vite on 5177, set
`VITE_PORT=5177` explicitly.
