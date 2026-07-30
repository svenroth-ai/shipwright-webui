# Mini-plan — D12 spawn-env-port-strip (F17)

## Problem
`buildSpawnEnv` (server/src/terminal/spawn-env.ts) spreads the entire webui
SERVER `process.env` into every embedded-terminal pty and strips only
FORCE_COLOR + the CLAUDE_CODE_* parent-session identity markers. The
production launchers stamp `PORT` explicitly (start-server-production.sh:
`PORT="$PORT" nohup node ...`, default 3847; install-windows.ps1 autostart:
`cmd /c set PORT=3847 && node ...`), so on a deployed server
`process.env.PORT === "3847"` and that value — plus its sibling network vars
VITE_PORT / HONO_HOST — leak into the pty. A PORT-honouring dev server started
inside the embedded terminal (another webui, a Vite app, any server that reads
PORT) then binds 3847 and collides with the webui itself.

## Alternatives considered
1. **Blanket-strip all SHIPWRIGHT_*/webui-config vars** — rejected: scope creep
   and it breaks live contracts. SHIPWRIGHT_TERMINAL_NO_FLICKER /
   _LEGACY_BRAND_COLORS are consumed by buildSpawnEnv itself; SHIPWRIGHT_WEBUI
   is set intentionally as the spawn marker. A blanket sweep is a wrong-shape
   abstraction (Chesterton's Fence).
2. **Strip only PORT** — rejected: VITE_PORT + HONO_HOST are the same leak class
   named in the finding's fix direction; leaving them is a half-fix.
3. **Chosen: narrow strip-list `["PORT","VITE_PORT","HONO_HOST"]`** deleted
   AFTER the base+caller merge, mirroring the existing PARENT_SESSION_ENV_KEYS
   pattern one line above. Surgical, symmetric, testable.

## Decision trace
- Strip runs after the callerEnv merge so neither the server's own env nor a
  caller can re-leak the vars (symmetry with the parent-session strip).
- VITE_PORT is a client/Vite-only var (server never reads it) but is stamped by
  dev-restart.js and can be present in a dev-loop server env — strip it too.
- New co-located test file spawn-env.test.ts (spec-mandated); flicker/color/
  marker semantics stay pinned in pty-env-flicker.test.ts.

## Files (footprint contract)
- server/src/terminal/spawn-env.ts (+~25 lines: strip-list const + delete loop + comment)
- server/src/terminal/spawn-env.test.ts (new)

## Invariants preserved
- ADR-067 shell-only pty whitelist untouched (env-map only, no spawn-target change).
- buildSpawnEnv remains the SOLE pty-env chokepoint.
- SHIPWRIGHT_WEBUI marker, CLAUDE_CODE_NO_FLICKER default-ON, parent-session
  strip all unchanged.
- spawn-env.ts NOT in shipwright_bloat_baseline.json; stays < 300 LOC.
