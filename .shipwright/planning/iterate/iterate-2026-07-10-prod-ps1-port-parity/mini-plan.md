# Mini-plan — iterate-2026-07-10-prod-ps1-port-parity (D14)

Campaign: webui-deep-audit-2026-07-10 · Sub-iterate D14 · Complexity: medium
(orchestrator override of a keyword-driven `large` false positive; classifier
returned medium + `touches_io_boundary`) · Type: bug (spec_impact: none).
Finding: F35 (LOW). adr = run_id (iterate-2026-07-10-prod-ps1-port-parity).

## Problem statement
`scripts/start-server-production.ps1` and `scripts/stop-server.ps1` hardcode
port 3847 for the kill sweep and the readiness poll, while their `.sh` twins
already honor `$PORT` via `PORT="${PORT:-3847}"`. A Windows operator who
overrides the Hono port (PORT is a documented env override in CLAUDE.md; the
repo-root `.env.local`, loaded by the launched node via
`--env-file-if-exists`, can carry PORT) runs the prod script:
- The kill sweep targets only port-3847 listeners → the OLD server on the
  custom port survives.
- The launch env does not pass the resolved PORT explicitly.
- The readiness poll checks port 3847 → the new server is misreported as
  "did NOT come up on port 3847" (a wrong diagnosis), and the claude.json
  re-heal window is skipped.

## Alternatives considered
1. Leave the scripts as-is and document "prod scripts assume 3847". Rejected —
   the `.sh` twins already honor `$PORT`; PS1/SH drift is the defect, and the
   docs (CLAUDE.md) explicitly present PORT as an override.
2. Read PORT only for the kill sweep. Rejected — the fix direction requires
   consistency across the kill sweep, launch env, readiness poll, and every
   operator message; a partial fix still misreports readiness on a custom PORT.
3. Derive `$Port` once from `$env:PORT` (default 3847) and thread it through
   the kill sweep, the launched server env, the readiness poll, and all
   messages — the exact `.ps1` mirror of the `.sh` twins' `PORT="${PORT:-3847}"`.
   CHOSEN — kills the drift at the root, parallel-safe (only the two ps1 files),
   and pinned by structural tests over the script text.

## Decision
- `stop-server.ps1`: add `$Port = if ($env:PORT) { [int]$env:PORT } else { 3847 }`
  at the top; use `-LocalPort $Port` for the kill sweep and `"port $Port"` in
  the "nothing was running" message.
- `start-server-production.ps1`: add the same `$Port` derivation; use
  `-LocalPort $Port` for both the kill sweep and the readiness poll; assign
  `$env:PORT = "$Port"` before the detached `Start-Process` launch so the child
  inherits the resolved port (the `.ps1` parallel of the `.sh` `PORT="$PORT"`
  node prefix); use `"port $Port"` in the "did NOT come up" failure message.

## Tests (AC2 RED-first)
- NEW `scripts/stop-server.test.mjs` (modeled on `start-server-production.test.mjs`):
  structural assertions that `stop-server.ps1` derives the port from `$env:PORT`
  (default 3847), targets the port variable (not a hardcoded 3847) in the kill
  sweep + message, and keeps no stray 3847 literal. RED on pre-fix main (4/5
  fail) → green after.
- Extend `scripts/start-server-production.test.mjs` with the same parity block
  for `start-server-production.ps1` (kill sweep + readiness poll variable, the
  `$env:PORT =` launch-env assignment, no stray 3847). RED on pre-fix main
  (4 new fail) → green after.

## Footprint (parallel-safety contract)
- `scripts/start-server-production.ps1`
- `scripts/stop-server.ps1`
- `scripts/stop-server.test.mjs` (new — AC2)
- `scripts/start-server-production.test.mjs` (parity assertions — AC2)

Serial #14 of 23; deps/blocks none; D01–D13 merged — no live parallel collision.

## Acceptance
- AC1 — custom-PORT scenario no longer reproduces (kill/poll/env/messages all
  honor `$env:PORT`).
- AC2 — new RED-first regression test on pre-fix main → green after.
- AC3 — server (1924) + client (1972) suites + both builds green; no invariant
  regressed.
- AC4 — 4-file footprint (2 ps1 + 2 mjs test); bloat baseline not ratcheted.
