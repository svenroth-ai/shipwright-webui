# Shipwright Command Center

Local web app that observes and orchestrates multiple Claude Code
sessions in parallel. Works alongside the [Shipwright SDLC
plugins](https://github.com/svenroth-ai/shipwright) but runs as a
standalone tool: you click **Launch** on a task and the pre-bound
`claude --session-id <uuid> …` command auto-runs in an **embedded
terminal pane** (xterm.js + a real shell, right on the task page). The
Command Center watches the resulting JSONL transcript at
`~/.claude/projects/<cwd>/<uuid>.jsonl` to render a live kanban board,
chat transcript, inbox, triage, and diagnostics for every registered
project. Prefer your own terminal (or VS Code)? Copy the same command
and run it there — the observer behaves identically either way.

**Architectural rule of record** (ADR-034 + ADR-068-A1): the web server
spawns **no** Claude process. The embedded terminal hosts only a
whitelisted shell; your click on Launch authorizes that shell, and the
Claude command runs inside it. The Command Center stays a read-only
observer of the JSONL transcript.

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
- Embedded terminal pane per task — xterm.js in the browser, node-pty
  on the server, restricted to a shell-binary whitelist (never `claude`
  directly). Launch auto-runs the command via a client-side WebSocket
  data-frame; the server never spawns Claude (ADR-067 + ADR-068-A1).
- No chat composer, no SSE transcript, no chokidar. 1 s client polling
  with byte-range reads; the server is stateless on transcript requests.
- Multi-project task metadata persisted at
  `~/.shipwright-webui/{projects,sdk-sessions,settings}.json` with
  `proper-lockfile` guarded writes.
- Claude JSONL discovery is filename-first (`<uuid>.jsonl`); first-line
  sessionId is the sanity check.
- Detailed internals + load-bearing DO-NOT guards in [`CLAUDE.md`](CLAUDE.md)
  and `.shipwright/agent_docs/decision_log.md`.

## Triage tab

The `/triage` route surfaces pre-backlog findings from
`<project>/.shipwright/triage.jsonl` — items written by Phase-Quality,
compliance, security/performance/F0.5/drift hooks (the producer pattern
documented in
[shipwright/docs/triage-inbox.md](https://github.com/svenroth-ai/shipwright/blob/main/docs/triage-inbox.md)).

For each registered project, the page lists items with `status==triage`
grouped by source (alphabetical), severity-rank-sorted within each
group. Click an item → detail modal with three actions:

- **Promote** — creates an `ExternalTask` carrying a
  `promotedFromTriageId` back-ref + auto-merged tags
  `["source:<x>", "severity:<sev>", "triage:<id>"]`, then flips the
  triage item to `status==promoted`. Idempotent on retry: a 207
  partial-promote (status flip failed) returns the new `taskId` so retry
  reuses it — no orphan tasks.
- **Dismiss** — appends `status==dismissed` with optional reason. The
  finding will re-emerge under a NEW triage id if it re-fires.
- **Snooze** — appends `status==snoozed` with optional reason. Hides the
  item until the underlying issue re-fires (which produces a new triage
  id). There is no timed wake-up in this iterate.

Sidebar shows `Triage (N)` (orange badge, distinct from Inbox red)
aggregated across all registered projects, polling every 30 s with
exponential backoff on 5xx.

**Cross-process lock note** (ADR-101): WebUI's status writes use
`proper-lockfile` (directory-based); Python producers (`triage.py`,
`triage_promote.py`) use `_FileLock` (msvcrt/fcntl byte-locks). The two
primitives don't compose. Mitigation: append-mode small-write
line-atomicity at OS level + last-status-wins resolution by file order.
Real-world risk is bounded to manual `triage_promote.py` invocation
concurrent with a webui Promote click on the same triage id.

See
[shipwright/docs/triage-inbox.md](https://github.com/svenroth-ai/shipwright/blob/main/docs/triage-inbox.md)
for the cross-store contract + producer-side details.

## Contract with Shipwright plugins

The WebUI reads but never writes:

- `<project>/shipwright_run_config.json` — only `.profile` (Preview gate)
- `<project>/shipwright_*_config.json` — existence check for adoption state

The WebUI writes only:

- `<project>/.webui/actions.json` — empty stub on demand; user-editable
- `<project>/.shipwright/triage.jsonl` — appends `status` events from
  Promote / Dismiss / Snooze actions (FR-01.30, ADR-101). Never writes
  `append` events (those come from producer hooks).
- `~/.shipwright-webui/*.json` — own registry

Both artefacts carry a `contractVersion` / `schemaVersion` integer.
Readers warn once on drift and keep going — never fails a read.

## Acknowledgments

The Shipwright Command Center adopts patterns from these open-source
projects:

- **[obra/superpowers](https://github.com/obra/superpowers)** (MIT,
  © Jesse Vincent) — Iron-Law verification language and the anti-slop
  PR-template framing (`.github/PULL_REQUEST_TEMPLATE.md`).
- **[multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)**
  (MIT, © 2025 multica-ai) — the four Karpathy principles, cited
  verbatim in the sibling shipwright repo's `shared/constitution.md`
  and applied to webui changes via the PR template's Anti-Slop
  Self-Check section.
- **[multica-ai/multica](https://github.com/multica-ai/multica)**
  (Apache-2.0 *modified*, hosting-restricted) — architectural patterns
  only, inspiring the Command Center roadmap: WebSocket transcript
  streaming (replaces 1 s JSONL polling), multi-workspace isolation,
  runtime registry (Claude Code · Codex CLI · Copilot CLI · Gemini CLI
  as pluggable adapters), and the "parse don't cast" rule for
  cross-plugin `shipwright_*_config.json` reads. **No code or text is
  copied** — patterns only, deliberately, so this repo stays cleanly
  MIT.

The companion shipwright monorepo carries its own Acknowledgments block
covering the same sources plus
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
(MIT, © Addy Osmani; five-axis review framework — used in the sibling
repo's reviewer prompts, not directly in this webui).

## License

MIT. See [LICENSE](LICENSE) (copied from shipwright monorepo at split
time).
