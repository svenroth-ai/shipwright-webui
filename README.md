# Shipwright Command Center

> **One Kanban board for every Claude Code project you run in parallel —
> without giving up the terminal or VS Code workflow you already love.**

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

**Full docs:** [`docs/guide.md`](docs/guide.md) — the friendly,
non-expert walkthrough: installation, your first project, daily
workflow, updates, autostart, network access, custom actions for your
own slash skills, and troubleshooting. This README gets you running;
the guide goes deeper.

## What you get

- **One Kanban board across every project** — Backlog → In Progress →
  Done, no tab-juggling between background terminals.
- **Live transcript per task** — read what Claude is doing right now in
  chat style, refreshed every second.
- **Embedded terminal** on each task page — hit **Launch** and the
  pre-bound `claude` command auto-runs right there.
- **Inbox** — every "Claude needs permission…" prompt pinned in one
  place, across all projects.
- **Triage** — pre-backlog findings from Shipwright's quality, security,
  and compliance hooks, ready to promote into tasks.
- **Diagnostics** — CLI version, session count, watcher health at a
  glance.

It's optional — every Shipwright skill works fine without it — but once
you have more than one project running in parallel, it stops being a
luxury. See the [user guide](docs/guide.md) for the full tour.

## Get started

**Prerequisites:** Node.js 20+, Git, and the Claude Code CLI ≥ 2.1.114
(the pinned `MIN_SUPPORTED_CLI`). No databases, no Docker, no Python, no
system services. Verify each:

```bash
node --version       # v20.x.x or higher
git --version
claude --version     # 2.1.114 or higher
```

Then build once and run a single server — it serves the dashboard
itself, so there's only **one** address and **one** process to manage:

```bash
# 1. Get the code
git clone https://github.com/svenroth-ai/shipwright-webui.git
cd shipwright-webui

# 2. Install dependencies (npm install in both server/ and client/)
make install

# 3. Build both halves once
make build

# 4. Start the server (it serves the UI too)
cd server && npm start
```

Open **http://localhost:3847** and register your first project — the
wizard walks you through stack-profile selection.

> **No `make`?** (Common on Windows.) Run the npm scripts directly:
> `cd server && npm install && npm run build`, then
> `cd ../client && npm install && npm run build`, then
> `cd ../server && npm start`.

On **Windows**, have the server start automatically on every login — see
[Autostart](#autostart-on-windows) below. The full walkthrough,
first-project guide, network/Tailscale access, custom actions, and
troubleshooting all live in [`docs/guide.md`](docs/guide.md).

## Updating

```bash
git pull
make install        # only when dependencies changed
make build          # rebuild the compiled server/dist + client/dist
cd server && npm start   # restart — stop the old one with Ctrl+C first
```

The production server runs the **compiled** output, so a `git pull` alone
won't show new changes until you rebuild. On Windows,
`scripts\start-server-production.ps1` does rebuild + restart in one step.
See [guide §7](docs/guide.md#7-updating-the-command-center).

## Develop or contribute

Editing the Command Center's own code? Run the two halves as hot-reload
dev servers instead (`make dev-server` on `:3847` + `make dev-client` on
`:5173`, open `:5173`). That flow — plus the standalone-vs-monorepo
profile loop (`SHIPWRIGHT_MONOREPO_PATH`) and parallel-worktree port
overrides (`PORT` / `VITE_PORT`) — is documented in
[guide §4 Path B](docs/guide.md#4-installation) and [`CLAUDE.md`](CLAUDE.md).
Contributor norms: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Autostart on Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

Installs dependencies, builds both halves, and creates a hidden `.vbs`
launcher in `~\.shipwright-webui\` that starts the server on login. After
your next login the **full dashboard** is live at http://localhost:3847 —
no Vite or `make dev-client` needed. Custom port via `-Port <n>`;
uninstall with `-Uninstall`.

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
group. Click an item → detail modal with four actions:

- **Fix now** — opens the New-Issue modal pre-filled from the finding
  (title, description, priority, domain) so launching the task is one
  more click. `github-source` items route to a `phase=security` task;
  every other source routes to a new iterate. Use it when you've decided
  to act on the finding immediately.
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

- `<project>/.shipwright-webui/actions.json` — empty stub on demand; user-editable
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
