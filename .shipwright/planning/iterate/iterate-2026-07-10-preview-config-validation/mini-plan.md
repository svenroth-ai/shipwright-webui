# Mini-Plan — D21 preview-config-validation

Run ID: iterate-2026-07-10-preview-config-validation
Complexity: medium · Hardening: STANDARD · Campaign: webui-deep-audit-2026-07-10

## Problem

`server/src/core/preview-session-manager.ts` trusts profile-authored values raw
at its edges even though its own threat model names them (audit F10/F30):

- **F10** 🟡 MEDIUM — the RETURNED preview `entry.url` is naive string
  concatenation of the unsanitized `ready_path`
  (`` `http://localhost:${port}${readyPath}` ``), bypassing the module's own
  `buildReadyUrl` host-pinning defense. A malicious profile `ready_path` of
  `@evil.com/` yields `http://localhost:5173@evil.com/` — `localhost:5173` is
  parsed as userinfo, `evil.com` as the host, so `window.open(url)` navigates
  off-host. `ready_path: dashboard` (no leading slash) yields
  `http://localhost:5173dashboard`, an unopenable URL.
- **F30** ⚪ LOW — a profile with `dev_server.command` but a missing/invalid
  `port` passes validation: `port` defaults to `0`, the pre-spawn port probe is
  skipped (`if (port > 0)`), and the readiness poll probes port 0 for the full
  60s timeout, then tree-kills the healthy dev server and misreports
  `preview_timeout` instead of naming the config omission.

## Fix direction (within footprint)

Two cohesive helpers in `preview-child-lifecycle.ts` (the manager is at its 393
bloat ceiling; this file already hosts the sibling `buildReadyUrl`):

- `buildPreviewUrl(port, readyPath)` — build the returned URL through the URL
  constructor against a `http://localhost:<port>` origin with the same
  leading-`/@`-strip normalization the probe uses; assert `hostname ===
  "localhost"` and fall back to the bare origin on any host drift (absolute URL,
  `//`/`\\` authority smuggle, malformed). Preserve the historical host-only
  shape for a root path (no trailing slash) so existing behavior is unchanged.
- `isValidPort(port)` — type guard: a positive integer in `1..65535`.

In the manager: reject a missing/invalid port up front with
`PreviewProfileInvalidError` **before** spawning (so the toast names the config
omission and the route maps it to `400 preview_profile_invalid`); the old
`if (port > 0)` probe guard becomes an unconditional probe. Build `entry.url`
via `buildPreviewUrl` instead of concatenation.

Preserved invariants: D03 `shell:false` + win32 spawn path; D20 lifecycle
(drain/treeKill/awaitExit/in-flight dedup); ADR-044 single-spawn-path.

## Tests (TDD)

- New `preview-session-manager.validation.test.ts` (manager sits at its 341
  bloat baseline → new file): AC2 behavioral regressions — `@evil.com/` returns
  `http://localhost:5173/evil.com/` (host preserved); `dashboard` returns
  `.../dashboard`; absolute off-host `ready_path` → bare origin; root path →
  host-only; missing/zero/negative/non-integer/out-of-range port →
  `PreviewProfileInvalidError` with `spawn` never called. RED-first on pre-fix
  `main`: 5 fail / 1 pass.
- `preview-child-lifecycle.branches.test.ts` — unit coverage for
  `buildPreviewUrl` (all branches incl. host-drift + backslash + catch) and
  `isValidPort` (all reject paths).
- `external/preview/__tests__/routes.test.ts` — a missing-port
  `PreviewProfileInvalidError` maps to `400 preview_profile_invalid`.

## Non-goals

- No profile-loader schema validation (the loader stays fail-soft `JSON.parse`;
  the fix guards at the spawn entry, the module boundary the finding names).
- No clamp of a bad port to a default (reject, per the finding's "throw
  preview_profile_invalid" direction — a silent clamp would spawn on a port the
  user didn't author).
