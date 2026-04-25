# Shipwright Command Center

Local web app that observes multiple Claude Code sessions in parallel.
Works alongside the [Shipwright SDLC plugins](https://github.com/svenroth-ai/shipwright)
but runs as a standalone tool — you launch Claude in your own terminal
(or VS Code) and the Command Center watches the JSONL transcript at
`~/.claude/projects/<cwd>/<uuid>.jsonl` to render a live kanban board,
chat transcript, inbox, and diagnostics for every registered project.

**Architectural rule of record** (ADR-034): this app spawns **no** Claude
process. The user's terminal is the source of truth; the Command Center
is a read-only observer.

Extracted from the Shipwright monorepo on 2026-04-24. Full pre-split
history is preserved; see the `genesis-from-shipwright-v0.3.2` tag.

**Full docs:** [`docs/guide.md`](docs/guide.md) — installation, updates,
autostart, custom actions for your own slash skills, troubleshooting.
This README is the quickstart only.

## Quick start

Prerequisites: Node 20+, npm 10+, Claude Code CLI (any version ≥
`MIN_SUPPORTED_CLI`, see `server/src/core/cli-compat.ts`).

```bash
git clone https://github.com/svenroth-ai/shipwright-webui.git
cd shipwright-webui

# One-shot install (runs npm install in both server/ and client/)
make install

# Start both halves in two terminals
make dev-server   # Terminal 1 — Hono backend on :3847
make dev-client   # Terminal 2 — Vite frontend on :5173
```

Then open http://localhost:5173 and register your first project. The
wizard walks you through stack-profile selection; the Preview button
appears automatically for frontend projects with a `dev_server.command`
in their profile.

## Standalone vs. monorepo dev-loop

By default the Command Center reads stack profiles from the bundled
snapshot at `server/profiles/`. If you're iterating on the
[shipwright monorepo](https://github.com/svenroth-ai/shipwright) itself
and want your edits to `shared/profiles/*.json` to take effect without
re-syncing the snapshot, set:

```bash
export SHIPWRIGHT_MONOREPO_PATH=/path/to/shipwright-repo
```

The loader cascade (`server/src/core/profile-loader.ts`) prefers
`SHIPWRIGHT_PROFILES_DIR` first, then `SHIPWRIGHT_MONOREPO_PATH +
shared/profiles`, then the bundled snapshot.

## Parallel worktrees

Each dev-server binds fixed ports (`PORT=3847`, `VITE_PORT=5173`). For
two stacks on one machine (e.g. two worktrees of the shipwright
monorepo you're observing) override both:

```bash
PORT=3848 VITE_PORT=5174 make dev-server   # worktree B
PORT=3848 VITE_PORT=5174 make dev-client
```

Both halves now fail loud on port collisions (Vite via `strictPort`,
Hono via a bind-error handler, since v0.3.2).

## Autostart on Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

Creates a `.vbs` launcher in `~\.shipwright-webui\` that starts the
backend on login. Client can then be opened via browser or via another
shortcut.

## Architecture

- Hono (Node 20+) + React 19 (Vite 6) + TailwindCSS 4 + Radix UI.
- No chat composer, no SSE transcript, no chokidar. 1 s client polling
  with byte-range reads; the server is stateless on transcript requests.
- Multi-project task metadata persisted at
  `~/.shipwright-webui/{projects,sdk-sessions,settings}.json` with
  `proper-lockfile` guarded writes.
- Claude JSONL discovery is filename-first (`<uuid>.jsonl`); first-line
  sessionId is the sanity check.
- Detailed internals + load-bearing DO-NOT guards in [`CLAUDE.md`](CLAUDE.md)
  and `agent_docs/decision_log.md`.

## Contract with Shipwright plugins

The WebUI reads but never writes:

- `<project>/shipwright_run_config.json` — only `.profile` (Preview gate)
- `<project>/shipwright_*_config.json` — existence check for adoption state

The WebUI writes only:

- `<project>/.webui/actions.json` — empty stub on demand; user-editable
- `~/.shipwright-webui/*.json` — own registry

Both artefacts carry a `contractVersion` / `schemaVersion` integer.
Readers warn once on drift and keep going — never fails a read.

## License

MIT. See [LICENSE](LICENSE) (copied from shipwright monorepo at split
time).
