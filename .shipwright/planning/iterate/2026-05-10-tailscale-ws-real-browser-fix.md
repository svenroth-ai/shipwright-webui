# Iterate Spec: tailscale-ws-real-browser-fix

- **Run ID:** iterate-2026-05-10-tailscale-ws-real-browser-fix
- **Type:** bug
- **Complexity:** medium
- **Status:** draft

## Goal

The embedded terminal (xterm.js) and the auto-launch dispatch from `Resume` /
`Launch` CTA do not work when the WebUI is opened over Tailscale at
`http://webui-host.tailnet.ts.net:5173/`, despite three commits today
(`f852a36`, `5528ae2`, `4479736`) that were declared green based on
unit-tests + boot-log inspection alone. This iterate empirically drives the
real browser → Vite proxy → Hono WS upgrade → xterm render path, identifies
the actual chain failure point, and ships a verifiable fix gated by
Playwright executed against the real Tailscale MagicDNS URL.

## Acceptance Criteria

- [ ] **AC-1:** With `SHIPWRIGHT_NETWORK_PROFILE=tailscale` in `.env.local`
      and both dev servers running, opening
      `http://webui-host.tailnet.ts.net:5173/` in a real Chromium
      browser, navigating to a task detail page, and clicking `Launch` /
      `Resume` causes the WS upgrade at
      `/api/terminal/<taskId>/ws` to succeed (HTTP 101) — verified via
      Playwright `WebSocket` event API.
- [ ] **AC-2:** After WS upgrade succeeds, the embedded terminal pane (xterm
      DOM container) receives `ready` envelope from the server and shows
      either the live shell prompt or the replay-restored separator —
      verified via Playwright DOM assertion on the terminal container's
      visible text content.
- [ ] **AC-3:** The auto-execute dispatch (`LaunchCoordinatorContext.dispatchAutoLaunch`)
      delivers the launch command keystrokes through the WS data-frame so
      the user sees the launcher line typed into the pty — verified by
      Playwright reading xterm container text after `Resume` click and
      asserting the launcher tokens (e.g. `claude --resume <uuid>`)
      appear within 5 seconds.
- [ ] **AC-4:** The fix does not regress the loopback path: opening
      `http://localhost:5173/` (loopback Origin) still upgrades and
      renders the terminal — verified via the same Playwright runner.
- [ ] **AC-5:** A Playwright spec
      `client/e2e/flows/v091-tailscale-ws.spec.ts` covering AC-1..AC-4
      lands in the repo and is invokable via the F0.5
      `surface_verification.py --surface web` runner.

## Affected FRs

- {FR for embedded terminal WS upgrade — derived from architecture.md
  Terminal section + ADR-067 / ADR-068-A1; specific FR-id to be
  identified during F1 drift-check}
- {FR for network-profile flag end-to-end behaviour — derived from
  ADR-081 / ADR-082 / ADR-083}

## Out of Scope

- Refactoring the trusted-origin policy structure (already iterated
  thoroughly across ADR-081/082/083).
- Production HTTPS/TLS termination for Tailscale (separate decision).
- Changing the WS auth model (Plan-D'' shell-only whitelist stays).
- Adding a non-loopback default — `local` profile remains the safe default.
- Vite HMR WebSocket on port 5173 (separate Vite-internal channel; only
  relevant if its mounting actually breaks app render — to be confirmed
  during reproduction).

## Design Notes

This is a server/client config / proxy bug — no UI mockup change. The
xterm pane already exists and renders correctly on loopback. No design
fidelity work required. The only visible difference is "terminal works /
doesn't work" on the same task detail page.

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `.env.local` (operator) | `vite.config.ts loadEnv` + Node `--env-file-if-exists` | env-file |
| Browser `Origin` header | `terminal/routes.ts` WS upgrade gate via `resolveTrustedOrigins` | HTTP header |
| Vite proxy upgrade request | Hono WS upgrade handler | HTTP upgrade with forwarded headers |

The Origin header is the actual boundary in question — what the browser
sends, what Vite proxy forwards, what `@hono/node-ws` sees on the
upgrade-event handler, and what `resolveTrustedOrigins(...).isAllowed()`
gets called with. Each hop preserves or rewrites headers; one of those
hops is misaligned with the unit-tested expectation.

## Confidence Calibration

**Status:** populated AFTER reproduction-in-real-browser AND after the
fix landed + was empirically re-verified.

- **Boundaries touched:**
  - Browser `Origin` header → Vite proxy (preserved despite
    `changeOrigin: true`, which rewrites only Host) → Hono `@hono/node-ws`
    upgrade handler → `resolveTrustedOrigins(env, exec).isAllowed()`.
  - `.env.local` `SHIPWRIGHT_NETWORK_PROFILE=tailscale` → Hono's
    `process.env` via Node `--env-file-if-exists=../.env.local` (server
    `package.json` dev script).
  - Two policy-instance consumers: `index.ts` HTTP CORS middleware AND
    `terminal/routes.ts` WS upgrade gate. The bug was wire-up
    divergence between these two consumers.

- **Empirical probes run:**
  1. Bash curl WS-upgrade probe pre-fix with 3 distinct Origins —
     loopback returned 101, MagicDNS+Tailscale-IP both 500. Documented
     the bug shape exactly.
  2. Bash curl HTTP CORS probe — 200 OK + `Access-Control-Allow-Origin`
     echoed for all 3 origins. Proved CORS gate is correct; isolated
     the bug to WS gate only.
  3. Code-grep of `resolveTrustedOrigins(` call sites — found 2: one
     in `index.ts:77` (passes exec ✓), one in `terminal/routes.ts:94`
     (does NOT pass exec ✗). Confirmed the divergence is in the latter.
  4. Real Chromium browser via Playwright pre-fix — navigated to
     Tailscale URL, opened task, WS upgrade succeeded at the TCP layer
     but no frames arrived (server returned 500 on the upgrade →
     browser saw immediate close). Symptom matches user report.
  5. Bash curl WS-upgrade probe POST-fix with same 3 Origins — all 3
     now return 101 + ready envelope + pty data. Round-trip from raw
     Tailscale-IP, MagicDNS-FQDN, and loopback all green.
  6. Real Chromium browser via Playwright POST-fix — navigated to
     Tailscale URL, xterm container rendered live PowerShell prompt
     within 1.2s. Asymptote heuristic satisfied: ONE extra browser
     probe after fix-green, before commit.
  7. Server unit suite full run — 848/848 tests pass, no regression
     in `resolveTrustedOrigins.test.ts` (52 tests covering all four
     policy modes + precedence).
  8. Server + Client `tsc --noEmit` — both clean.

- **Edge cases NOT probed + why acceptable:**
  - `WEBUI_TRUSTED_ORIGINS` explicit allowlist precedence — covered
    by existing unit tests; not exercised in this empirical chain
    because the bug is downstream of the policy resolution.
  - `HONO_HOST=true` opt-in mode — covered by existing unit tests
    (mode='any'); not the bug scenario.
  - IPv6 loopback (`http://[::1]:5173`) Origin — covered by unit test
    `default → accepts http://[::1]:5173`; current bug is wire-up
    upstream of the policy.
  - Tailscale CLI absent / SHIPWRIGHT_TAILSCALE_IP override path —
    out of scope; `resolveTailscaleIp.ts` already throws actionable
    error when neither is available.

- **Confidence-pattern check:** the prior runs (`f852a36`/`5528ae2`/
  `4479736`) declared "ready, boot log shows policy widened, unit tests
  green" three times and produced three subsequent regressions. This
  iterate ran the asymptote heuristic forced ON: even after curl-probe
  green, an ADDITIONAL real-Chromium-browser probe was executed to
  prove the assertion holds in the actual environment the user uses.
  No yes-then-bug pattern fired in this run — curl-green and browser-
  green agree.

## Verification (medium+)

- **Surface:** web
- **Runner command:**
  `npx playwright test client/e2e/flows/v091-tailscale-ws.spec.ts --reporter=list`
  executed via
  `uv run "{shared_root}/scripts/surface_verification.py" --project-root . --run-id iterate-2026-05-10-tailscale-ws-real-browser-fix --surface web`
- **Evidence path:** `playwright-report/index.html` plus `.shipwright/runs/<run_id>/surface_verification.json`
- **Justification (only if surface=none):** n/a — this is a web-surface
  bug whose entire validity claim hinges on a real browser drive. Spec-
  only authorship is explicitly forbidden by the user's iterate
  invocation message and by `feedback_browser_fixes_need_real_browser_smoke.md`.
