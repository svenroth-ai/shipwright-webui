# Shipwright Command Center — User Guide

A friendly walkthrough for Shipwright users who want **one Kanban board
across every Claude project**, without giving up the terminal or VS
Code workflow they already love.

---

## Table of contents

1. [What is the Command Center?](#1-what-is-the-command-center)
2. [Why copy-paste? The architecture in plain English](#2-why-copy-paste-the-architecture-in-plain-english)
3. [Recommended setup — Warp + Command Center](#3-recommended-setup--warp--command-center)
4. [Installation](#4-installation)
5. [Your first project — step by step](#5-your-first-project--step-by-step)
6. [Daily workflow](#6-daily-workflow)
7. [Updating the Command Center](#7-updating-the-command-center)
8. [Autostart on Windows](#8-autostart-on-windows)
9. [Configuration](#9-configuration)
   - [9.1 Environment variables](#91-environment-variables)
   - [9.2 Parallel worktrees](#92-parallel-worktrees)
   - [9.3 Custom actions](#93-custom-actions)
     - [9.3.1 Installing or replacing the file](#931-installing-or-replacing-the-file)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. What is the Command Center?

You already use Shipwright from VS Code or the terminal. One project, one
Claude session, one chat. That works great until you have **two or
three projects running in parallel** — and now you're hunting between
windows: which project was the build phase done? Did Claude ask me a
question two hours ago in that other tab? Where was that test result?

The **Shipwright Command Center** is a small local web app that gives
you one place to see every Shipwright project at a glance:

- **Kanban board** — every task, every project, in columns (Backlog → In
  Progress → Done). One scroll, no tab-juggling.
- **Live transcript per task** — what Claude is doing right now, in
  chat-style format you can read like a conversation.
- **Inbox** — every "Claude is asking permission for..." pinned in one
  list, regardless of which project. No more missed prompts in
  background terminals.
- **Diagnostics** — Claude CLI version, session count, watcher health,
  all on one page.
- **Custom actions** — you can wire your own slash skills (e.g. a
  personal `/content-orchestrator`) into the "+ New" menu (see [§9.3](#93-custom-actions)).

It's **optional** — every Shipwright skill works perfectly fine without
it. But once you have more than one Shipwright project running, the
Command Center stops being a luxury.

> **What it is not:** a replacement for VS Code or the terminal. The
> Command Center never spawns Claude itself, never edits your code, and
> never sees your file content. It's an observer with a really nice
> dashboard.

---

## 2. Why copy-paste? The architecture in plain English

When you hit **Launch** on a task, the Command Center doesn't run
Claude. Instead it gives you a copy-paste command:

```
claude --session-id <uuid> --name "Build: login redirect" /shipwright-build planning/03-login.md
```

You paste this in your own terminal (or VS Code's integrated terminal,
or any other terminal), Claude starts there, and the Command Center
**watches** the resulting transcript file on disk. It updates the
Kanban board live as Claude works.

**Why this design?**

- **Maximum flexibility.** You stay in control of the Claude process.
  Pause it, restart it, attach a debugger, run it inside `screen` or
  `tmux`, send it to a remote machine — your choice. The Command Center
  doesn't care; it just follows the file.
- **No CLI / SDK lock-in.** The Command Center doesn't depend on any
  specific Claude SDK version, IDE plugin, or RPC protocol. Anthropic
  ships a new CLI feature → you get it in your terminal immediately,
  no Command Center update needed.
- **No surprise side effects.** The Command Center can't accidentally
  start, kill, or modify a Claude session. The clipboard is the only
  channel between the dashboard and the actual work.
- **Multiple windows, multiple tabs.** Two browser tabs open? Both work.
  Refresh? Picks up where you left off. The Command Center is stateless
  on every read.

You'll see the same model in every action — **Save to Backlog** parks a
task without a command, **Launch** copies the command and opens the
task page so you can paste and start.

---

## 3. Recommended setup — Warp + Command Center

Two extra windows next to your usual editor:

| Window | What it does |
|---|---|
| **[Warp](https://www.warp.dev/) terminal** | Where you actually run Claude after pasting the Command Center's command. Warp is recommended because it gives you a **session tree** (every Claude run as a separate, named tab), a **folder tree** of the current directory, and a side **preview** pane. You can run three projects in parallel and never lose where you are. |
| **Command Center** (browser tab on `localhost:5173`) | Your status board. See what's done, what's running, what's waiting on you. Open task detail pages to read the live transcript. |

Any modern terminal works (Windows Terminal, iTerm2, Hyper, …) — Warp
just makes the multi-project flow smoother. If you don't already use
Warp, try it once: install from <https://www.warp.dev/>.

---

## 4. Installation

> If the words below feel too "command-line-y", don't worry — these are
> three commands, and you copy-paste them. There's no scripting.

### What you need

- **Node.js 20 or newer** — the runtime the Command Center is built on.
  Download from <https://nodejs.org/>. After install, open a terminal
  and run `node --version` — should print `v20.x.x` or higher.
- **Git** — to download the code. <https://git-scm.com/>
- **Claude Code CLI 2.1.114 or newer** — the same one you use today.
  Check with `claude --version`.

That's it. No databases, no Docker, no Python, no system services.

### Get the code

Open a terminal (Warp, iTerm2, Windows Terminal, your VS Code terminal
— whatever) in any folder you want the Command Center installed:

```bash
git clone https://github.com/svenroth-ai/shipwright-webui.git
cd shipwright-webui
```

That downloads the code into a folder called `shipwright-webui`.

### Install dependencies

```bash
make install
```

This downloads everything Node needs to run the Command Center. Takes
1–2 minutes the first time.

> **No `make` on your system?** (Common on Windows.) Run instead:
>
> ```bash
> cd server && npm install
> cd ../client && npm install
> ```

### Run it

The Command Center has two halves: a backend (does the work) and a
frontend (the website you see in the browser). Both need to run at the
same time, in **two separate terminal windows**.

**Terminal 1** — backend:

```bash
make dev-server
```

You'll see something like `Shipwright Command Center listening on
http://localhost:3847`. Leave it running.

**Terminal 2** — frontend:

```bash
make dev-client
```

You'll see `Local: http://localhost:5173/`. Leave this one running too.

Now open <http://localhost:5173/> in your browser. The Command Center
is up.

> **Want it to start automatically on login (Windows)?** See [§8](#8-autostart-on-windows).

---

## 5. Your first project — step by step

You've got the Command Center running at <http://localhost:5173/>. Time
to register a Shipwright project.

### 5.1 Open the Projects page

Click **Projects** in the left sidebar. You'll see an empty list and a
**+ New project** button at the top.

### 5.2 Run the wizard

Click **+ New project**. The wizard asks:

1. **Name** — anything human (e.g. "Time tracker SaaS"). Used as the
   label on the Kanban board.
2. **Path** — the absolute path to your project folder
   (e.g. `C:\dev\time-tracker` or `/Users/me/dev/time-tracker`). This
   is where Claude runs and writes files.
3. **Stack profile** — the Command Center auto-detects the stack from
   `package.json`, `pyproject.toml`, etc. You can override.
4. **Claude plugin directories** — usually leave default.

Click **Create**. The project appears in the sidebar.

### 5.3 You're ready

The project is now on the Kanban board (currently empty). You can
register more projects right away — the Command Center watches all of
them in parallel.

> Back on the **Projects** page later, clicking a project row jumps you
> straight to the Kanban board with that project pre-filtered. The gear
> icon in the **Actions** column opens the Settings dialog (rename,
> color); the trash icon removes the project from the registry without
> touching files on disk.

---

## 6. Daily workflow

This is the loop you'll repeat for every change you ask Claude to make.

### 6.1 Start a task

On the Kanban board, click the **+ New ▾** button in the top-right of
the sidebar. You'll see four options matching the standard Shipwright
modes:

- **New task** — a single Shipwright phase (e.g. just `/shipwright-test`).
- **New pipeline** — full SDLC, brief → deploy.
- **New iterate** — daily change on a finished project (the most common
  one after the first build).
- **Plain Claude** — a chat session without a Shipwright skill.

If you've added [custom actions](#93-custom-actions) for your own slash
skills, they show up here too. A fifth entry, **Continue Pipeline**,
shows up when the active project has a multi-session pipeline run that's
waiting for the next phase — see [6.7](#67-multi-session-pipelines).

Pick one. A modal opens.

### 6.2 Fill in the task

- **Title** — what you're doing in human words. The Command Center
  auto-detects which Shipwright phase fits ("fix login bug" → Build,
  "test the new endpoint" → Test, etc.) — you can override.
- **Description** — optional. If filled, this becomes the **first
  prompt** Claude sees. Use it to drop the URL of the issue, the file
  paths, the exact error. The more context, the better Claude works.
- **Phase** (Task mode only) — auto-picked from the title. Override if
  the auto-pick is wrong.
- **Autonomy** (Pipeline / Iterate) — *Guided* (Claude asks before each
  major step) or *Autonomous* (Claude pushes through).

You'll see a **live command preview** — exactly what will be copied to
your clipboard.

### 6.3 Two buttons: Save to Backlog vs. Launch & Copy

- **Save to Backlog** — writes the task to the Kanban Backlog column.
  No command, no clipboard. Pick this when you're planning ahead.
- **Launch & Copy** — copies the command to your clipboard, marks the
  task as **In Progress**, and opens the task detail page.

For now, click **Launch & Copy**.

### 6.4 Paste in your terminal

Switch to your terminal (Warp, the VS Code integrated terminal, …),
make sure you're in the project folder, and **paste**. Claude starts.

> The pasted command begins with `cd "<your project path>" && claude
> ...`, so even if your terminal was sitting in your home folder,
> Claude lands in the right place automatically.

### 6.5 Watch the transcript

Back in the browser, the task detail page shows the **live transcript**
— Claude's messages, tool calls, file edits, all in chat-style. Updates
every second. You don't need to switch back to the terminal to see what
Claude is doing.

If Claude asks a permission question (`Allow this tool?`), it shows up
in the **Inbox** in the left sidebar. One badge, one number, one
glance. You answer in the terminal as usual; the inbox updates.

### 6.6 Done

When Claude finishes, the task moves to **Done**. The transcript stays
available — go back any time to read it again.

> **Multi-project parallel:** repeat the loop for as many projects as
> you want. Each task gets its own browser tab, its own transcript, its
> own inbox slot. The Kanban board is your status overview.

### 6.7 Multi-session pipelines

When you run `/shipwright-run`, each SDLC phase runs in its own
terminal Claude session — the master writes a
`shipwright_run_config.json` at the project root, prints a launch card
for the first phase, and ends. For the lifecycle, state machine, and
recovery commands, see the [framework guide §4 *The Pipeline: Phase by
Phase*](https://github.com/svenroth-ai/shipwright/blob/main/docs/guide.md#4-the-pipeline-phase-by-phase).

The Command Center reads that file and renders a **Pipelines lane**
above the Kanban columns:

- One **Master TaskCard** per Run, labelled `Run-<short>` (e.g.
  `Run-a1b2`) with a status pill (`IN PROGRESS` / `COMPLETE` /
  `FAILED` / `NEEDS VALIDATION`).
- Inside the card, one row per `phase_task` with phase, optional split
  id, status pill, and the last 8 chars of the session UUID.
- Rows whose phase task has a webui shadow (i.e. you continued through
  the Command Center at least once) are **clickable** — they jump to
  the matching task detail page. Rows without a shadow stay plain text.

To advance the pipeline, you have two equivalent paths:

- **Master TaskCard → green Continue button** on the next
  `awaiting_launch` row. One click, no picker.
- **+ New ▾ → Continue Pipeline** opens a modal that lists every ready
  phase task. When the run uses splits and several branches are
  parallel-ready (`plan/01-core` AND `plan/02-ui-shell` both waiting),
  the modal shows a radio list so you pick which branch to launch
  first.

Both paths run the same flow: re-read run-config, look up (or create)
the matching webui shadow task, build the launch command for the
phase's pre-bound `--session-id`, copy it to your clipboard, and
navigate to the new task detail page. Paste in your terminal as usual.

> Repeated clicks for the same phase task reuse the existing shadow —
> no duplicates appear in the Kanban.

If a phase fails, the Master TaskCard shows a red banner with a
copy-able `recover-phase-task` snippet for each failed task. For runs
that finish but leave non-terminal tasks behind (`needs_validation`),
the snippet uses `--force-status skipped`. For runs sitting in the same
state for over an hour with no `updated_at` movement, an amber "stale"
banner appears with the same recovery affordance.

If a project has no `shipwright_run_config.json`, or the file predates
schema v2 (i.e. an older Shipwright run), the Pipelines lane stays
hidden and the Kanban behaves exactly like before — no functional
change for non-pipeline workflows.

---

## 7. Updating the Command Center

When new versions are released, you update with two commands:

```bash
git pull
make install
```

Restart both halves:

1. Stop them (Ctrl+C in each terminal).
2. Start them again (`make dev-server` + `make dev-client`).

If you have [custom actions](#93-custom-actions), the Command Center
keeps working even if the schema drifts in a new version — it falls
back to defaults and shows you a small warning. You can fix the file at
your leisure.

---

## 8. Autostart on Windows

Want the Command Center backend to start automatically every time you
log in? One PowerShell command:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

This:

1. Verifies Node.js is installed.
2. Installs all dependencies.
3. Builds the production version (faster startup, less memory).
4. Creates a hidden background launcher so the backend starts silently
   on login (logs go to `~\.shipwright-webui\server.log`).
5. Adds a startup shortcut to your Windows **Startup** folder.

After your next login, <http://localhost:3847> is up. Open the frontend
with `make dev-client` whenever you want to see the dashboard, or wire
your own browser shortcut.

### Custom port

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -Port 3848
```

### Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -Uninstall
```

Removes the startup shortcut and the launcher. Your code is left
untouched.

### macOS / Linux

No first-party autostart helper. Wire `make dev-server` into launchd
(macOS) or systemd-user (Linux) — the actual command is the same.

---

## 9. Configuration

For most users the defaults are right. The variables below let you run
multiple Command Centers side by side, point at a custom stack-profile
folder, or wire your own slash skills into the menu.

### 9.1 Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3847` | Backend port. The frontend reads this so `/api` calls hit the right backend. |
| `VITE_PORT` | `5173` | Frontend port. Fails loud on collision (no silent half-start). |
| `VITE_HOST` | _(unset)_ | Bind the Vite dev server to a non-loopback interface for multi-device access (Tailscale / LAN). `true` = `0.0.0.0` (all interfaces); `<hostname-or-ip>` = a specific interface. Unset = loopback only (default; safe in untrusted Wi-Fi). |
| `HONO_HOST` | _(unset → loopback)_ | Bind the Hono backend to a non-loopback interface. `true` = `::` (dual-stack all interfaces); `<hostname-or-ip>` = a specific interface. Unset = `127.0.0.1` (default; safe). For the typical Tailscale-from-phone flow you do **not** need this — Vite proxies `/api` to `localhost:3847` locally, so leaving the backend on loopback is correct. Only set `HONO_HOST` if you want clients to call the backend directly (no Vite proxy). |
| `WEBUI_TRUSTED_ORIGINS` | _(unset)_ | Comma-separated allowlist of `Origin` values the WS upgrade + HTTP CORS middleware accept. When unset, the policy follows `HONO_HOST`: loopback-only by default, "any non-empty Origin" when `HONO_HOST` is set. Use this to opt into multi-device access (e.g. `http://webui-host.tailnet.ts.net:5173`) while keeping the gate narrow. Boot log prints the resolved policy. |
| `SHIPWRIGHT_PROFILES_DIR` | _(unset)_ | Override path to your stack-profile folder. Highest precedence. |
| `SHIPWRIGHT_MONOREPO_PATH` | _(unset)_ | If you're hacking on the shipwright repo and want live profile edits, point this at your shipwright checkout. The loader reads `<path>/shared/profiles`. |

Profile resolution: `SHIPWRIGHT_PROFILES_DIR` →
`SHIPWRIGHT_MONOREPO_PATH/shared/profiles` → bundled `server/profiles/`.

#### Reaching the dev server from another device (Tailscale / LAN)

By default Vite binds to loopback only — the Command Center is
unreachable from your phone, tablet, or another desktop. To open it up
on a trusted network (for example over Tailscale MagicDNS like
`http://webui-host.tailnet.ts.net:5173`), opt in with `VITE_HOST`.

The exact syntax depends on your shell:

| Shell | One-shot (this run only) | Persistent (current session) |
|---|---|---|
| Bash / zsh / sh | `VITE_HOST=true npm run dev` | `export VITE_HOST=true` |
| PowerShell (Windows / pwsh) | `$env:VITE_HOST="true"; npm run dev` | `$env:VITE_HOST="true"` |
| cmd.exe | `set VITE_HOST=true && npm run dev` | `set VITE_HOST=true` |

To make it survive new shells on Windows without exposing yourself
in foreign Wi-Fi (café / hotel), set it persistently in User scope and
unset it before you travel:

```powershell
# Set:    [Environment]::SetEnvironmentVariable("VITE_HOST","true","User")
# Unset:  [Environment]::SetEnvironmentVariable("VITE_HOST",$null,"User")
```

`VITE_HOST=true` binds `0.0.0.0` (or `::` on dual-stack hosts) and
unblocks Vite 6's host-header check so MagicDNS hostnames stop
returning `Blocked request. This host is not allowed.`. To bind a
single interface instead, pass an address — e.g.
`VITE_HOST=100.64.0.1 npm run dev` (bash) or
`$env:VITE_HOST="webui-host.tailnet.ts.net"; npm run dev`
(PowerShell).

When the variable is honoured, `npm run dev`'s output gains a
`Network: http://<your-ip>:5173/` line (instead of the default
`Network: use --host to expose`). If you don't see that line, the env
var didn't reach the Vite process — check you're in a fresh shell that
inherits it.

The Hono backend on `3847` does **not** need to change for this flow:
Vite proxies `/api` to `localhost:3847` locally, so the backend stays on
loopback (its default since v0.8.4) and only the frontend port is
exposed. Keep `VITE_HOST` unset on untrusted networks (café, hotel) —
the loopback default is the safe choice there.

##### Embedded terminal over Tailscale — Trusted-Origin gate (v0.8.4)

The WS upgrade for `/api/terminal/:taskId/ws` and the HTTP CORS
middleware both check the browser's `Origin` header against a
trusted-origin policy. By default, only `localhost / 127.0.0.1 / ::1`
origins are accepted — so a tab opened at
`http://webui-host.tailnet.ts.net:5173` would load the page (Vite
proxies `/api` same-origin) but the **embedded terminal stays mute**:
Vite forwards the browser's original Tailscale-MagicDNS Origin to the
WS upgrade, the gate rejects it, and no `ready` envelope ever arrives.

Two ways to widen:

1. **Implicit (simplest, follows `HONO_HOST` posture):** if `HONO_HOST`
   is set to anything non-empty, the gate accepts any non-empty
   Origin. Most users on Tailscale already set `VITE_HOST=true` for
   the page itself; setting `HONO_HOST=true` alongside is sufficient
   even if you don't actually call the backend directly — the WS gate
   keys off the env var, not the bind itself. Anonymous (`null` /
   missing) Origin is still rejected (curl / scripted callers fall
   outside the browser CORS contract regardless).

2. **Explicit allowlist (narrower, recommended on shared / untrusted
   networks):** set `WEBUI_TRUSTED_ORIGINS` to the comma-separated set
   of `<scheme>://<host>[:<port>]` values you actually use:

   ```powershell
   # PowerShell — persistent, User-scope:
   [Environment]::SetEnvironmentVariable(
     "WEBUI_TRUSTED_ORIGINS",
     "http://localhost:5173,http://webui-host.tailnet.ts.net:5173",
     "User"
   )
   ```

   ```bash
   # bash / zsh — current shell:
   export WEBUI_TRUSTED_ORIGINS="http://localhost:5173,http://webui-host.tailnet.ts.net:5173"
   ```

   The allowlist takes precedence over `HONO_HOST` (narrowest match
   wins). Each entry is compared as an exact string against the
   incoming Origin — no wildcards, no scheme rewriting; list every
   `host:port` you actually use.

The boot log confirms the resolved policy on every server start, e.g.
`Trusted-Origin policy: HONO_HOST=true → any non-empty Origin
accepted (set WEBUI_TRUSTED_ORIGINS to narrow)` or `Trusted-Origin
policy: WEBUI_TRUSTED_ORIGINS allowlist (2 entries):
http://localhost:5173, http://webui-host.tailnet.ts.net:5173`.
If you see `loopback-only` and your terminal is mute over Tailscale —
that's the gate; widen via one of the env vars above.

#### Reaching the backend directly (rare; bypass Vite proxy)

Almost no one needs this. The 99% workflow keeps the backend on
loopback and reaches it through Vite's `/api` proxy on `5173`. But if
you're running an external client (a custom dashboard, a curl-based
smoke check from another box, an integration test driver) that can't
go through Vite, opt in with `HONO_HOST`:

```powershell
$env:HONO_HOST="true"; cd server; npm run dev
```

Same shell-syntax matrix as `VITE_HOST` (bash `HONO_HOST=true npm run
dev`, cmd.exe `set HONO_HOST=true && npm run dev`,
PowerShell-persistent `[Environment]::SetEnvironmentVariable("HONO_HOST","true","User")`).
The startup line confirms the bind: `listening on http://...:3847
(bind=...)` — `bind=127.0.0.1` is loopback, `bind=::` is all
interfaces.

> **Breaking change vs. v0.8.3 and earlier.** Before v0.8.4 the backend
> bound to `::` (all interfaces) implicitly because `serve()` was
> called without `hostname`. If your workflow relied on hitting
> `http://<this-machine>:3847/api/...` from another device, set
> `HONO_HOST=true` to restore it. The Vite-proxy flow is unaffected.

Refresh the bundled snapshot any time:

```bash
make sync-profiles
```

### 9.2 Parallel worktrees

If you want a second Command Center on the same machine (for example,
one for stable use, one for testing a new branch), override both ports:

```bash
PORT=3848 VITE_PORT=5174 make dev-server
PORT=3848 VITE_PORT=5174 make dev-client
```

Port collisions fail loud — neither half will silently bind to a wrong
port and confuse you later.

### 9.3 Custom actions

The **+ New ▾** menu reads its entries from a per-project catalog. By
default that catalog is the bundled
[`server/src/config/default-actions.json`](../server/src/config/default-actions.json),
which exposes the four standard Shipwright modes (`new-task`,
`new-pipeline`, `new-iterate`, `new-plain`).

To add your own buttons — for example a `/content-orchestrator` skill
you've built globally in `~/.claude/skills/` — install a file at
`<project.path>/.webui/actions.json`. The Command Center offers three
ways to do that (see [9.3.1](#931-installing-or-replacing-the-file)
below); regardless of which path you pick, edits show up on the next
page load (mtime-cached server-side).

#### When to use it

- You have a personal slash skill (`/content-orchestrator`,
  `/audit-foo`) and want it on the New menu.
- You want different menus for different project types — content
  projects show your content skills, code projects show the standard
  Shipwright pipeline.

#### Where the file lives

`<project.path>/.webui/actions.json` — relative to the **project**, not
the Command Center install. If the file is personal to you, add
`.webui/` to your project's `.gitignore`. If your team shares the same
skills, commit it.

#### 9.3.1 Installing or replacing the file

You have three ways to put `actions.json` on disk for a registered
project. Pick whichever fits your moment:

**A — Settings page (most common, post-creation).**

`Settings` → **Configure actions** card. You'll see one row per
registered project with a small badge:

| Badge | Meaning |
|---|---|
| `BUNDLED` | No `.webui/actions.json` on disk → the Command Center serves the bundled default. |
| `CUSTOM` | A valid `.webui/actions.json` is in use. |
| `MALFORMED` | A `.webui/actions.json` exists but failed to parse / validate. The bundled default is served as a fallback so the Kanban stays usable. |

For each project the row exposes:

- **Upload .json** — opens the OS file picker. The selected file is
  parsed and validated server-side; on success it replaces
  `<project.path>/.webui/actions.json` atomically (tmp + rename) and the
  catalog cache for that project is invalidated. Other projects are
  unaffected. On failure (bad JSON, schema error, unknown placeholder,
  >256 KB) the row shows an inline red banner with the structured error
  and the on-disk file is **not** touched.
- **Reset to default** — opens a confirm dialog; on confirm, the
  `.webui/actions.json` is deleted and the project falls back to the
  bundled default. The button is enabled when the project is `CUSTOM`
  *or* `MALFORMED` so you can recover from a broken upload without
  opening a terminal.

**B — Project Wizard Advanced (at creation time).**

When creating a new project: open **Show advanced options** on the
Confirmation step → pick **Custom** → optional **Choose file…** to
attach an `actions.json` from disk. The picker parses the file
client-side as a pre-flight check; if it doesn't parse, the **Create
Project** button is disabled with an inline error so you don't waste a
round trip. After the project is created, the file is uploaded through
the same validation pipeline as path A. If the upload fails, the
project is still created — the wizard stays open with the error so you
can pick a different file or close and retry from Settings later.

If you skip **Choose file…** under **Custom**, an empty schema-valid
stub is written and the docs page opens, exactly as before.

**C — Direct edit on disk.**

Open `<project.path>/.webui/actions.json` in your editor and save. The
server's catalog is mtime-cached, so your changes show up the next time
the catalog is read (e.g. opening the project page or the **+ New ▾**
menu). This path skips the upload validators — you find out about
schema / placeholder mistakes when the page reads the file.

> Tip: regardless of path, every write goes through a `realpath +
> path.relative` traversal guard, so symlinks under `.webui/` cannot
> redirect the write outside the registered project root.

#### Minimal example — four custom skills

```json
{
  "schemaVersion": 1,
  "defaults": { "autonomy": "guided" },
  "actions": [
    {
      "id": "new-content-orchestrator",
      "label": "Content Orchestrator",
      "kind": "external_launch",
      "description": "Full content pipeline — research, curate, batch-create.",
      "command_template": "{cd.prefix}claude --session-id {task.uuid} --name \"{task.title}\" {plugin.dirs} /content-orchestrator{task.description?}",
      "modal_fields": ["title", "description"]
    },
    {
      "id": "new-content-research",
      "label": "Content Research",
      "kind": "external_launch",
      "description": "Research trending topics.",
      "command_template": "{cd.prefix}claude --session-id {task.uuid} --name \"{task.title}\" {plugin.dirs} /content-research{task.description?}",
      "modal_fields": ["title", "description"]
    },
    {
      "id": "new-content-creator",
      "label": "Content Creator",
      "kind": "external_launch",
      "description": "Create / update / regenerate articles.",
      "command_template": "{cd.prefix}claude --session-id {task.uuid} --name \"{task.title}\" {plugin.dirs} /content-creator{task.description?}",
      "modal_fields": ["title", "description"]
    },
    {
      "id": "new-content-publisher",
      "label": "Content Publisher",
      "kind": "external_launch",
      "description": "Publish to Webflow / LinkedIn.",
      "command_template": "{cd.prefix}claude --session-id {task.uuid} --name \"{task.title}\" {plugin.dirs} /content-publisher{task.description?}",
      "modal_fields": ["title", "description"]
    }
  ],
  "phases": [{ "id": "content", "label": "Content", "color": "#A855F7" }],
  "preview": { "enabled": false }
}
```

After saving the file, refresh the project page in the Command Center.
The split-button now shows your four buttons. Each opens the **generic
mode** of the New-Issue modal — heading from `action.label`, subheading
from `action.description`, no Shipwright phase picker, no autonomy
toggle.

#### Schema reference

```jsonc
{
  "schemaVersion": 1,                    // currently 1

  "defaults": {
    "autonomy": "guided"                 // "guided" | "autonomous"
  },

  "actions": [
    {
      "id": "string",                    // unique within the catalog
      "label": "string",                 // shown on the button + dropdown
      "kind": "external_launch",         // only kind currently supported
      "description": "string",           // optional; subtitle + generic-mode subheading
      "command_template": "string",      // see Placeholders below
      "modal_fields": [                  // optional; fields the modal renders
        "title", "description", "phase", "autonomy"
      ],
      "parameters": [ /* ParamSchema */ ],            // phase-independent CLI params
      "phase_parameters": {                            // phase-bound CLI params (new-task only)
        "<phase-id>": [ /* ParamSchema */ ]
      }
    }
  ],

  "phases": [
    {
      "id": "string",                    // matches phase_parameters keys
      "label": "string",
      "color": "#RRGGBB",                // optional
      "supports_autonomy": true          // optional; toggles AutonomyToggle in task mode
    }
  ],

  "preview": { "enabled": "auto" }       // "auto" | true | false
}
```

`ParamSchema`:

```jsonc
{
  "name": "section",                     // matches PARAM_NAME_PATTERN
  "label": "Section file",
  "type": "string",                      // "string" | "boolean" | "enum"
  "cli_flag": "--section",               // matches CLI_FLAG_PATTERN, or "@" for positional
  "value_separator": "space",            // "space" | "equals" | "none"
  "enum": ["a", "b"],                    // required for type=enum
  "cli_flag_map": { "a": "--alpha" },    // optional per-enum-value flag override
  "pattern": "^[A-Za-z0-9_./-]+\\.md$",  // optional regex validator (string only)
  "default": "01-build.md",              // optional; rendered as placeholder
  "required": true,                      // optional; renders the field outside Advanced
  "sensitive": true,                     // optional; masks value in command preview
  "helpText": "string",                  // optional
  "placeholder": "string"                // optional
}
```

#### Placeholders

`command_template` accepts only these tokens:

| Placeholder | Value |
|---|---|
| `{project.id}` | Project UUID, raw. |
| `{project.path}` | Project folder absolute path, shell-escaped. |
| `{cd.prefix}` | `cd <path> && ` (POSIX/cmd) / `Set-Location <path> -ErrorAction Stop; ` (PowerShell). |
| `{task.uuid}` | Pre-bound session UUID, raw. Use after `--session-id`. |
| `{task.title}` | Task title, shell-escaped. |
| `{task.description?}` | Trailing space + escaped description, or empty. Newlines rejected. |
| `{task.phase}` | Phase id from `phases[].id`. Validated against the catalog. |
| `{task.phase_label}` | Phase label, shell-escaped. |
| `{task.autonomy_flag?}` | ` --autonomous` when `autonomy === "autonomous"`, else empty. |
| `{task.parameters?}` | Resolved CLI flags from the modal, per-shell escaped. |
| `{task.initial_prompt}` | Bundled-mode only. Custom actions must not use this — emit the slash literally and use `{task.description?}` / `{task.parameters?}`. |
| `{plugin.dirs}` | `--plugin-dir <a> --plugin-dir <b>`, or empty. |

#### Generic mode UX

When the action `id` is not one of `new-task` / `new-pipeline` /
`new-iterate` / `new-plain`, the New-Issue modal renders in generic
mode:

- Heading: `New <action.label>`.
- Subheading: `action.description` if set.
- No phase dropdown.
- No autonomy toggle.
- Live command preview replaced by a static hint. The actual command is
  generated at Launch and shown on the task detail page.

Title + Description fields stay; Description is the first prompt Claude
sees.

#### Validation

The same validators run for the upload UI (Settings + Wizard) and the
catalog-read endpoint (`GET /api/external/projects/:id/actions`). Direct
edits on disk only see the read-side validators — the upload-only rows
(`payload_too_large`, `path_unsafe`) are by definition not reachable.

| Failure | Result |
|---|---|
| Body > 256 KB on upload | 413 `payload_too_large` (rejected via `Content-Length` pre-check, before buffering). |
| Malformed JSON on upload | 400 `invalid_json` with parser detail. |
| Malformed JSON on direct edit | Bundled default served + a diagnostic chip on the project page (`actions_file_malformed`). The Kanban stays usable. |
| Schema error (duplicate `id`, missing `command_template`, invalid `defaults.autonomy`, empty `phases[]`, unsupported `modal_fields` entry, boolean param with `default:true` or `required:true`, …) | 400 `schema_validation_failed` with the full `errors[]` array. |
| Unknown placeholder in `command_template` | 400 `invalid_placeholder` naming the offending token + `actionId`. Same check runs at upload time AND at every catalog read. |
| `.webui/` resolves outside the project root (symlink escape) | 400 `path_unsafe` with the rejected `reason` (`traversal` / `symlink_escape` / `drive_change`). |
| Unknown `actionId` at launch | 400 `unknown_action_id`. |
| Unknown phase at launch | 400 `command_substitution_failed`. |

#### Constraints

- `command_template` is tokenised; user input is escaped per shell, not
  evaluated.
- `{task.initial_prompt}` is bundled-mode only. Custom actions using it
  raise `UnknownActionError`.

---

## 10. Troubleshooting

### Port 3847 (or 5173) is already in use

Another Command Center, a previous run that didn't clean up, or a
totally different app. Find and stop the offender:

```bash
# Windows (cmd / PowerShell)
netstat -ano | findstr :3847
taskkill /F /PID <pid>

# macOS / Linux
lsof -i :3847
kill -9 <pid>
```

Or use the bundled helper, which only touches the configured ports:

```bash
cd server && npm run dev:fresh
```

### Recent code changes don't show up in the dashboard

Sometimes the dev-watcher gets stuck on Windows. Stop the backend with
Ctrl+C, kill any leftover Node process on `:3847` (recipe above), then
`make dev-server` again.

### Banner: "Claude CLI < MIN_SUPPORTED_CLI"

Update the Claude Code CLI:

```bash
claude --version
npm install -g @anthropic-ai/claude-code
```

### Project page shows "actions.json malformed"

Your custom `.webui/actions.json` failed to parse. The Command Center
falls back to the standard buttons; nothing is broken, but your custom
ones are gone until you fix the file. Hover the warning chip for the
parser error. Common mistakes:

- Trailing comma after the last `"action"` entry.
- Unescaped backslashes in `command_template` (Windows paths).
- Unknown placeholder name (typos in `{task.title}` etc.).
- Two actions with the same `id`.

Validate against [§9.3 Schema reference](#93-custom-actions).

### I clicked Launch but nothing happens / no transcript appears

After Launch you have to **paste the command** in your terminal. The
Command Center never starts Claude itself. The task detail page sits at
"Awaiting external start" until Claude actually runs and writes the
session file.

If the file *does* exist but the dashboard doesn't pick it up, check:

- The project's **path** in the Command Center matches the folder you
  pasted the command in.
- The session UUID matches: open the latest file in
  `~/.claude/projects/<encoded-cwd>/` and check the first line.
- The `/api/diagnostics` page in the dashboard for any session-watcher
  errors.

### Two browser tabs open — am I going to step on myself?

No. The Command Center is built to handle multiple tabs. If two tabs
race on a write (e.g. both rename the same task), one wins and the
other gets a 409 — refresh the losing tab and try again. Reads are
always safe.
