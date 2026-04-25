# Shipwright Command Center — User Guide

How to install, run, configure, and troubleshoot the WebUI.

## Table of contents

1. [Installation](#1-installation)
2. [Updating](#2-updating)
3. [Autostart on Windows](#3-autostart-on-windows)
4. [Configuration](#4-configuration)
   - [4.1 Environment variables](#41-environment-variables)
   - [4.2 Parallel worktrees](#42-parallel-worktrees)
   - [4.3 Custom actions](#43-custom-actions)
5. [Troubleshooting](#5-troubleshooting)

---

## 1. Installation

### Prerequisites

- Node.js 20+ and npm 10+ (`node --version`, `npm --version`)
- Claude Code CLI ≥ `MIN_SUPPORTED_CLI` (currently `2.1.114`). Older
  versions are not supported.
- Git

### Clone + install

```bash
git clone https://github.com/svenroth-ai/shipwright-webui.git
cd shipwright-webui
make install
```

`make install` runs `npm install` in `server/` and `client/`. Without
`make`:

```bash
cd server && npm install
cd ../client && npm install
```

### Run

Open two terminals from the repo root:

```bash
# Terminal 1 — backend on http://localhost:3847
make dev-server

# Terminal 2 — frontend on http://localhost:5173
make dev-client
```

Then open <http://localhost:5173> and register your first project. The
WebUI watches `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` for that
project's Claude sessions.

Keep both halves running — the frontend proxies `/api/*` to the
backend.

### Production build

```bash
make build
```

Outputs `client/dist/` (static assets) and `server/dist/` (compiled JS).
Serve `server/dist/index.js` with `node`; the backend serves
`client/dist/` as static files when present.

---

## 2. Updating

```bash
git pull
make install
```

Restart both halves. If `tsx watch` was running, kill it first — see
[§5 Troubleshooting](#5-troubleshooting).

---

## 3. Autostart on Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

This:

1. Verifies Node.js is installed.
2. Runs `npm install` in `server/` and `client/`.
3. Builds the client (`npm run build`).
4. Writes a hidden VBS launcher to
   `~\.shipwright-webui\start-server.vbs` (logs to
   `~\.shipwright-webui\server.log`).
5. Drops a startup shortcut into the Windows **Startup** folder.

After login, the backend is reachable at <http://localhost:3847>. Open
the frontend with `make dev-client` or wire your own browser shortcut.

### Custom port

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -Port 3848
```

### Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -Uninstall
```

Removes the startup shortcut and the VBS launcher. The repo is left
untouched.

### macOS / Linux

No first-party autostart helper. Wire `make dev-server` into launchd /
systemd / tmux as you prefer.

---

## 4. Configuration

### 4.1 Environment variables

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `3847` | Backend bind port. Vite reads this so `/api` proxies to the matching backend. |
| `VITE_PORT` | `5173` | Frontend bind port. Fails loud on collision. |
| `SHIPWRIGHT_PROFILES_DIR` | _(unset)_ | Explicit path to a stack-profiles directory. Highest precedence. |
| `SHIPWRIGHT_MONOREPO_PATH` | _(unset)_ | Path to a sibling shipwright checkout; the loader reads `<path>/shared/profiles`. |

Profile resolution order: `SHIPWRIGHT_PROFILES_DIR` →
`SHIPWRIGHT_MONOREPO_PATH/shared/profiles` → bundled `server/profiles/`.
Refresh the bundled snapshot with `make sync-profiles`.

### 4.2 Parallel worktrees

To run a second pair of dev servers side by side, override both ports:

```bash
PORT=3848 VITE_PORT=5174 make dev-server
PORT=3848 VITE_PORT=5174 make dev-client
```

### 4.3 Custom actions

The `+ New ▾` split-button reads its menu items from a per-project
catalog. By default that catalog is the bundled
[`server/src/config/default-actions.json`](../server/src/config/default-actions.json),
which exposes four entries (`new-task`, `new-pipeline`, `new-iterate`,
`new-plain`).

Drop a file at `<project.path>/.webui/actions.json` to replace the
catalog for that project — add buttons for your own slash skills, hide
entries you don't use, or change labels. Edits show up on next request
(mtime-cached).

#### When to use it

- You want one of your slash skills (`/content-orchestrator`,
  `/audit-foo`, …) on the New-menu.
- You want different menus for different project types.

#### Where the file lives

`<project.path>/.webui/actions.json` — relative to the project, not the
WebUI install. If it's personal, add `.webui/` to your project's
`.gitignore`. If it's a team asset, commit it.

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

After saving, refresh the project in the WebUI. The split-button shows
your four buttons. Each opens the **generic mode** of the New-Issue
modal: heading reads from `action.label`, subheading from
`action.description`, no phase picker, no autonomy toggle.

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
      "modal_fields": [                  // optional
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
  generated at Launch and shown on the TaskDetail page.

Title + Description fields stay; Description is the first prompt Claude
sees.

#### Validation

| Failure | Result |
|---|---|
| Malformed JSON | Bundled default served + diagnostic chip (`actions_file_malformed`). The Task Board stays usable. |
| Schema error (duplicate `id`, missing `command_template`, invalid `defaults.autonomy`, empty `phases[]`, unsupported `modal_fields` entry, …) | 400 with a structured `code`. |
| Unknown placeholder in `command_template` | 400 `template_validation_failed` with the offending token. |
| Unknown `actionId` at launch | 400 `unknown_action_id`. |
| Unknown phase at launch | 400 `command_substitution_failed`. |

#### Constraints

- `command_template` is tokenised; user input is escaped per shell, not
  evaluated.
- `{task.initial_prompt}` is bundled-mode only. Custom actions using it
  raise `UnknownActionError`.

---

## 5. Troubleshooting

### `EADDRINUSE: 3847 is in use`

Find and kill the process:

```bash
# Windows (cmd / PowerShell)
netstat -ano | findstr :3847
taskkill /F /PID <pid>

# macOS / Linux
lsof -i :3847
kill -9 <pid>
```

Or use the bundled helper, which only kills the configured ports:

```bash
cd server && npm run dev:fresh
```

### Recent code changes don't show up

`tsx watch` on Windows occasionally goes stale on rapid restarts. Kill
the PID on `:3847` with the recipe above, then `make dev-server` again.

### Diagnostic banner: "Claude CLI < MIN_SUPPORTED_CLI"

Update the Claude Code CLI:

```bash
claude --version
npm install -g @anthropic-ai/claude-code
```

### Malformed `.webui/actions.json` chip

The file failed JSON parsing or schema validation. The bundled defaults
are in use. Hover the chip for the parser error and validate against
[§4.3](#43-custom-actions). Common causes: trailing commas, unescaped
backslashes in `command_template`, unknown placeholder tokens, duplicate
action `id`.

### Tasks created but no JSONL appears

After clicking **Launch**, paste the copied command in your terminal.
The TaskDetail page sits at "Awaiting external start" until the JSONL
appears at
`~/.claude/projects/<encoded-cwd>/<task.sessionUuid>.jsonl`.

If the file exists but the WebUI doesn't pick it up, check:

- The project's `path` matches the cwd in which you ran Claude.
- The session uuid matches:
  ```bash
  Get-Content ~/.claude/projects/<cwd>/*.jsonl | Select-Object -First 1
  ```
- `/api/diagnostics` for session-watcher errors.

### Two tabs return HTTP 409 from PATCH `/api/external/tasks/:id`

Retry the request — the other tab won the lock for that round.
