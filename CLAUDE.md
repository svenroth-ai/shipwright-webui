# Shipwright Command Center (WebUI)

## WHAT
- **Purpose**: Local web application for managing multiple Shipwright SDLC projects in parallel.
- **Architecture**: Hono backend (Node.js) + React 19 frontend (Vite 6), monorepo in `webui/`. **External-launch model (Plan D'' variant a, 2026-04-19; embedded-terminal auto-execute via ADR-068-A1)**: webui owns no Claude subprocess. The user clicks Launch / Resume / Relaunch on the TaskDetail header; the same pre-bound `--session-id <uuid>` command is auto-executed inside the embedded terminal pane (xterm.js + node-pty, shell-only whitelist) via a client-side WS data-frame. Users may still copy the command and run it in their own terminal — webui observes the resulting JSONL at `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` either way.
- **Stack**: TypeScript strict, Hono, React 19, Vite 6, TailwindCSS 4, Radix UI, TanStack React Query.

## Shared vocabulary

Allowlist · Ratchet · Anti-Ratchet · Producer · Action-Unit · Canon-Gate —
shipwright-wide terminology lives in
[`../shipwright/shared/glossary.md`](../shipwright/shared/glossary.md)
(sibling clone; without one, the same file is at
https://github.com/svenroth-ai/shipwright/blob/main/shared/glossary.md).
Mandatory reference for the bloat anti-ratchet rule + ADR-template fields
(Ousterhout / YAGNI / Chesterton-Fence / Re-Review-Date / Incident-Reference).

## Pre-commit hooks

Install the bloat anti-ratchet pre-commit hook **once per clone**
(requires Python 3.10+; the install script prints remediation if missing):

```bash
bash scripts/install-hooks.sh       # POSIX / Git-Bash on Windows
.\scripts\install-hooks.ps1         # PowerShell on Windows
```

Sets `git config core.hooksPath scripts/hooks` (idempotent; refuses to
overwrite a different existing value without `--force`). The hook only
blocks commits that ratchet an existing entry in
`shipwright_bloat_baseline.json` — new crossings are advisory (caught by
the Group H detective audit in the shipwright dev repo, not webui).
Vendored from `shipwright/shared/scripts/hooks/anti_ratchet_check.py`
(canonical-source hash + version in the vendored header).

## Architecture reference

Plan of record: [`~/.claude/plans/plan-d-double-prime-external-launch.md`](../.claude/plans/plan-d-double-prime-external-launch.md).
PoC findings that shaped the implementation: [`~/.claude/plans/external-launch-poc-results.md`](../.claude/plans/external-launch-poc-results.md).
Decision record: `.shipwright/agent_docs/decision_log.md` ADR-034.

Two hard rules, survivors of every review round: **(1) webui spawns no Claude process directly** and **(2) the server is stateless on transcript reads** — Architecture rules 1 + 4 below.

## Structure

Two independent npm workspaces — **`server/`** (Hono backend on port 3847, TypeScript strict; routes under `server/src/{routes,external,terminal}/`, core domain modules under `server/src/core/`) and **`client/`** (React 19 + Vite 6 on port 5173; components grouped by UI area under `client/src/components/{external,terminal,sidebar,wizard,settings,triage,common}/`, pages under `client/src/pages/`, Playwright E2E under `client/e2e/`). Compliance + planning + agent docs live under `.shipwright/`; CHANGELOG drops accumulate in `CHANGELOG-unreleased.d/`. Full component-level inventory, data flow, and write-surface map: [`.shipwright/agent_docs/architecture.md`](.shipwright/agent_docs/architecture.md) + [`.shipwright/agent_docs/component_inventory.md`](.shipwright/agent_docs/component_inventory.md) (file-tree dumps rot fast and duplicate those docs — removed in Phase 0f).

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

Bundled stack profiles ship at `server/profiles/` (a snapshot of `shipwright/shared/profiles/`; refresh via `npm run sync-profiles` from `server/`, see `server/profiles/README.md`). The loader (`server/src/core/profile-loader.ts`) resolves in order: **1.** `SHIPWRIGHT_PROFILES_DIR` (explicit override) → **2.** `SHIPWRIGHT_MONOREPO_PATH` + `/shared/profiles` (monorepo dev-loop: live edits without re-syncing) → **3.** bundled `server/profiles/` (default).

### Conventions
- TypeScript strict mode everywhere.
- Hono routes in `server/src/routes/`, one file per resource. External-launch routes live at `server/src/external/routes.ts`.
- React components in `client/src/components/`, grouped by UI area.
- TanStack React Query for data fetching + sequential polling for transcript updates.
- TailwindCSS 4 for styling, Radix UI for accessible primitives.
- Files under 300 lines — split if larger.
- Conventional Commits (feat:, fix:, refactor:, test:, docs:, chore:).

### Architecture rules

One-line index — rationale lives in the cited ADRs (`.shipwright/agent_docs/decision_log.md`). Numbering is load-bearing (source comments cite "CLAUDE.md rule N") — never renumber.

1. **Webui never spawns Claude.** `core/launcher.ts` only builds command strings; the embedded terminal auto-executes them after an explicit CTA click (ADR-067 + ADR-068-A1); pty-manager shell-only whitelist is the enforcement line. Guard: spec `35-no-chat-panel.spec.ts`.
2. **Task state = JSONL + persistent store.** `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`; session UUID pre-bound at task creation via `crypto.randomUUID()`.
3. **Discovery is filename-first.** `<uuid>.jsonl` is the primary match (PoC finding 1); first-line sessionId is a secondary sanity check.
4. **Transcript endpoint is stateless.** `GET /api/external/tasks/:id/transcript?fromByte=<n>&expectFingerprint=<fp>` — no server-side byte-offset cache; multi-tab for free.
5. **UTF-8-safe chunking.** Server reads are cut on `\n` boundaries only.
6. **Torn-read retry budget.** `core/session-watcher.ts` retries EBUSY/EPERM/EACCES/ENOENT up to 6 attempts, 50→1600 ms backoff.
7. **No SSE for transcript.** Sequential 1 s client polling via `useTaskTranscript`.
8. **No chokidar.** Heartbeat-free; watcher state derived on demand from mtime probes.
9. **Re-pass plugin dirs on every launch.** `--plugin-dir` does not reliably survive `--resume`.
10. **MIN_SUPPORTED_CLI is pinned** in `core/cli-compat.ts`; anything older shows a banner via `/api/diagnostics`.

### Preview-capability precedence

The Preview dev-server spawn path (not Claude — see ADR-044) gates on three sources: **1.** profile `stack.frontend` (capability gate) · **2.** profile `dev_server.command` (spawn target) · **3.** `.shipwright-webui/actions.json` → `actions.preview.enabled` (user-level opt-out). `<PreviewButton>` renders only when 1 AND 2 are present; `enabled = false` hides it regardless. A boot-time coherence check warns when `stack.frontend` is set but `dev_server.command` is missing (button would render, spawn would 500). Full diagram: [`.shipwright/agent_docs/architecture.md`](.shipwright/agent_docs/architecture.md).

### DO-NOT regression guards (see ADR-035)

One-line index — imperative + pointer only; rationale and full mechanics live in the cited ADRs (`.shipwright/agent_docs/decision_log.md` + `.shipwright/planning/adr/`). Numbering is load-bearing (source comments cite "CLAUDE.md rule N" / "DO-NOT #N") — never renumber.

1. **DO NOT write into Claude's JSONL files under `~/.claude/projects/`** — read-only polling observer; title sync = `--name` at launch, never JSONL mutation (ADR-035).
2. **Auto-scroll is CSS-first** (`overflow-anchor: auto`), `useAutoScroll` as safety net — DO NOT add scroll libraries (ADR-035).
3. **DO NOT re-introduce a chat composer** (ADR-034); spec 35 fails the build on any chat-* surface.
4. **DO NOT re-add `@assistant-ui/*`** — rendering is bespoke `react-markdown` + `remark-gfm` + `rehype-highlight` + `strip-ansi` (ADR-035).
5. **DO NOT run `claude --resume <uuid>` as a webui side-effect** while the user's session may be live — SQLite-lock/JSONL-interleave risk (ADR-035).
6. **Multi-writer state files MUST use `proper-lockfile`** (never just temp-file + rename); PATCH surfaces ELOCKED as 409 (ADR-035).
7. (ADR-080) **DO NOT add cross-package imports** — shared shapes are verbatim mirrors in `server/src/types/`; drift guards: `action-schema-sync.test.ts` + `no-cross-package-imports.test.ts`.
8. (ADR-044) **Schema v2 is write-on-touch** — DO NOT batch-rewrite on boot (ADR-038 rejected).
9. (ADR-044) **Preview spawn uses `shell: false`**, ONLY through `core/preview-session-manager.ts` — no parallel spawn path.
10. (ADR-044) **Path-guard is `realpath + path.relative`, NOT `startsWith`** — all tree + file routes share `core/path-guard.ts`.
11. (ADR-044) **DO NOT hardcode `shipwright-run` / `shipwright-iterate` / phase strings in components** — read from `/api/external/projects/:id/actions`; meta-test `client/src/test/doc-sync.test.ts` guards this + the file-map bundle (CLAUDE.md ∪ architecture.md ∪ component_inventory.md).
12. **DO NOT write into the user's `shipwright_run_config.json`** — read-only via `core/run-config-reader.ts` / `useRunConfig()`; the design gate is likewise a read-only observer of `run_loop_state.json` (`core/run-loop-state-reader.ts`). WebUI writes only `sdk-sessions.json` + `.shipwright-webui/actions.json` stubs + (FR-01.45) the transient gitignored `.shipwright/designs/design-feedback-round{N}.md` (via `external/design-review/feedback-write.ts` — never run_config / `run_loop_state.json` / Claude JSONL).
13. **Phase-task launches use the pre-bound run-config `sessionUuid` — never re-generate** (server rejects mismatch: `409 phase_task_session_uuid_mismatch`; `phaseTaskRef` + `actionId` together: `400 mixed_launch_intents`).
14. **All pipeline-continuation entry points funnel through `useContinuePipeline()`** — parallel launch paths bypass the staleness re-check.
15. **Schema is additive + write-on-touch** — loader accepts v1–v4, persist writes v4; DO NOT batch-rewrite on boot.
16. **Stale `in_progress` detection uses run-config timestamps only** — never JSONL mtime.
17. (ADR-067) **pty spawn target MUST be a whitelisted shell binary, never `claude`**; `paste-image` / `append-gitignore` flow through `realPathGuard`; image caps + magic-byte sniff non-negotiable; WS upgrade is the authoritative pty creation path.
18. (ADR-068-A1) **`ScrollbackStore`: `realpath` at EVERY operation**, UUID-validated, `<taskId>.log` naming (not sessionUuid), per-task `PQueue`; replay NEVER drops chunks; `/clear-scrollback` is the only destructive path.
19. (ADR-068-A1) **Auto-execute is a CLIENT-side WS data-frame, NOT server-side `pty.write`** — built EXCLUSIVELY by `core/launcher.ts buildCopyCommands()` after an explicit CTA click.
20. (ADR-087, amended by ADR-097) **Cell-state snapshots are the SOLE replay primitive** — one `replay_snapshot` per WS attach, chunked path RETIRED; no fallback without a fresh M2 re-verify. Detail: [ADR-087](.shipwright/planning/adr/087-cell-state-snapshot-iterate-c.md) + [ADR-088](.shipwright/planning/adr/088-headless-mirror-iterate-a.md).
21. (ADR-092) **WS replay is LIVE-mirror first, disk-snapshot fallback**; snapshot-on-detach via atomic `detachAndCount`; never `mirror.dispose()` in `flushMirrorSnapshot`. Guard: `v0-9-6-live-pty-replay.spec.ts`.
22. (ADR-097 + ADR-098) **xterm.js + paired addons are exact-pinned (6.0.0 family, NO carets)**; snapshot envelope v2-only; `CLAUDE_CODE_NO_FLICKER` defaults ON (opt-out `SHIPWRIGHT_TERMINAL_NO_FLICKER=0`); DO NOT add `windowsMode`.
23. (iterate-2026-06-17 + ADR-204) **Board column is DECOUPLED from session `state`** — `POST /tasks/:id/column` sets the user-owned `boardColumn` ONLY (never `state`/JSONL); `/close|/backlog|/reopen` sync it; DO NOT re-couple. Exception: a `done` card moved out of Done routes through `/reopen` (state→draft, lands unlocked — ADR-204).
24. (iterate-2026-07-14) **A self-scrolling column-flex container MUST carry `[&>*]:shrink-0`** — CSS drops the automatic minimum size of any direct child whose `overflow` is not `visible`, so that child gets squeezed below its content, silently CLIPPED, and (having eaten the negative free space) the container never scrolls, making the content unreachable. DO NOT hand-roll a dialog scroll body — use `components/common/ModalScrollBody.tsx` (the sole carrier; its `className` takes the height budget + gap ONLY). Meta-test `client/src/test/modal-scroll-body-invariant.test.ts` ratchets both.

### Title integration (`--name`)

Webui owns the task title in `sdk-sessions.json`. Every launch command (initial or resume) emits `--name "<title>"` after `--session-id` / `--resume`; Claude pre-seeds the picker title and writes `custom-title` + `agent-name` JSONL events. No mid-session sync — renames apply on the NEXT user-initiated launch. See `core/launcher.ts`, `external/routes.ts` PATCH handler, and `client/src/components/external/EditableTaskTitle.tsx`.

### Dev-server troubleshooting

If recent code changes don't show up, `tsx watch` has probably gone stale on Windows — kill the PID on :3847 explicitly:

```bash
# Windows:
netstat -ano | findstr :3847
taskkill //F //PID <pid>
cd server && npm run dev
```

`EADDRINUSE` on `npm run dev` usually means another worktree's dev server holds the port. Since v0.3.2 both halves fail loud instead of silently half-starting: Hono exits with a deterministic FATAL message (also for `EACCES` / `EADDRNOTAVAIL`), Vite via `strictPort: true`. `npm run dev:fresh` (dev-restart.js) reads `PORT` + `VITE_PORT` from the environment and kills only those two ports; the historic `VITE_ALT_PORT=5177` hardcode was removed in v0.3.2 — if you run Vite on 5177, set `VITE_PORT=5177` explicitly.

## Asking the user questions (plain language)

When you ask the user a question — a clarification, a choice between options,
or a confirmation — phrase it so a **non-senior developer or a normal user**
can understand, from a functional standpoint, what is actually being decided.
The person answering may not know the internals; do not make them decode
jargon to reply.

- **Lead with the functional meaning:** say what the choice changes about what
  the user sees or does in the Command Center — not the implementation detail.
  Ask "Should a closed task disappear from the board, or stay visible in a
  'Done' column?" rather than "Set `boardColumn` to `done` or filter the
  derived state?".
- **Avoid unexplained jargon.** If a technical term is genuinely unavoidable,
  add a short plain-language gloss in parentheses (e.g. "stateless read — the
  server keeps no memory of where you were, so multiple tabs just work").
- **Make options concrete and comparable.** Give each option in plain words
  with its real-world trade-off ("Option A shows updates instantly but uses
  more CPU; Option B refreshes once a second and is lighter"), not a raw
  technical menu.
- **Rule of thumb:** a product owner reading the question should be able to
  answer it without asking "what does that mean?". If they couldn't, rewrite it.

This applies to every interactive question — clarifications, design feedback,
and remediation choices alike. It governs *phrasing only*; the underlying rigor
of the work is unchanged.
