# Mini-plan — iterate-2026-07-10-dev-restart-kill-scope (D11)

Campaign: webui-deep-audit-2026-07-10 · Sub-iterate D11 · Complexity: medium
(orchestrator override of a keyword-driven `large` false positive) · Type: bug
(spec_impact: none). Finding: F16 (MEDIUM).

## Problem statement
`scripts/dev-restart.js` `findPidsOnPorts` discovers kill-target PIDs with
unanchored substring matching:
- Windows: `netstat -ano -p TCP | findstr :<port>` — `findstr` does plain
  substring matching over the WHOLE line with NO state filter. It catches
  (a) ESTABLISHED browser sockets whose FOREIGN address ends `:<port>` (the
  user's open Command Center tab connected to Vite), and (b) port-prefix
  collisions (`:5173` is a substring of `:51730`). Both PIDs get
  `taskkill /F /T`'d — including the user's browser process tree.
- POSIX: `lsof -ti tcp:<ports>` with no state filter returns every socket
  (incl. ESTABLISHED browser connections) on those ports.

## Alternatives considered
1. Keep `findstr` as a coarse pre-filter, then post-parse. Rejected — the
   substring pre-filter still passes the decoy rows through; parsing the full
   `netstat` output once is simpler and removes the shell-pipe dependency.
2. Match on the whole `:<port> ` with a trailing space to defeat the prefix
   collision. Rejected — brittle (column alignment varies), and does nothing
   for the ESTABLISHED-foreign-address bug class.
3. Structural column parse requiring `state == LISTENING` + exact local-address
   port match. CHOSEN — kills both bug classes at the root and is unit-testable
   over fixture dumps (the finding's read-only probe recommendation).

## Decision
- Add `parseWindowsListenerPids(netstatOutput, ports)` to
  `scripts/kill-targets.js`: split each row into columns, require `TCP` +
  `LISTENING` + an EXACT local-address port match (port = digits after the last
  colon, so `:51730 != :5173` and `[::]:5173` parses), then take the PID column.
  Dedup, tolerate empty/malformed input.
- Add `buildLsofCommand(ports)` returning `lsof -ti -sTCP:LISTEN tcp:<ports>`
  (the POSIX state filter).
- `dev-restart.js findPidsOnPorts` now runs ONE `netstat -ano -p TCP` read
  (Windows) parsed structurally, and `buildLsofCommand` (POSIX).

## Footprint (parallel-safety contract)
- `scripts/dev-restart.js`
- `scripts/kill-targets.js`
- `scripts/kill-targets.test.js`

Serial #11 of 23; deps/blocks none; D01–D10 merged — no live parallel collision.

## Acceptance
- AC1 — over-match scenarios no longer reproduce (LISTENING + exact port).
- AC2 — new RED-first regression test (7 tests; RED on pre-fix main —
  `parseWindowsListenerPids`/`buildLsofCommand` did not exist — green after).
- AC3 — server (1918) + client (1972) suites green; no invariant regressed.
- AC4 — 3-file footprint; bloat baseline not ratcheted.
