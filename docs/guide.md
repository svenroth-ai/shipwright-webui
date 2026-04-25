# Shipwright Command Center — User Guide

This is the source-of-truth guide for the WebUI: installation, updates,
autostart, configuration, and how to wire your own slash skills into the
"+ New" menu via custom actions. The repo-root [`README.md`](../README.md)
keeps the quickstart; everything beyond a first-run lives here.

## Table of contents

1. [Installation](#1-installation)
2. [Updating](#2-updating)
3. [Autostart on Windows](#3-autostart-on-windows)
4. [Configuration](#4-configuration)
   - [4.1 Environment variables](#41-environment-variables)
   - [4.2 Parallel worktrees](#42-parallel-worktrees)
   - [4.3 Custom actions](#43-custom-actions)
5. [Architecture in one page](#5-architecture-in-one-page)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Installation

### Prerequisites

- **Node.js 20+** and **npm 10+** — `node --version` && `npm --version`
- **Claude Code CLI** ≥ `MIN_SUPPORTED_CLI` (currently `2.1.114` — pinned
  in [`server/src/core/cli-compat.ts`](../server/src/core/cli-compat.ts)).
  Older versions show a banner via `/api/diagnostics` and may not behave
  the way Plan D'' assumes.
- **Git** for cloning + worktree workflows.

The WebUI itself does **not** spawn Claude. You launch sessions in your
own terminal (or VS Code); the WebUI watches the resulting JSONL at
`~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`. See
[ADR-034](../agent_docs/decision_log.md) and [`CLAUDE.md`](../CLAUDE.md)
for the why.

### Clone + install

```bash
git clone https://github.com/svenroth-ai/shipwright-webui.git
cd shipwright-webui
make install
```

`make install` runs `npm install` in both `server/` and `client/` —
they're independent workspaces, no root `package.json`. If you don't
have `make` (rare on Windows), run them by hand:

```bash
cd server && npm install
cd ../client && npm install
```

### First run

Open two terminals from the repo root:

```bash
# Terminal 1 — Hono backend on http://localhost:3847
make dev-server

# Terminal 2 — Vite frontend on http://localhost:5173
make dev-client
```

Then point your browser at <http://localhost:5173> and follow the
project wizard. You can now register your first project (a folder where
you run Claude); the WebUI starts watching for sessions immediately.

> The Vite dev server proxies `/api/*` to the Hono backend, so keep both
> running. If you stop the backend, the frontend's polling will throw
> network errors until you bring it back.

### Production build

```bash
make build
```

Produces `client/dist/` (static assets) and `server/dist/` (compiled JS).
Serve `server/dist/index.js` with `node`; the Hono server itself serves
`client/dist/` as static files when present.

---

## 2. Updating

```bash
git pull
make install   # picks up new deps in either workspace
```

Restart both halves. If `tsx watch` was running, kill the existing
process first — see [§6 Troubleshooting](#6-troubleshooting) for the
deterministic Windows kill recipe.

If you have a custom `.webui/actions.json` in your registered projects,
the loader automatically falls back to the bundled defaults on a schema
mismatch and surfaces a non-blocking diagnostic chip — your projects
keep working. Re-validate your file against [§4.3](#43-custom-actions)
after a major update.

---

## 3. Autostart on Windows

A PowerShell helper installs a hidden background launcher so the backend
starts on login. The frontend you can open in a browser shortcut or
launch manually with `make dev-client`.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

What the script does:

1. Verifies Node.js is installed.
2. Runs `npm install` in `server/` and `client/`.
3. Builds the client (`npm run build`).
4. Writes a VBS launcher to `~\.shipwright-webui\start-server.vbs` that
   starts the server **without a visible console window** and pipes
   stdout/stderr into `~\.shipwright-webui\server.log`.
5. Drops a `.lnk` shortcut into the Windows **Startup** folder pointing
   at the VBS launcher.

After login the backend is reachable at <http://localhost:3847>.

### Custom port

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -Port 3848
```

The `-Port` flag bakes into the VBS as a `set PORT=…` so the launcher
binds the alternate port on every login.

### Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -Uninstall
```

Removes the startup `.lnk` and the VBS launcher. The backend will no
longer start on login. The repo + node_modules stay untouched.

### macOS / Linux

No first-party autostart helper yet. Wire `make dev-server` into your
preferred mechanism (launchd plist, systemd user unit, tmux on login,
…). PRs welcome.

---

## 4. Configuration

### 4.1 Environment variables

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `3847` | Hono backend bind port. Vite reads this at startup so `/api` proxies to the matching backend. |
| `VITE_PORT` | `5173` | Vite frontend bind port. `strictPort: true` — fails loud on collision. |
| `SHIPWRIGHT_PROFILES_DIR` | _(unset)_ | Explicit path to a stack-profiles directory. Highest precedence. |
| `SHIPWRIGHT_MONOREPO_PATH` | _(unset)_ | Path to a sibling shipwright checkout; the loader reads `<path>/shared/profiles`. Use during shipwright dev-loop work. |

Profile resolution order: `SHIPWRIGHT_PROFILES_DIR` → `SHIPWRIGHT_MONOREPO_PATH/shared/profiles` → bundled `server/profiles/`.
Refresh the bundled snapshot with `make sync-profiles` after a profile
edit upstream.

`SHIPWRIGHT_MAX_CONCURRENT` exists in `server/src/config.ts` for legacy
reasons but has no effect under Plan D'' (the WebUI no longer spawns or
limits Claude processes).

### 4.2 Parallel worktrees

Each dev-server pair binds **fixed** ports. To run a second worktree
side by side without a port fight, override both:

```bash
PORT=3848 VITE_PORT=5174 make dev-server
PORT=3848 VITE_PORT=5174 make dev-client
```

Both halves fail loud on port collisions (Vite via `strictPort: true`,
Hono via the bind-error handler in `server/src/index.ts`). The historic
`VITE_ALT_PORT=5177` hardcode was removed in v0.3.2 — set
`VITE_PORT` explicitly.

### 4.3 Custom actions

The `+ New ▾` split-button in the sidebar reads its menu items from a
**resolved actions catalog** per project. By default that catalog is the
bundled [`server/src/config/default-actions.json`](../server/src/config/default-actions.json),
which exposes the four Shipwright modes (`new-task`, `new-pipeline`,
`new-iterate`, `new-plain`).

Drop a file at `<project.path>/.webui/actions.json` to **replace** the
catalog for that project — add buttons for your own slash skills, hide
modes you don't use, or change the labels. The loader is per-project
and mtime-cached; edits show up on next request.

#### When to use it

- You want one of your global Claude skills (`/content-orchestrator`,
  `/audit-foo`, …) on the New-menu instead of typing it after pasting.
- Your team uses a shared internal skill that isn't part of Shipwright.
- You want different menus for different project types (content vs.
  code) without forking the WebUI.

#### Where the file lives

`<project.path>/.webui/actions.json`. The path is **relative to the
project**, not the WebUI install. Two real consequences:

- Different projects can have different menus. Good.
- The file lands inside your project's repo. If it's personal, add
  `.webui/` to your `.gitignore`. If it's a team asset, commit it.

The WebUI reads `.webui/actions.json` and writes only an empty stub on
explicit user action — it never edits a non-empty existing file.

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

After saving, refresh the project in the WebUI. The split-button now
shows your four buttons. Each opens the **generic mode** of the New-Issue
modal (no Shipwright-specific phase picker, no autonomy toggle); the
heading reads from `action.label`, the subheading from
`action.description`.

#### Schema reference

```jsonc
{
  // Schema version. Currently 1. Reader warns on drift; loader keeps
  // going.
  "schemaVersion": 1,

  // Catalog-wide defaults.
  "defaults": {
    "autonomy": "guided"            // "guided" | "autonomous"
  },

  // Action list. The split-button renders them in declared order; the
  // first action is the primary button, the rest live behind the caret.
  "actions": [
    {
      "id": "string",               // unique within the catalog
      "label": "string",            // shown on the button + dropdown
      "kind": "external_launch",    // only kind currently supported
      "description": "string",      // optional; used as subtitle + generic-mode subheading
      "command_template": "string", // see Placeholders below
      "modal_fields": ["title", "description", "phase", "autonomy"], // optional; modal fields to render
      "parameters": [ /* ParamSchema */ ],          // phase-independent CLI params
      "phase_parameters": {                          // phase-bound CLI params (for new-task)
        "<phase-id>": [ /* ParamSchema */ ]
      }
    }
  ],

  // Phases shown in the new-task modal's Phase dropdown. Empty list is
  // a schema error.
  "phases": [
    {
      "id": "string",                              // matches phase_parameters keys
      "label": "string",
      "color": "#RRGGBB",                          // optional
      "supports_autonomy": true                    // optional; toggles AutonomyToggle in task mode
    }
  ],

  // Preview gate for the dev-server spawn (PreviewButton). Default is
  // "auto" (follow profile.stack.frontend). Use false to suppress.
  "preview": { "enabled": "auto" }   // "auto" | true | false
}
```

`ParamSchema` (used by `parameters` and `phase_parameters`):

```jsonc
{
  "name": "section",                   // matches PARAM_NAME_PATTERN
  "label": "Section file",
  "type": "string",                    // "string" | "boolean" | "enum"
  "cli_flag": "--section",             // matches CLI_FLAG_PATTERN, or "@" for positional
  "value_separator": "space",          // "space" | "equals" | "none"
  "enum": ["a", "b"],                  // required for type=enum
  "cli_flag_map": { "a": "--alpha" },  // optional per-enum-value flag override
  "pattern": "^[A-Za-z0-9_./-]+\\.md$",// optional regex validator (string only)
  "default": "01-build.md",            // optional; rendered as placeholder, not pre-filled
  "required": true,                    // optional; renders the field outside Advanced
  "sensitive": true,                   // optional; masks value in command preview
  "helpText": "string",                // optional; below-field hint
  "placeholder": "string"              // optional; input placeholder
}
```

#### Placeholders

`command_template` accepts these tokens (anything else is rejected at
load-time):

| Placeholder | Value |
|---|---|
| `{project.id}` | Project UUID (server-generated, raw — not shell-quoted). |
| `{project.path}` | Project folder absolute path, **shell-escaped** per shell form. |
| `{cd.prefix}` | `cd <path> && ` / `Set-Location <path> -ErrorAction Stop; ` so the pasted command starts with the project as cwd. |
| `{task.uuid}` | Pre-bound session UUID (raw). Goes after `--session-id`. |
| `{task.title}` | Task title, shell-escaped. |
| `{task.description?}` | Trailing space + escaped description (or empty). Newlines are rejected. |
| `{task.phase}` | Phase id from `phases[].id`. Validated against the catalog. |
| `{task.phase_label}` | Human-readable phase label, shell-escaped. |
| `{task.autonomy_flag?}` | ` --autonomous` when `autonomy === "autonomous"`, else empty. |
| `{task.parameters?}` | Resolved CLI flags from the user's modal input (per-shell escaped). |
| `{task.initial_prompt}` | **Bundled-mode only.** Hardcoded slash + autonomy + parameters + description as one quoted prompt. Custom actions must NOT use this placeholder — they emit the slash literally and rely on `{task.description?}` / `{task.parameters?}`. |
| `{plugin.dirs}` | `--plugin-dir <a> --plugin-dir <b>` (or empty). |

User-derived values (`{task.title}`, `{task.description?}`,
`{task.phase_label}`, `{project.path}`) are always shell-escaped. Server
literals (`{task.uuid}`, `{project.id}`, `{task.phase}`) pass through
raw — they're UUIDs or allowlist ids and safe as raw tokens.

#### Generic mode UX

When the action's `id` is **not** one of `new-task` / `new-pipeline` /
`new-iterate` / `new-plain`, the New-Issue modal renders in **generic
mode**:

- Heading reads `New <action.label>` (e.g. "New Content Orchestrator").
- Subheading reads `action.description` if set, else a neutral fallback.
- **No** phase dropdown.
- **No** autonomy toggle (`--autonomous` is Shipwright-specific; declare
  a parameter if your skill needs a similar concept).
- Live command preview replaced by a static hint — the actual command
  is generated server-side from `command_template` and shown on the
  TaskDetail page after Launch.

Title + Description fields stay; that's how the user names the task and
optionally pre-seeds the first prompt.

#### Validation + error handling

The route layer validates every loaded catalog at request time and
surfaces structured errors:

- **Malformed JSON** → bundled default served + non-blocking diagnostic
  chip in the actions response (`actions_file_malformed`). The Task
  Board stays usable.
- **Schema error** (duplicate `id`, missing `command_template`, invalid
  `defaults.autonomy`, empty `phases[]`, unsupported `modal_fields`
  entry, …) → 400 with a structured `code` per
  [`server/src/core/actions-schema-validator.ts`](../server/src/core/actions-schema-validator.ts).
- **Unknown placeholder in `command_template`** → 400
  `template_validation_failed` with the offending token.
- **Unknown `actionId` at launch time** → 400 `unknown_action_id`.
  Triggered when the client requests an action that's not in the
  resolved catalog (e.g. you renamed it but the modal still has the old
  id cached).
- **Unknown phase at launch time** → 400 `command_substitution_failed`.

#### Constraints carried over from Iterate 3

- `command_template` is tokenised + spawned with `shell: false` on the
  server. User-controlled strings can't escape into a sub-shell —
  attempts to embed shell metacharacters are escaped per shell form, not
  evaluated.
- The path-guard for tree + file routes uses `realpath + path.relative`,
  not `startsWith`. Symlinks, junctions, and Unicode-equivalent paths
  can't bypass it.
- `{task.initial_prompt}` is bundled-mode only — see Placeholders above.
  Custom actions using it raise `UnknownActionError`.

---

## 5. Architecture in one page

- Hono (Node 20+) backend, React 19 / Vite 6 frontend, TailwindCSS 4 +
  Radix UI.
- **No** chat composer (ADR-034). The user's terminal is the source of
  truth; the WebUI is a read-only observer.
- Discovery is filename-first: `<uuid>.jsonl` under
  `~/.claude/projects/<encoded-cwd>/`. First-line `sessionId` is the
  sanity check.
- Transcript fetch is stateless per request: `?fromByte=N&expectFingerprint=fp`.
  Multi-tab works by construction. UTF-8-safe chunking on `\n`
  boundaries, with a torn-read retry budget for EBUSY/EPERM/EACCES/ENOENT.
- 1 s client polling via `useTaskTranscript`. **No SSE**, **no chokidar**.
- Multi-project task metadata at
  `~/.shipwright-webui/{projects,sdk-sessions,settings}.json` with
  `proper-lockfile`-guarded writes. PATCH `/tasks/:id` surfaces ELOCKED
  as 409 so multi-tab clients can retry.
- Detailed internals + load-bearing DO-NOT guards in
  [`CLAUDE.md`](../CLAUDE.md) and `agent_docs/decision_log.md`.

---

## 6. Troubleshooting

### `EADDRINUSE: 3847 is in use`

Another worktree's backend is bound, or a stale `tsx watch` from a
previous session.

```bash
# Find the PID
netstat -ano | findstr :3847    # Windows (cmd / PowerShell)
lsof -i :3847                   # macOS / Linux

# Kill it
taskkill //F //PID <pid>        # Windows (Git Bash — note the //F)
kill -9 <pid>                   # macOS / Linux
```

Or use the bundled helper:

```bash
cd server && npm run dev:fresh
```

`dev:fresh` reads `PORT` and `VITE_PORT` from the environment and only
kills the two configured ports — never anything else.

### Recent code changes don't show up

`tsx watch` on Windows occasionally goes stale on rapid restarts. Kill
the PID on `:3847` explicitly with the recipe above, then `make
dev-server` again. The Hono server now exits with a deterministic
operator message on `EADDRINUSE`, `EACCES`, and `EADDRNOTAVAIL` since
v0.3.2 — silent half-starts are the previous regression we paid down.

### Diagnostic banner: "Claude CLI < MIN_SUPPORTED_CLI"

Update the Claude Code CLI:

```bash
claude --version
# If older than the value in server/src/core/cli-compat.ts:
npm install -g @anthropic-ai/claude-code   # or your preferred install path
```

Plan D'' assumes specific CLI behaviour from v2.1.114 onwards (per the
PoC in `~/.claude/plans/external-launch-poc-results.md`). Older versions
may launch but the WebUI's discovery / parsing assumptions are
unverified there.

### Malformed `.webui/actions.json` chip

The diagnostic chip means the file failed JSON parsing or schema
validation. The bundled defaults are in use — the project keeps
working, but your custom buttons are gone until the file is fixed.
Check the chip's hover text for the parser error and validate against
[§4.3](#43-custom-actions). Common causes: trailing commas, unescaped
backslashes in `command_template`, unknown placeholder tokens, duplicate
action `id`.

### Tasks created but no JSONL appears

The WebUI never spawns Claude. After clicking **Launch**, you must paste
the copied command in your own terminal — only then does Claude write
the JSONL file the WebUI is watching. The TaskDetail page will sit at
"Awaiting external start" until the JSONL appears at
`~/.claude/projects/<encoded-cwd>/<task.sessionUuid>.jsonl`.

If the file exists but the WebUI doesn't pick it up, check:

- That the project's `path` matches the cwd in which you ran Claude
  (the encoded-cwd folder name is derived from this).
- That the session uuid matches (`Get-Content ~/.claude/projects/<cwd>/*.jsonl
  | Select-Object -First 1`).
- The `/api/diagnostics` endpoint for any session-watcher errors.

### Two tabs fight over the same task

Multi-tab is supported by construction (transcript reads are stateless,
PATCH writes go through a `proper-lockfile`). If you see HTTP 409 from
PATCH `/api/external/tasks/:id`, retry the request — the other tab won
the lock for that round.
