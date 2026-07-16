# `@svenroth-ai/shipwright`

**One command to install _and_ update Shipwright** — the `/shipwright-*` SDLC
plugins **and** the Command Center, first run and every run after.

```bash
npx @svenroth-ai/shipwright@latest
```

> Always include `@latest`. A bare `npx @svenroth-ai/shipwright` can silently
> reuse a cached older copy; the tool also self-checks the registry and warns
> you when you are behind.

## What it does

Running the command, in order:

1. **Self-version check** — warns (never fails) if a newer version is published.
2. **Preflight** — verifies the prerequisites the plugins actually need: the
   `claude` CLI, `uv`, a working Python (test-run, not the Microsoft-Store
   `python3` stub), Node >= 20.12.0, and git. A missing one is a loud,
   actionable failure — not a dead install that _looks_ fine.
3. **Plugins** — `claude plugin marketplace add/update svenroth-ai/shipwright`,
   then installs/updates **every plugin read from the marketplace manifest**
   (never a hardcoded list), then **syncs the plugin cache** so each plugin's
   hooks (`uv run "${CLAUDE_PLUGIN_ROOT}/../../shared/…"`) actually resolve —
   the step `claude plugin install` alone skips, which otherwise leaves every
   hook dead at session start.
4. **Command Center** — probes `:3847`. Free → starts the packaged server;
   already running the **same** version → opens it (no second server); an
   **older** version → swaps it (via a detached swapper, so it is safe to run
   from inside the Command Center's own terminal); a **foreign** process →
   fails loud and leaves it running (`PORT=<n>` to pick another port).
5. **Summary** — reports exactly what happened. When plugins changed, it prints
   the one thing it cannot do for you: **restart Claude Code** so the freshly
   installed plugins activate in a new session.

## Options

| Flag | Effect |
| --- | --- |
| `--no-open` | do not open the browser (CI / headless) |
| `--plugins-only` | install/update plugins, skip the Command Center |
| `--webui-only` | boot/attach the Command Center, skip the plugin phase |
| `--port <n>` | Command Center port (default `3847`, or `PORT` env) |
| `--version`, `-v` | print this package's version |
| `--help`, `-h` | help |

## Notes

- The bundled server + client are **built** — re-running the command **is** the
  update. Only `@lydell/node-pty` resolves a native binary at install time.
- Publishing is a **manual** step performed by the maintainer.

MIT © svenroth.ai
