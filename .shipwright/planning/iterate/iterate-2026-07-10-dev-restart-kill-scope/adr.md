# Iterate ADR — iterate-2026-07-10-dev-restart-kill-scope (D11)

Campaign: webui-deep-audit-2026-07-10 · Sub-iterate D11 · Complexity: medium
(orchestrator override of a keyword-driven `large` false positive; classifier
returned medium + `touches_io_boundary`) · Type: bug (spec_impact: none).
Finding: F16 (MEDIUM). adr = run_id (iterate-2026-07-10-dev-restart-kill-scope).

## Change summary
`scripts/dev-restart.js` `findPidsOnPorts` over-matched kill targets:
- Windows ran `netstat -ano -p TCP | findstr :<port>` and grabbed the trailing
  PID off every matching line. `findstr` is a plain whole-line substring match
  with no state filter, so it caught (1) ESTABLISHED browser sockets whose
  FOREIGN address ended `:<port>` (the user's Command Center tab connected to
  Vite) and (2) port-prefix collisions (`:5173` ⊂ `:51730`) — then
  `taskkill /F /T`'d those unrelated PIDs, including the browser tree.
- POSIX ran `lsof -ti tcp:<ports>` with no state filter → every socket
  (incl. ESTABLISHED browser connections) on those ports.

Fix (structural, unit-testable):
- New `parseWindowsListenerPids(netstatOutput, ports)` in `kill-targets.js`:
  splits each row into columns, requires proto `startsWith('TCP')` + state
  `LISTENING` + an EXACT local-address port match (port = digits after the last
  colon, so `:51730 ≠ :5173` and `[::]:5173` parses), takes the PID column,
  dedups, tolerates empty/malformed input.
- New `buildLsofCommand(ports)` → `lsof -ti -sTCP:LISTEN tcp:<ports>` (POSIX
  state filter); coerces ports to positive integers before interpolation.
- `dev-restart.js findPidsOnPorts` now runs one plain `netstat -ano` read
  (Windows, parsed structurally) and `buildLsofCommand` (POSIX). Dropped
  `-p TCP` — it EXCLUDES IPv6 (`[::]`) listeners that Vite/Node bind by default
  (empirically verified, see Confidence Calibration).

## Self-Review (7-item)
1. Spec Compliance — PASS. Structural column parse, state=LISTENING, exact port
   match, exported parser, POSIX `-sTCP:LISTEN` — matches the Fix direction
   verbatim. Footprint is the exact 3-file contract.
2. Error Handling — PASS. Parser guards `< 5` cols, non-`TCP` proto, non-numeric
   port/PID, empty/undefined input; `findPidsOnPorts` keeps its try/catch
   degrade-to-empty on netstat/lsof failure.
3. Security Basics — PASS. No new inputs/auth/secrets. `buildLsofCommand`
   coerces every port to a positive integer before shell interpolation — no
   injection reachable even if reused (defense in depth at the exported seam).
4. Test Quality — PASS. AC2 RED-first proven on pre-fix main (7 → then more,
   `parseWindowsListenerPids`/`buildLsofCommand` absent); fixture carries the
   two bug classes (ESTABLISHED browser + :51730/:38470 prefix), IPv6 (TCP +
   TCPv6), a UDP decoy, and a wiring guard over dev-restart.js source.
5. Performance Basics — PASS. One `netstat -ano` read replaces N per-port
   `netstat | findstr` shell pipes; parse is a single linear pass.
6. Naming & Structure — PASS. `parseWindowsListenerPids`, `buildLsofCommand`,
   `localAddressPort` are descriptive; control flow < 3 levels; stale
   `findstr`/`-p TCP` docstring removed (no obsolete comments). LOC:
   kill-targets.js 131, dev-restart.js 177, test 279 — all < 300, no ratchet.
7. Affected Boundaries (ADR-024) — PASS. Producer = OS `netstat`/`lsof`
   output; consumer = the parser → `taskkill`/`process.kill`. Real round-trip
   probe run against live Windows `netstat -ano` (see Confidence Calibration).

## External Plan Review (Step 3.5, openrouter: openai + gemini) — 3 high/med merged
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| A | HIGH | `netstat -ano -p TCP` DROPS IPv6 (`[::]`) listeners that Vite/Node bind by default → dev server survives the restart | accepted-and-fixed. Empirically confirmed on this Windows 11 box (`-p TCP` → 0 `[::]` rows). Dropped `-p TCP`; parser proto check widened to `startsWith('TCP')` (plain `netstat -ano` labels IPv6 rows `TCP`, some builds `TCPv6`). Fixture + test lock both IPv6 forms. |
| B | MED | Windows parser contract must be explicit about IPv6 address forms + noise-line skipping | accepted-already-addressed. `localAddressPort` uses last-colon semantics (handles `0.0.0.0:5173`, `127.0.0.1:5173`, `[::]:5173`); `< 5` cols + non-TCP proto skip headers/`Active Connections`/UDP. Fixtures cover all three address forms + header + UDP. |
| C | MED | POSIX lsof multi-port arg assembly must stay valid after adding `-sTCP:LISTEN` | accepted-verified. `buildLsofCommand` emits `lsof -ti -sTCP:LISTEN tcp:5173,3847` — same comma-joined selector the pre-fix code used (only `-sTCP:LISTEN` added); unit-asserted for single + multi port. |
| (low) | LOW | Shell-injection risk if ports were untrusted | accepted-and-hardened. `buildLsofCommand` coerces via `Number` + `Number.isInteger`/`> 0` filter before interpolation; test proves a `'5173; rm -rf ~'` value is dropped. (Callers already pass computeKillTargets-validated ints — this is defense in depth.) |

## External Code Review (Step 3.7, openrouter: openai + gemini) — 2 med fixed
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | MED | `buildLsofCommand` interpolates `ports.join(',')` into an `execSync` shell string with no validation now that it is exported/reusable | accepted-and-fixed. Added `Number` coercion + integer/positive filter inside `buildLsofCommand`; injection test added. |
| 2 | MED | POSIX test only regex-checks the builder string, not that `dev-restart.js findPidsOnPorts` actually wires it in — a broken impl could still call plain `lsof -ti tcp:` and pass | accepted-and-fixed. Added a source-structure wiring guard (same convention as start-server-production.test.mjs): asserts dev-restart.js imports + invokes `parseWindowsListenerPids(out, ports)` and `execSync(buildLsofCommand(ports)`, and that `findstr` / `netstat -ano -p TCP` / un-filtered `lsof -ti tcp:` are gone. This guard caught a stale docstring during the run. |
| (gemini) | — | No correctness/security/AC gaps; praised the IPv6 catch | confirmed. |

### Internal code-reviewer cascade (round 2, post-push) — 1 HIGH + 1 LOW fixed
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| H1 | HIGH | `buildLsofCommand` arg ORDER kills every listener on macOS/Linux: `lsof -ti -sTCP:LISTEN tcp:<ports>` leaves `-i` addressless (next token starts with `-`) → `-i` selects EVERY internet file, `-sTCP:LISTEN` narrows to ALL machine-wide listeners, `tcp:PORTS` degrades to an unmatched name → `dev:fresh` on Mac/Linux kill -9's every listener (inverse of D11; the documented Mac production path exercises lsof). | accepted-and-fixed. Reordered to the canonical `lsof -ti tcp:<ports> -sTCP:LISTEN` (address bound to `-i`, state filter appended — the proven pre-fix idiom + the filter). The two independent `assert.match` substring checks (which passed for the broken order — why CI missed it) were replaced with EXACT-string assertions; confirmed RED against the broken order → green after. |
| L1 | LOW | `buildLsofCommand([])` (or all-invalid ports) yielded portless `lsof … tcp:` → risks selecting ALL TCP. | accepted-and-fixed. Empty filtered port list returns `''`; `findPidsOnPorts` guards `if (!cmd) return pids` (kill nothing). EXACT-string test locks it. |

Residual: no live macOS/Linux `lsof` run was possible on this Windows host — the
EXACT-string test + the documented canonical lsof idiom are the proof; a
live-Mac/Linux confirmation is the (low-risk) residual.

Deferred follow-up (NOT in D11's port-discovery mandate — recorded, not fixed):
`dev-restart.js findWebuiNodeProcesses` still substring-matches any `vite`
command line (a SECOND, pre-existing PID source that can kill an unrelated vite
process). Outside D11's netstat/lsof port-discovery scope — candidate for a
separate triage item / follow-up iterate.

Internal code-reviewer cascade: `reviews.code = delegated_to_orchestrator`
(orchestrator runs a code-reviewer subagent over the pushed diff before merge).

## Confidence Calibration (Step 3.8, touches_io_boundary)
Boundary: OS port-table (`netstat -ano` / `lsof`) → structural parser →
kill-target PID list.
Probes run:
1. Fixture round-trip unit probes (committed): a realistic `netstat -ano` dump
   with real IPv4 + IPv6 (TCP + TCPv6) listeners, ESTABLISHED browser socket,
   :51730/:38470 prefix collisions, and a UDP decoy → parser returns EXACTLY
   {4200, 4300}; browser (9100), prefix (7777/8888), UDP (6000) excluded.
2. LIVE Windows `netstat -ano` probe (throwaway): confirmed the real proto
   column is `TCP` for IPv6 `[::]` rows, `-p TCP` returns ZERO `[::]` rows
   (the IPv6 gap), and UDP rows are 4-token `*:*` (excluded by the `< 5` guard).
   This probe FOUND the IPv6 defect → fixed (dropped `-p TCP`, `startsWith`).
3. Re-run after the IPv6 fix: fixture + wiring probes green, no further
   findings. Two consecutive clean rounds (fixture round-trip + wiring) →
   asymptote reached, boundary calibrated.
Findings: probe 2 found the IPv6 gap (fixed); probes 1 + 3 found no further
issues.
Edge cases not probed + why acceptable: real `taskkill`/`process.kill`
execution (would kill live PIDs — the finder is the boundary under test, the
kill primitive is unchanged from pre-fix); non-Windows lsof live run (no POSIX
box in this session — `buildLsofCommand` string is unit-asserted and the
`-sTCP:LISTEN`/`tcp:<ports>` syntax matches the pre-fix invocation shape).
