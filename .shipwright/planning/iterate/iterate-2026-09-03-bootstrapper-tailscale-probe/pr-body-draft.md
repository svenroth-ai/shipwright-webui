## Summary

Fixes #415 — under `SHIPWRIGHT_NETWORK_PROFILE=tailscale`, the bootstrapper's port probe was hardcoded to loopback while the server binds only the tailnet interface, so attach/swap/foreign detection was unreachable and every launch redundantly re-booted onto a live incumbent (dying on `EADDRINUSE`).

- Added `resolveProbeHost(pkgRoot, env, importFn)` to `bootstrapper/lib/server.mjs`: reuses the server's own compiled `resolveHonoHost` (`pkgRoot/server/dist/lib/resolveHonoHost.js` — the same directory `bootSpawnPlan` already targets) instead of re-implementing `SHIPWRIGHT_NETWORK_PROFILE` precedence in the bootstrapper. A wildcard bind (`0.0.0.0`/`::`) maps back down to loopback (still connectable there); a concrete address (e.g. the resolved tailscale IP) is probed directly. Never throws — falls back to loopback on any import/resolution failure.
- `probeServer` now accepts a `host` option (default `127.0.0.1`, backward compatible), threaded into both the TCP occupancy probe and the `/api/diagnostics` fetch.
- `ensureServer` resolves the probe host before building its `url` — unchanged `http://localhost:<port>` for a loopback resolution; the actually-reachable address otherwise (fixes the reported/opened URL too).
- Updated `probes.mjs`'s stale "always 127.0.0.1" docstring.
- Added a real-integration regression test (no mocks — exercises the actual compiled `server/dist/lib/resolveHonoHost.js`, skips gracefully if `server/` hasn't been built) plus an unconditional, build-free source-level drift guard so a rename/removed-export on that dependency is still caught in CI (which never builds `server/`).
- Added `isSafeProbeHost`/`formatHostForUrl` validation in response to code review: the resolved host is rejected (falling back to loopback, with the reason surfaced via a new `log(...)`-wired callback) unless it's a valid IP literal or a plain hostname — closing a theoretical `%VAR%`/shell-metacharacter path into the Windows `start` command — and an IPv6 literal is now bracketed (`http://[::1]:<port>`) instead of producing a malformed URL.

## Known, accepted trade-offs (not fixed here — documented, not silent)

- Direction asymmetry: an incumbent still bound to loopback while the env says `tailscale` is now invisible to the probe (two live servers, no `EADDRINUSE`). The issue's own alternative ("probe loopback first, then fall back to the profile address") would cover both directions; this PR implements the issue's *primary* suggestion (resolve the intended bind host directly) instead, which is simpler and covers the actually-reported failure mode.
- Narrow transient-failure window (raised by doubt review): the probe host is re-resolved fresh on every launch, not pinned to what an already-running incumbent bound to at its own boot. If `tailscale ip -4` fails only on this one invocation while a healthy incumbent is genuinely reachable on a tailscale IP, this falls back to loopback and triggers a redundant boot attempt — the same symptom the pre-fix bug produced on *every* launch, now rare instead of constant. Documented in `resolveProbeHost`'s JSDoc rather than chased further; differentiating "resolution failed" from "port genuinely free" would add meaningfully more machinery for an already-rare window.

## Test plan

- [x] `bootstrapper`: `npx vitest run` — 19 files, 280 passed / 3 skipped
- [x] `npx tsc --noEmit` clean, `npx oxlint .` clean
- [x] Real-integration probe against the freshly-built `server/dist/lib/resolveHonoHost.js` (local/open/unset/`HONO_HOST=true` → loopback), both as a standalone F0.5 CLI check and as a permanent vitest test — plus an unconditional source-level guard that runs even when `server/` isn't built
- [x] IPv6 bracketing and unsafe-host rejection covered by new unit tests (code-review follow-up)
- [ ] Not verified against a live Tailscale daemon (none available in this environment) — the `tailscale`-profile branch is covered via injected fakes plus `resolveTailscaleIp`'s own pre-existing, unmodified test suite

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01E7Xhq7wUX8tNNrhinjhTPW
