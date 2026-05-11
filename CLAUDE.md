# Shipwright Command Center (WebUI)

## WHAT
- **Purpose**: Local web application for managing multiple Shipwright SDLC projects in parallel.
- **Architecture**: Hono backend (Node.js) + React 19 frontend (Vite 6), monorepo in `webui/`. **External-launch model (Plan D'' variant a, 2026-04-19)**: webui owns no Claude subprocess. The user runs Claude Code in their own terminal via a pre-bound `--session-id <uuid>` copy-command; webui observes the resulting JSONL at `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`.
- **Stack**: TypeScript strict, Hono, React 19, Vite 6, TailwindCSS 4, Radix UI, TanStack React Query.

## Architecture reference

Plan of record: [`~/.claude/plans/plan-d-double-prime-external-launch.md`](../.claude/plans/plan-d-double-prime-external-launch.md).
PoC findings that shaped the implementation: [`~/.claude/plans/external-launch-poc-results.md`](../.claude/plans/external-launch-poc-results.md).
Decision record: `agent_docs/decision_log.md` ADR-034.

Two hard rules, survivors of every review round:
1. **Webui spawns no Claude process directly.** Users launch in their own terminal (or in the embedded-terminal pane added by ADR-067); webui observes the JSONL. Webui MAY host a neutral shell pane (xterm.js + node-pty) — Claude execution within that pane stays user-initiated (User must press Strg+V then Enter). The pty-manager whitelist enforces shell-only spawn targets.
2. **Server is stateless on transcript reads.** Client passes `?fromByte=<offset>&expectFingerprint=<fp>`; no per-session byte-offset cache lives server-side. Multi-tab works by construction.

## Structure
```
<repo-root>/
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
        sdk-sessions-store.ts   # Persistent task store (schemaVersion v1/v2/v3; projectId + iterate-v2 phaseTaskId/runId/parentRunMaster fields; findByPhaseTaskId() for idempotency)
        run-config-reader.ts    # Iterate v2: reads <project.path>/shipwright_run_config.json; per-row fault isolation + torn-read retry + 5s last-good cache. Read-only.
        cli-compat.ts           # Claude CLI version gate (MIN_SUPPORTED_CLI)
        project-manager.ts      # Project metadata CRUD (still used)
        profile-loader.ts       # Stack profile loading (wizard)
        project-actions-loader.ts  # Iterate 3: mtime-cached resolver for .webui/actions.json → default-actions.json fallback
        actions-substitute.ts   # Iterate 3: placeholder substitution ({project.path}, {task.uuid}, …) w/ per-shell escape
        preview-session-manager.ts # Iterate 3: Preview subprocess lifecycle (spawn shell:false, keyed by projectId, kill-on-shutdown)
        path-guard.ts           # Iterate 3: shared path-traversal guard (realpath + path.relative, NOT startsWith) for tree + file routes
        gitignore-cache.ts      # Iterate 3: mtime-keyed gitignore rule cache for FolderTree
      terminal/
        pty-manager.ts          # Iterate 4 (ADR-067) + Iterate 5 (ADR-068-A1): Embedded-terminal pty lifecycle (Plan-D''-conform shell-only whitelist; idempotent ensure-or-create; writer/reader attach roles; drop-while-saturated backpressure; 30 min idle ceiling; quotePathForShell helper). Iterate 5: pty.onData synchronously appends to ScrollbackStore; closeStream lifecycle hook on kill; pty.pause/resume during replay-on-attach.
        routes.ts               # Iterate 4 (ADR-067) + Iterate 5 (ADR-068-A1) + Iterate C (ADR-087): /api/terminal/:taskId/{ws,spawn,close,paste-image,append-gitignore,clear-scrollback} — WS upgrade is the authoritative ensure-or-create entrypoint; Origin gate mirrors loopback CORS. Iterate C: WS onOpen replay is a SINGLE `replay_snapshot` envelope (cell-state from @xterm/headless mirror, ADR-088/089); the legacy chunked envelopes (replay_start/replay_chunk/replay_separator/replay_end) are RETIRED. POST /close = kill pty only (history retained); POST /clear-scrollback (loud throws on failure).
        image-paste.ts          # Iterate 4 (ADR-067): savePastedImage / pruneKeepLastN / appendGitignoreLine — magic-byte mime sniff; realPathGuard for symlink-safe writes; 8 MiB cap
        scrollback-store.ts     # Iterate 5 (ADR-068-A1) + Iterate C (ADR-087): Disk-backed scrollback. Per-task <registryDir>/terminal-scrollback/<taskId>.log (rotated to .log.1 at 1 MiB). 4-state rotation state-machine (NORMAL/ROTATING/ROTATION_FLUSH); per-task PQueue serializes rotate/read/clear. Iterate C retired the ADR-069 sanitizer + ADR-077 replay-time collapse + readForReplay() — disk content is now raw pty bytes with no replay consumer. UUID validation + realpath-at-op-time + 0600/0700 perms (POSIX) + StringDecoder UTF-8-safe reads + Windows-EBUSY rename retry + sweepExpired (TTL 1 day default, active-task-aware skip, bounded).
        boot-wipe.ts            # Iterate C (ADR-087): one-shot wipe of legacy *.log* at first boot post-deploy. Idempotency marker `.iterate-c-wiped.marker`. Snapshot files (.snapshot) preserved. Best-effort; boot continues on failure.
        headless-probe.ts       # Iterate C (ADR-087, MEDIUM-B2): pre-probes @xterm/headless + @xterm/addon-serialize via dynamic import at boot. On failure downgrades headlessMirrorEnabledEffective=false (graceful fallback, no crash).
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
        TaskDetailPage.tsx      # LaunchRow + CopyCommandCard + SessionMetadata + TranscriptViewer
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
          EmbeddedTerminal.tsx       # Iterate 4 (ADR-067) + Iterate 5 (ADR-068-A1): xterm.js panel hosted in TaskDetailPage. Lazy-loaded. forwardRef exposes focus()/ready/role. DOM paste-handler (capture phase) implements image-wins precedence; calls /api/terminal/:taskId/paste-image for image clipboards, falls through to socket.send({type:"data"}) for text. Resize via ResizeObserver throttled to 250 ms. Iterate 5: consumes LaunchCoordinatorContext.pendingLaunch + sends auto-execute via WS data-frame after prompt-readiness handshake (250ms quiesce, 3s cap); consumedTokens dedup; about-to-run preview disclosure banner.
        common/
          DiagnosticsBanner.tsx # Warns when CLI < MIN_SUPPORTED_CLI
        sidebar/                # Sidebar navigation
        wizard/                 # Project Wizard (4-step modal)
      external/
        session-parser.ts       # Client-side parser (typed events for rendering)
      hooks/                    # TanStack Query + polling hooks; useTerminalSocket (ADR-067 — WS bridge for EmbeddedTerminal, ws/wss inferred, ready handshake, reconnect backoff). Iterate C (ADR-087): single `replay_snapshot` envelope (cell-state); the legacy chunked envelopes (replay_start/replay_chunk/replay_separator/replay_end) are RETIRED — incoming stale-server frames are silently dropped.
      lib/                      # externalApi.ts + utilities
      contexts/                 # React contexts. Iterate 5 (ADR-068-A1): LaunchCoordinatorContext (scoped to TaskDetailPage) — pendingLaunch token + dispatchAutoLaunch/cancelLaunch/consumeLaunch; replaces window.dispatchEvent(webui:launch-copied).
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
npm run lint                  # ESLint
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
1. **Webui never spawns Claude.** Launchers produce command strings; the user pastes them. Regression guard: Playwright spec `35-no-chat-panel.spec.ts`.
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

`stack.frontend` AND `dev_server.command` must both be present for `<PreviewButton>` to render. `actions.preview.enabled = false` hides it regardless. Boot-time coherence check warns when `stack.frontend` is set but `dev_server.command` is missing (button would render, spawn would 500). The full diagram lives in [`agent_docs/architecture.md`](agent_docs/architecture.md).

### DO-NOT regression guards (Iterate 2 / ADR-035)
1. **DO NOT write into Claude's JSONL files under `~/.claude/projects/`.** Webui is a read-only polling observer of that directory. Title sync uses Claude's first-party `--name` CLI flag at launch time, not JSONL mutation or a sidecar file.
2. **Auto-scroll pattern is CSS-first.** `overflow-anchor: auto` + `scroll-padding` on the scroll container is the primary path. `useAutoScroll` (ResizeObserver-light, ref-based, ~50 LOC) is the safety net for Chrome+polling cases. Do NOT reach for stale libraries like `react-scroll-to-bottom`. See ADR-035.
3. **DO NOT re-introduce a chat composer.** External-launch architecture is load-bearing. See ADR-034. Spec 35 fails the build if a chat-* surface re-appears.
4. **DO NOT re-add `@assistant-ui/*` packages.** Rendering is bespoke via `react-markdown` + `remark-gfm` + `rehype-highlight` + `strip-ansi`. The full stack is in `client/package.json` already.
5. **DO NOT run `claude --resume <uuid>` as a webui-initiated side-effect command** while the user's session may be active in their terminal. SQLite lock + JSONL interleave risk (EBUSY on Windows). Title updates take effect on next user-initiated launch only.
6. **Multi-writer state files** (`sdk-sessions.json`, any future sidecars) MUST use `proper-lockfile`, not just temp-file + rename. The PATCH /tasks/:id endpoint surfaces ELOCKED as 409 so the client can retry instead of silently overwriting.
7. **Type-system isolation between workspaces.** Server and client are independent npm workspaces (no root `package.json`); `server/tsconfig.json` enforces `rootDir: ./src`, so cross-package imports of the form `from "../../../client/..."` break `tsc`. Shared shapes (`Task`, `GlobalSettings`, `Project`) live in `server/src/types/` as verbatim mirrors of `client/src/types/*.ts`; each header names its canonical origin. Drift is caught by two complementary tests: `server/src/types/action-schema-sync.test.ts` (content-parity for `action-schema.ts` fields) and `server/src/test/no-cross-package-imports.test.ts` (comment-aware regex sweep rejecting `from "../../../client/..."`, `import("../../../client/...")`, and any-depth relative re-exports). The prior "4 baseline errors tracked, no-regression" policy (ADR-035 § Consequences) is RETIRED — `npm run build` exits 0. Do NOT add cross-package imports as a shortcut. See ADR-080.
8. (Iterate 3 — ADR-044) **Schema v2 is write-on-touch.** `sdk-sessions.json` v1 rows load as `projectId: "unassigned"` in memory and rewrite to v2 on next mutation. DO NOT batch-rewrite on boot — ADR-038 explicitly rejected that path. The `schemaVersion` header field must load both v1 and v2 during the forward-compat window.
9. (Iterate 3 — ADR-044) **Preview spawn uses `shell: false`.** User-controlled `dev_server.command` strings + `shell: true` would be command-injection. All Preview subprocess entrypoints flow through `core/preview-session-manager.ts`, which tokenizes the command and spawns with `shell: false`. DO NOT add a parallel spawn path.
10. (Iterate 3 — ADR-044) **Path-guard is `realpath + path.relative`, NOT `startsWith`.** Symlinks, unicode, and Windows junction points defeat prefix checks. All tree + file routes share `core/path-guard.ts`; null-byte input is hard-rejected.
11. (Iterate 3 — ADR-044) **DO NOT hardcode `shipwright-run` / `shipwright-iterate` / phase strings (`build`, `plan`, `design`, …) in components** — read from `/api/external/projects/:id/actions`. Violations re-introduce the configurability debt iterate 3 paid down and will cause custom `.webui/actions.json` installations to break silently. Meta-test `client/src/test/doc-sync.test.ts` keeps this file-map honest; grep your component for `shipwright-` literals before committing.
12. (iterate/multi-session-run-orchestrator-v2) **DO NOT write into the user's `shipwright_run_config.json`.** WebUI is a read-only observer of run-config. The framework's orchestrator owns every mutation; the only webui write surface remains `sdk-sessions.json` + `.webui/actions.json` stub creation (existing). All run-config consumption flows through `core/run-config-reader.ts` (server) and `useRunConfig()` (client).
13. (iterate/multi-session-run-orchestrator-v2) **Phase-task launches must use the pre-bound `sessionUuid` from the run-config — never re-generate.** The `/launch` route's `phaseTaskRef` branch re-reads run-config server-side and rejects mismatched session-uuids (`409 phase_task_session_uuid_mismatch`). The client never sends `sessionUuid` / `slashCommand` directly; only `phaseTaskRef.phaseTaskId`. Also: `phaseTaskRef` and `actionId` are mutually exclusive (`400 mixed_launch_intents`).
14. (iterate/multi-session-run-orchestrator-v2) **All pipeline-continuation entry points share `useContinuePipeline()`.** Master TaskCard CTA + Continue Pipeline modal + future TaskDetail header all funnel through the single hook so re-fetch + idempotent shadow-task lookup + verified launch happen as one atomic unit. Adding a parallel launch path bypasses the staleness re-check and re-introduces the race the architecture closes.
15. (iterate/multi-session-run-orchestrator-v2) **Schema v3 is additive + write-on-touch.** `sdk-sessions.json` gains optional `phaseTaskId` / `runId` / `parentRunMaster` fields. Loader accepts v1 + v2 + v3; persist always writes v3. Same forward-compat window as ADR-038. DO NOT batch-rewrite on boot.
16. (iterate/multi-session-run-orchestrator-v2) **Stale `in_progress` detection uses run-config timestamps only.** `phase_task.startedAt` / `claimAttemptedAt` against `config.updated_at` — never JSONL mtime. WebUI must not depend on observing JSONL files for tasks it doesn't own a shadow of.
17. (Iterate 4 — ADR-067) **pty-manager spawn target MUST be a whitelisted shell binary** (`pwsh / powershell.exe / cmd.exe / bash / zsh / sh / fish`); never `claude`. Whitelist match is basename-normalised so absolute paths are checked correctly. Plan-D'' compliance lives in this whitelist + the WS-upgrade Origin gate (loopback-only, mirrors the existing CORS posture). `paste-image` and `append-gitignore` endpoints MUST flow through `realPathGuard` on the resolved target (defeats symlinked `.gitignore` redirect attempts). 8 MiB image cap + 9 MiB Content-Length precheck + magic-byte mime sniff are non-negotiable. Image-paste pty.write uses `quotePathForShell(absPath, shellKind)` so paths with spaces (`C:\My Project\img.png`) round-trip cleanly. WS upgrade is the AUTHORITATIVE pty creation path — `POST /spawn` is an idempotent prewarm, never a parallel-creation surface.
18. (Iterate 5 — ADR-068-A1) **Scrollback path-guard is `realpath` AT EVERY OPERATION (not just boot-time `realPathGuard(dir)`).** UUID format `/^[0-9a-fA-F-]{36}$/` is validated on every public ScrollbackStore method (`invalid_task_id` thrown otherwise). File-naming is `<taskId>.log` per Decision #14 (task-id keying = "shell history for this task entity") — DO NOT key by sessionUuid (multi-launch + resume + fork all share one task). Append is NOT mutex-locked (WriteStream serializes itself); rotate/read/clear/closeStream go through per-task `PQueue`. Rotation has 4 states (NORMAL → ROTATING → ROTATION_FLUSH → NORMAL); appends during rotation land in `rotationBuffer` (cap 4 MiB; overflow throws). Replay-on-attach uses `pty.pause()` / `pty.resume()` — NEVER drop chunks (ANSI/UTF-8 corruption). Privacy disclosure UI surfaces 24h TTL + Windows-permission-best-effort note + "may contain secrets" warning. POST `/close` semantics changed: kill pty only, scrollback retained; separate POST `/clear-scrollback` (loud throws) for destructive clear with confirm-modal.
19. (Iterate 5 — ADR-068-A1) **Auto-execute is via CLIENT-SIDE WS data-frame, NOT server-side `pty.write`.** `LaunchCoordinatorContext.dispatchAutoLaunch(commands, resume)` (NEW, replaces `window.dispatchEvent("webui:launch-copied")`) queues a `pendingLaunch` token; `EmbeddedTerminal` consumes it via `consumedTokens: Set<number>` (StrictMode + reconnect dedup) and sends `socket.send({type:"data", payload: commands[shellKind] + "\r"})` once `socket.ready && socket.role === "writer"` AND the prompt-readiness handshake clears (`dataSeenInitially === true && Date.now() - lastPtyDataAt >= 250ms`, hard cap 3s). The launch command is built EXCLUSIVELY by `core/launcher.ts buildCopyCommands()` (shell-quoting via `qPs/qCmd/qPosix`); `.webui/actions.json` is NOT consumed in the auto-launch path (custom actions go through `preview-session-manager.ts shell:false`). Pending-launch is cancelled in 3 paths: `role !== "writer"` after WS handshake, TaskDetailPage unmount, 30s timeout. CTA disabled while `launchMut.isLoading || pendingLaunch !== null` (rapid-click queue depth 1). Plan-D'' "user-initiated"-Klausel from ADR-067 is amended: an explicit click on `Launch` / `Resume` / `Relaunch` CTA satisfies user-initiated; pty-manager whitelist remains the architectural enforcement line.
20. (Iterate C — ADR-087) **Cell-state snapshots are the SOLE replay primitive.** Server emits exactly one `replay_snapshot` envelope per WS attach (or zero envelopes when no snapshot exists). The legacy chunked envelopes `replay_start` / `replay_chunk` / `replay_separator` / `replay_end` are RETIRED — `server/src/terminal/routes.ts` no longer emits them, the `sendReplayChunked` helper is gone, `ScrollbackStore.readForReplay()` is gone, and `client/src/hooks/useTerminalSocket.ts` silently drops any stale-server chunked frames. ADR-069 sanitizer, ADR-077 collapse + footer, ADR-079 pushdown, and ADR-086 skip-for-new-plain are all retired (their decision-log entries marked Superseded by ADR-087). Failure mode when no snapshot exists (missing on disk, version mismatch, `@xterm/headless` import failure via `headless-probe.ts`): client gets a blank terminal with live shell — the deliberate trade-off. DO NOT re-introduce any of the four compensations OR a fallback chunked path; the snapshot path was empirically validated against the real Claude TUI scrollback in ADR-088 + ADR-089. DELETE `/tasks/:id` cascade-clears BOTH scrollback files AND the cell-state snapshot file (privacy boundary, MEDIUM-B1 fix). Boot-time one-shot wipe of legacy `*.log*` files runs once per post-Iterate-C-deploy server lifetime, gated by `<scrollbackDir>/.iterate-c-wiped.marker`.

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
