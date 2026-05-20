# Mini-Plan: env-local-loading-fix

- **Run ID:** iterate-2026-05-10-env-local-loading-fix
- **Spec:** [2026-05-10-env-local-loading-fix.md](2026-05-10-env-local-loading-fix.md)

## Approach

Two small surgical changes; each side independent.

### Server — Node-native `--env-file-if-exists`

`server/package.json` `"dev"` script is currently:
```
"dev": "tsx watch src/index.ts"
```

Becomes:
```
"dev": "tsx --env-file-if-exists=../.env.local watch src/index.ts"
```

- Node 20.12+ supports `--env-file-if-exists` (non-fatal when file
  absent). Repo is on Node v24.15.0 per install-windows.ps1 output.
- `tsx` passes Node flags through to the underlying Node runtime
  (documented behavior).
- Path `../.env.local` is relative to `server/` cwd, resolves to
  repo-root `.env.local`. The dev script always runs from `server/`.
- The `dev:fresh` script (`node ../scripts/dev-restart.js`) does NOT
  need the flag because dev-restart.js just kills processes and
  spawns `npm run dev` which already has the flag.

Zero new deps. No code changes in server source (`process.env` is now
populated by Node's loader at startup).

### Client — vite.config.ts `loadEnv` with empty prefix

`client/vite.config.ts` currently passes `process.env` to resolvers.
Replace with merged env from `loadEnv(mode, repoRoot, "")`:

```ts
import { defineConfig, loadEnv } from "vite";
import path from "node:path";
import { execSync } from "node:child_process";
import { resolveViteHost } from "./src/lib/resolveViteHost";
import { resolveProxyTarget } from "./src/lib/resolveProxyTarget";
import type { TailscaleIpExec } from "./src/lib/resolveTailscaleIp";

export default defineConfig(({ mode }) => {
  // Repo root = one up from client/. .env.local lives there per
  // ADR-081's .env.example. Empty prefix loads ALL keys, not just
  // VITE_*. process.env takes precedence (CLI-prefix backward compat).
  const envFromFile = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const env: Record<string, string | undefined> = {
    ...envFromFile,
    ...process.env,
  };
  const tailscaleExec: TailscaleIpExec = (cmd, opts) =>
    String(execSync(cmd, opts as Parameters<typeof execSync>[1]));
  const hostConfig = resolveViteHost(env, tailscaleExec);
  const proxyTarget = resolveProxyTarget(env, tailscaleExec);
  // ... rest of config unchanged
});
```

**Precedence:** `{...envFromFile, ...process.env}` → process.env wins
on conflict, so explicit CLI `VITE_HOST=true npm run dev` still
overrides whatever `.env.local` says. Backward compat preserved.

**Refactor:** vite.config currently exports `defineConfig({...})`
directly; needs to switch to `defineConfig(({ mode }) => ({...}))` to
get `mode` for loadEnv. Mechanical refactor.

## Files

| File | Op | LOC delta |
|---|---|---|
| `server/package.json` | Edit (1 line in scripts.dev) | +1/-1 |
| `client/vite.config.ts` | Edit (loadEnv + function form) | +10/-2 |
| `client/src/lib/resolveViteHost.test.ts` | Edit (add empty-string-explicit test) | +20 |
| `client/src/lib/resolveProxyTarget.test.ts` | Edit (add precedence regression test) | +15 |
| `server/src/lib/resolveHonoHost.test.ts` | Edit (add empty-string regression) | +15 |
| `docs/guide.md` | Edit (mention .env.local now works) | +5/-2 |
| `.env.example` | Edit (note "no command-line prefix needed") | +3/-0 |

Total: 7 edits, 0 new files (this is a wiring fix, not new functionality).

## Test Strategy

### Author-time

Existing 60+ resolver tests already cover the env→bind logic. NEW tests
focus on **the wiring boundary**:

1. **Empty-string env-var = unset.** `env.VITE_HOST = ""` → resolver
   falls through to profile. Regression test in resolveViteHost +
   resolveHonoHost test suites. (Same for SHIPWRIGHT_NETWORK_PROFILE).

2. **`{...envFromFile, ...process.env}` precedence test.** Synthesize
   two env-shapes simulating "loaded .env.local" + "CLI override" and
   assert process.env wins. Lives in `resolveProxyTarget.test.ts` as
   a precedence smoke (uses real merge logic).

3. **Manual smoke (operator action, documented in test_results.json
   degraded):**
   - `.env.local` contains `SHIPWRIGHT_NETWORK_PROFILE=tailscale`
   - Run `cd server && npm run dev` (no prefix) → netstat shows
     `100.x.x.x:3847`.
   - Run `cd client && npm run dev` (no prefix) → Vite log shows
     `http://100.x.x.x:5173/` as the ONLY Network address.

4. **Negative: missing .env.local.** Temporarily rename `.env.local`
   → `.env.local.bak` (or test on a fresh checkout without it),
   start both servers → bind to loopback (default), no error. The
   `--env-file-if-exists` flag must not hard-fail; vite's loadEnv
   must return `{}` (Vite's documented behavior for missing file).
   This is operator-validated, not CI-gated.

### F0.5 (production-time chokepoint)

- **Surface:** `cli`
- **Runner:** server + client resolver test suites via vitest

### Risk-flag enforcement

- `touches_io_boundary` — env-file path change. Boundary Probe via
  the regression tests above.
- `touches_build` (`vite.config.ts`, `package.json`) — Performance
  Budget SKIP with justification: server-only dev-script tweak +
  vite-config wiring; no client bundle output change (env-driven
  branching at vite-init only).

## Review-Findings Disposition

| # | Reviewer | Sev | Finding | Action |
|---|---|---|---|---|
| #1 | OpenAI | HIGH | `tsx` flag forwarding not guaranteed | VERIFIED empirically — `tsx v4.21.0` + Node v24.15.0 forwards `--env-file-if-exists` correctly. Both direct-node and tsx pick up env-file values. |
| #2 | OpenAI | HIGH | `../.env.local` cwd assumption | VERIFIED — npm scripts always run with `package.json` parent as PWD per npm docs. Both `cd server && npm run dev` AND `npm --prefix server run dev` set PWD=server/. `../.env.local` IS reliable. |
| #3 (Gemini) | Gemini | HIGH | Vite `envDir` defaults to `client/` — `import.meta.env.VITE_*` would still look there | INCORPORATED — add `envDir: path.resolve(__dirname, "..")` to vite config so browser-bundle env source aligns with vite-config-time env source. |
| #6 | OpenAI | MED | Formalize Node 20.12+ requirement | INCORPORATED — add `engines.node` to both `server/package.json` and `client/package.json`. |
| #7 | OpenAI | MED | function-form vite.config affects `vite build` too | NOTED — verified `npm run build` works post-fix (loadEnv runs in both `serve` and `build` modes; mode='production' for build). |
| #8 | OpenAI | MED | Resolver tests don't verify actual process wiring | INCORPORATED — add a vitest spawn-test that runs `tsx --env-file-if-exists=<fixture>` and asserts the loaded value appears in process.env. Catches the wiring boundary. |
| #4 | OpenAI | MED | Parser differences server vs client | INCORPORATED — fixture-based smoke uses simple `KEY=value` (no quotes / no escapes) which both parsers handle identically. Quoted-value edge cases out of scope per spec. |
| #5 | OpenAI | MED | Shell-inherited env wins over .env.local — surprising precedence | INCORPORATED — update docs/guide.md + `.env.example` to state precedence explicitly: "process.env (shell + CLI prefix) wins over .env.local". |
| #3 (O) | OpenAI | MED | loadEnv empty prefix loads other env files too (.env, .env.development, ...) | NOTED — acceptable behavior (matches user expectation of "Vite's env loading"). Documented in `.env.example`. |
| #9 | OpenAI | LOW | loadEnv security blast radius | INCORPORATED — comment in vite.config restricts merged env to the two resolver calls only; not exposed elsewhere. |
| #10 | OpenAI | LOW | Tailscale-specific smoke is environment-dependent | INCORPORATED — alongside the manual Tailscale smoke, the new spawn-test gives a Tailscale-free deterministic CI gate. |

## Risk Notes

- **`--env-file-if-exists` requires Node 20.12+.** Repo is on Node
  v24.15.0. Documented minimum in CLAUDE.md is implicit; could
  formalize as a separate iterate. For now: assume Node 20.12+ since
  any user installing this app from scratch will be on a modern
  Node (the repo's own packages require Node 20+).
- **loadEnv with empty prefix loads EVERYTHING.** This could
  surface non-VITE_ keys that should stay private (e.g. server-side
  API keys). Mitigation: we don't expose `env` to the browser
  bundle — it's used only at vite-config-load time on the Node side.
  `import.meta.env` (browser bundle) still respects the VITE_*
  prefix filter (Vite's own filter for browser exposure).
- **Precedence change risk.** Today only `process.env` is read. After:
  `{...envFromFile, ...process.env}`. If `.env.local` has a key the
  user had set in shell to something different, `.env.local` wins
  for keys NOT in process.env, and shell wins for keys IN process.env.
  Today's shell-only behavior is preserved (process.env wins).

## Alternative Considered

**Userland `dotenv` package on the server.** Rejected — adds a new
runtime dep when Node's native `--env-file` is bundled, free, and
zero-config. Same end behavior.

**`dotenv-cli` or `cross-env`.** Rejected — same reason; pure
overhead for a single-line Node flag.

**Single shared loader script across both halves.** Rejected — the
loaders run at different process-startup times (Node-flag-driven
on server vs Vite-internal `loadEnv` on client). Each side uses
its native idiom.
