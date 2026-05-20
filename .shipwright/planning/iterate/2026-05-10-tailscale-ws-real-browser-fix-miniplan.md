# Mini-Plan: tailscale-ws-real-browser-fix

- **Run ID:** iterate-2026-05-10-tailscale-ws-real-browser-fix
- **Type:** bug
- **Complexity:** medium

## Empirically reproduced root cause

Curl-driven WS upgrade probe against the live Hono on `100.64.0.1:3847`
with three distinct Origin headers, real task UUID:

| Origin | Result |
|---|---|
| `http://localhost:5173` | 101 Switching Protocols + ready envelope + pty live data |
| `http://webui-host.tailnet.ts.net:5173` | 500 Internal Server Error |
| `http://100.64.0.1:5173` | 500 Internal Server Error |

The HTTP CORS gate (separate `OPTIONS /api/external/tasks` probe) accepts
ALL three origins with `Access-Control-Allow-Origin` echoed back. So the
profile-tailscale policy is wired correctly for HTTP. The 500 on WS is
**only** the WS upgrade path.

## Single-line localisation

[server/src/terminal/routes.ts:93-95](server/src/terminal/routes.ts#L93-L95):

```ts
function defaultAllowedOrigins(origin: string | null): boolean {
  return resolveTrustedOrigins(process.env).isAllowed(origin);
}
```

`resolveTrustedOrigins` is called WITHOUT the `exec` second argument. Per
[server/src/lib/resolveTrustedOrigins.ts:122](server/src/lib/resolveTrustedOrigins.ts#L122),
the `SHIPWRIGHT_NETWORK_PROFILE` branch is `if (exec)`-gated — without
exec, the function falls through to default loopback-only. The HTTP CORS
gate at [server/src/index.ts:77-80](server/src/index.ts#L77-L80) DOES pass
`tailscaleExecForOrigin` and so resolves correctly to `profile-tailscale`.

The boot log line "Trusted-Origin policy: SHIPWRIGHT_NETWORK_PROFILE=
tailscale → loopback + 100.64.0.1 + *.ts.net accepted" comes from
the HTTP CORS policy describe() — exactly the policy that DOES work. The
unit tests that supposedly proved the WS gate work (29+23 tests in
`resolveTrustedOrigins.test.ts`) all pass `exec` — they exercise the
code path the WS gate does NOT take in production.

This is a textbook case of `feedback_browser_fixes_need_real_browser_smoke.md`
firing: unit-tests + boot-log alignment did not catch a divergence
between the two call sites.

## Fix design

**Approach:** Single source of truth — compute the policy ONCE at boot
in `index.ts`, pass `corsOriginPolicy.isAllowed` as `deps.allowedOrigins`
into `createTerminalRoutes`. The `defaultAllowedOrigins` fallback in
`terminal/routes.ts` stays for tests that don't wire deps, but production
(index.ts) explicitly wires the live-policy.

Diff shape:

```ts
// server/src/index.ts — at the createTerminalRoutes call site
createTerminalRoutes({
  store: sdkSessionsStore,
  ptyManager,
  upgradeWebSocket,
  pastesKeepLast: config.claudePastesKeepLast,
  scrollbackStore,
  retentionDays: config.terminalScrollbackTtlDays,
  scrollbackDirHint: config.terminalScrollbackDir,
  allowedOrigins: corsOriginPolicy.isAllowed,  // NEW
})(app);
```

That's the entire production fix: one new line at the wiring site.

**Why not fix `defaultAllowedOrigins`?** Two reasons:
1. Per-request `resolveTrustedOrigins(process.env, exec)` would spawn
   `tailscale ip -4` on every WS upgrade — unacceptable cost.
2. It would create two policy instances (one for HTTP, one for WS)
   that could drift at boot if the resolver were stateful.

Fixing at the wiring site forces ONE policy instance for both gates.

**Defensive followup:** Add a guard log in `defaultAllowedOrigins` so a
future call-site that forgets to wire `allowedOrigins` produces an
operator-visible WARN at the first WS upgrade attempt — instead of
silent loopback-only fallback. Out-of-scope for this iterate's
acceptance criteria; tracked as a separate observation in `conventions.md`.

## Files to change

| File | Change |
|---|---|
| `server/src/index.ts` | Add `allowedOrigins: corsOriginPolicy.isAllowed` to the `createTerminalRoutes({...})` deps object |
| `server/src/lib/resolveTrustedOrigins.test.ts` | NEW: test that the policy returned by `resolveTrustedOrigins(env, exec)` accepts MagicDNS hosts and rejects lookalikes (already covered) — but ADD a SECOND test asserting that the same policy instance is consumed by terminal/routes.ts wiring (integration shape) |
| `server/src/terminal/routes.test.ts` | NEW or UPDATE: integration-style test that wires deps with allowedOrigins set to a profile-tailscale policy and asserts the WS upgrade gate accepts MagicDNS Origin (regression for THIS bug) |
| `client/e2e/flows/v091-tailscale-ws.spec.ts` | NEW: Playwright spec, opens `http://webui-host.tailnet.ts.net:5173/`, creates task, navigates to detail, asserts WS upgrade succeeds + terminal pane renders. F0.5 surface=web runner. |
| `CHANGELOG-unreleased.d/Fixed/iterate-2026-05-10-tailscale-ws-real-browser-fix_001.md` | F4 drop |
| `.shipwright/agent_docs/decision_log.md` | F3 ADR-084 — divergence between HTTP and WS gates, single-source-of-truth fix |
| `.shipwright/agent_docs/iterates/iterate-2026-05-10-tailscale-ws-real-browser-fix.json` | F5c entry |

## Test strategy (TDD)

1. **RED**: Add a regression test that wires `createTerminalRoutes` deps
   with NO `allowedOrigins` (so it uses `defaultAllowedOrigins`), sets
   `process.env.SHIPWRIGHT_NETWORK_PROFILE=tailscale`, and asserts that
   the WS upgrade gate REJECTS a MagicDNS Origin. This codifies the bug
   shape — which we then change to expect ACCEPTANCE after the fix
   passes the boot-time-resolved policy through. Test SHOULD fail
   pre-fix (reproducing the actual bug) and pass post-fix.
2. **GREEN**: Wire `allowedOrigins: corsOriginPolicy.isAllowed` in
   index.ts.
3. **Run unit suite**: `npm --prefix server run test` — all 848 server
   tests must pass + new regression must be green.
4. **F0.5 surface=web**: Playwright spec executed against the live
   Tailscale URL. Spec opens `http://webui-host.tailnet.ts.net:5173/`,
   asserts WS upgrade succeeds (via `page.on("websocket")`), terminal
   pane shows the prompt or replay separator.

## Risk flags

- `touches_middleware` — Origin gate change affects all WS upgrades
- `touches_io_boundary` — `process.env` semantics + .env.local flow

Override Classes: medium + middleware + io_boundary → mandatory full
review (External LLM Review auto + Self-Review + Boundary Probe sub-
step + Confidence Calibration).

## Cleanup

- Delete the probe task (`a065932f-...`) — DONE during reproduction.
- Leave PID 7800 (user's Hono) and PID 2872 (user's Vite) untouched
  during code edits; restart only at fix-apply time so the running
  workflow on Tailscale gets the new code path.
- The `VITE_HOST=true` shell env var in the user's terminal is
  out-of-scope for this iterate (it's a stale shell-state issue, not a
  code bug). It does NOT cause the WS bug — both `narrow tailscale-IP
  bind` and `wildcard bind` Vite both proxy to Hono identically; the
  WS gate failure is server-side. Note in conventions.md as a
  troubleshooting tip.
