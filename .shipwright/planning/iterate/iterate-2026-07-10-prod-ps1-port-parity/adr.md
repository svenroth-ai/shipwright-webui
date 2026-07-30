# Iterate ADR — iterate-2026-07-10-prod-ps1-port-parity (D14)

Campaign: webui-deep-audit-2026-07-10 · Sub-iterate D14 · Complexity: medium
(orchestrator override of a keyword-driven `large` false positive; classifier
returned medium + `touches_io_boundary`) · Type: bug (spec_impact: none).
Finding: F35 (LOW). adr = run_id (iterate-2026-07-10-prod-ps1-port-parity).

## Change summary
`scripts/start-server-production.ps1` and `scripts/stop-server.ps1` hardcoded
port 3847 for the kill sweep and the readiness poll, while their `.sh` twins
already honor `$PORT` via `PORT="${PORT:-3847}"`. A Windows operator on a custom
PORT (a documented env override in CLAUDE.md; repo-root `.env.local`, loaded by
the launched node via `--env-file-if-exists`, can carry PORT) got the OLD server
on the custom port surviving the "stop", EADDRINUSE on the new one, a wrong
"did NOT come up on port 3847" diagnosis, and a skipped claude.json re-heal.

Fix (structural, mirrors the `.sh` twins):
- Both scripts derive the port ONCE:
  `$Port = if ($env:PORT -match '^\d{1,5}$') { [int]$env:PORT } else { 3847 }`
  — the `.ps1` parallel of `PORT="${PORT:-3847}"`. The `^\d{1,5}$` guard
  degrades an unset/blank/non-numeric/overflowing PORT to the 3847 default
  instead of throwing on the `[int]` cast (graceful, matching the `.sh`
  non-crashing behavior).
- `stop-server.ps1`: `-LocalPort $Port` for the kill sweep; `"port $Port"` in
  the "nothing was running" message.
- `start-server-production.ps1`: `-LocalPort $Port` for BOTH the kill sweep and
  the readiness poll; the detached launch scopes PORT to the CHILD only via the
  inner cmd `set "PORT=$Port"&& node ...` (the `.ps1` parallel of the `.sh`
  `PORT="$PORT" node` prefix — no parent-shell mutation); `"port $Port"` in the
  "did NOT come up" failure message.

Tests (AC2): NEW `scripts/stop-server.test.mjs` (modeled on
`start-server-production.test.mjs`) + a parity block added to
`start-server-production.test.mjs`. Structural assertions over the script text
(the established repo pattern — PS1 is not portably executable under
`node --test`), backed by a REAL PowerShell execution probe (Confidence
Calibration below) for the runtime semantics.

## Self-Review (7-item)
1. Spec Compliance — PASS. `$Port` derived from `$env:PORT` (default 3847) and
   threaded through the kill sweep, launch env, readiness poll, and every
   operator message in BOTH scripts — the Fix direction verbatim. Footprint =
   the two ps1 files + the two AC2 test files.
2. Error Handling — PASS. `^\d{1,5}$` degrades unset/blank/non-numeric/overflow
   PORT to 3847 without throwing; `-ErrorAction SilentlyContinue` on the
   cmdlets is unchanged.
3. Security Basics — PASS. No new auth/secrets. `$Port` is a validated integer
   (regex + cast) before it reaches the `set "PORT=$Port"&& node` cmd string, so
   no shell-injection surface (a non-`\d` PORT never reaches the string).
4. Test Quality — PASS. AC2 RED-first proven on pre-fix `main` (11 fail with the
   final assertions; the port hardcode reproduced) → 30 green after. Each sink
   (derivation, kill sweep, launch env, readiness poll, both messages) pinned to
   the single `$Port` variable; "no stray 3847" guard; backed by a live probe.
5. Performance Basics — PASS. One extra regex+cast at script start; no loops or
   I/O added. The kill sweep / poll cmdlets are unchanged.
6. Naming & Structure — PASS. `$Port` is descriptive; control flow unchanged
   (one `if`); stale "port-3847" comments updated to port-agnostic wording (no
   obsolete comments). LOC: stop-server.ps1 25, start-server-production.ps1 172,
   stop-server.test.mjs 118, start-server-production.test.mjs 236 — none
   baselined/ratcheted.
7. Affected Boundaries (ADR-024) — PASS. Producer = operator env `$env:PORT` +
   repo-root `.env.local`; consumer = the OS port table (`Get-NetTCPConnection
   -LocalPort $Port`), the launched node child (`PORT=$Port`), and operator
   messages. Real round-trip probe run on live Windows PowerShell (see
   Confidence Calibration) — env → `$Port` → cmdlet query + message + child cmd.

## External Plan Review (Step 3.5, openrouter: openai + gemini) — 4 medium merged
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| A | MED | `[int]$env:PORT` throws on non-numeric PORT (`abc`, trailing space) — a hard crash before any operator message, worse than the `.sh` degrade | accepted-and-fixed. Guarded with `-match '^\d{1,5}$'` → falls back to 3847 for any non-numeric/blank/overflow value. Live-probe confirmed graceful (no throw) for `abc`, `""`, `"3847 "`, `99999999999`. |
| B | MED | `$env:PORT = "$Port"` before `Start-Process` MUTATES the parent PowerShell session env (leaks if dot-sourced) | accepted-and-fixed. Replaced with a CHILD-scoped `set "PORT=$Port"&& node ...` inside the `cmd.exe /c` inner string — the true `.sh` `PORT="$PORT" node` parallel; no parent-env mutation. |
| C | MED | Env precedence between the inherited/set PORT and `.env.local`'s PORT is unspecified | accepted-documented. Precedence is node's own (`--env-file-if-exists`) and is now IDENTICAL on the `.ps1` and `.sh` paths — the point of the parity fix. Noted in the launch-step comment; no behavior divergence to resolve. |
| D | MED | The regression tests are structural text assertions, not runtime behavior | accepted-with-context + covered. Structural is the established repo convention (PS1 not portably executable under `node --test`; same as start-server-production.test.mjs / .sh.test.mjs / install-windows.test.mjs). The runtime gap is closed by a REAL Windows PowerShell execution probe (Step 3.8) — the structural tests remain the CI-durable guard. |
| (low) | LOW | No TCP port-range (1..65535) validation; footprint lists 2 ps1 but 2 tests added | rejected-with-reason (range) + accepted-clarified (footprint). Range-clamping would BREAK parity — the `.sh` twin's `${PORT:-3847}` keeps any set value and fails-to-bind identically on an out-of-range port; a `.ps1`-only clamp is scope creep. Test files are the AC2-mandated deliverable (the "expected footprint" lists source scripts; every merged D01–D13 added its test file). |

## External Code Review (Step 3.7, openrouter: openai + gemini) — 2 fixed, 1 rejected
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | MED | `^\d+$` matches an Int32-overflowing value (`99999999999`), and `[int]` then THROWS — a crash, unlike the `.sh` degrade (gemini) | accepted-and-fixed. Tightened to `^\d{1,5}$` (<=99999, always below Int32.MaxValue). Live-probe confirmed `99999999999` → 3847 (no throw). |
| 2 | MED | Structural tests could pass if `$Port` were derived but a DIFFERENT variable used in one sink, or `$Port` overwritten (openai) | accepted-and-fixed. Added a "single `$Port` reused in EVERY sink" assertion to both test files (derivation + both `-LocalPort` + launch child env + both messages pinned to `$Port`), plus a failure-message sink assertion. |
| 3 | MED | No 1..65535 range clamp; does not mirror `.sh` `${PORT:-3847}` for numeric-but-unusable ports (openai) | rejected-with-reason. The `.sh` twin does NOT range-validate either — `${PORT:-3847}` keeps `70000` and node fails-to-bind identically. Clamping `.ps1` only would DIVERGE from the twin, breaking the parity mandate. Out-of-range = a shared, pre-existing, out-of-scope limitation. |

Internal code-reviewer cascade: `reviews.code = delegated_to_orchestrator`
(the campaign orchestrator runs a `code-reviewer` subagent over the pushed diff
before merge — this runner has no Agent tool).

## Confidence Calibration (Step 3.8, medium + touches_io_boundary)
Boundary: operator env `$env:PORT` (+ `.env.local`) → resolved `$Port` → the OS
port table query (`Get-NetTCPConnection -LocalPort $Port`), the launched node
child env (`set "PORT=$Port"`), and operator messages.
Probes run (LIVE Windows PowerShell 5.1 — this is a Windows host):
1. Derivation edge-input probe: evaluated the EXACT
   `if ($env:PORT -match '^\d{1,5}$') { [int]$env:PORT } else { 3847 }` under
   8 inputs — unset→3847, "4000"→4000, ""→3847, "abc"→3847, "3847 "→3847,
   "99999999999"→3847 (overflow degraded, NO throw), "0"→0 (parity with `.sh`
   keeping "0"), "65535"→65535. All graceful; no throws. This probe VALIDATED
   the overflow fix from code-review finding #1.
2. Runtime query + message + child-cmd probe (read-only, no kill): with
   PORT=4999, `$Port`=4999; `Get-NetTCPConnection -LocalPort $Port` accepted the
   variable and ran (0 listeners on 4999); the messages interpolated
   "…port 4999."; the inner cmd rendered `set "PORT=4999"&& node
   --env-file-if-exists=../.env.local dist/index.js` (valid cmd prefix, the
   backtick-escaped quotes resolve correctly).
Findings: none in either probe (the overflow crash was caught in code review and
fixed BEFORE these probes; probe 1 confirms the fix). Two consecutive clean
probes → asymptote reached, boundary calibrated.
Edge cases not probed + why acceptable: the FULL scripts were not executed (they
`Stop-Process` real listeners + rebuild/restart the live server — out of a probe's
safe scope; the kill/build/launch primitives are UNCHANGED from pre-fix, only the
port variable threaded through them changed). node's env-vs-`.env.local`
precedence not probed — it is node's own behavior and now identical on both the
`.ps1` and `.sh` paths (parity), so no `.ps1`-specific risk remains.
