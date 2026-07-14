# Iterate: production deploy decapitates itself when run from the embedded terminal

- **Run-ID:** `iterate-2026-07-14-deploy-self-kill`
- **Type:** BUG · **Complexity:** medium · **Spec Impact:** NONE (ops tooling — no FR behavior changes)
- **Date:** 2026-07-14
- **Incident:** 2026-07-14, session `a70c56ab` ("Smearing", after merging PR #248). The
  Command Center was unreachable for ~4 h. No crash, no error output, no autostart to
  recover it.

## Symptom

`scripts/start-server-production.ps1` (and its `.sh` twin) completed its build, then
vanished: `server/dist` + `client/dist` were freshly written (10:34:37 / 10:34:50), but
**no node process and no listener on :3847 existed afterwards**. The script reached
neither its failure branch nor its readiness check — it produced no diagnostic at all.
`~/.shipwright-webui/server-manual.log` was never truncated (step 3's `> $log` redirect
would have emptied it instantly), proving the launch step never executed. The invoking
session's JSONL breaks off mid-tool-call with no `tool_result`.

## Root cause (empirically verified — not inferred)

The deploy script performs `kill(old server)` and `start(new server)` as two steps of a
process that — when launched from the Command Center's embedded terminal — **is itself a
descendant of the server it kills**:

```
Hono server (:3847)  ──spawns──>  node-pty shell  ──>  claude  ──>  the deploy script
        ^                                                                  |
        └──────────────────────── step 2 kills it ─────────────────────────┘
```

Killing the Hono process tears down the ConPTY, which kills the pty shell and everything
under it — including the script. Step 3 (launch the fresh build) is never reached, so the
old server is dead and no new one takes its place.

**Probe** (`@lydell/node-pty` shell spawned by a stand-in "server" process, then
`Stop-Process -Force` on that process — exactly what step 2 does):

| process under the pty | after the server-kill |
|---|---|
| pty shell (`powershell.exe`) | **killed** (cascade confirmed) |
| child spawned via `Start-Process` | **survives** |
| child spawned via WMI `Win32_Process.Create` | survives |

Two findings, both load-bearing:
1. The cascade is real — any script running inside the embedded terminal dies with the server.
2. A `Start-Process` child **already survives** it. The script is not lacking a detach
   mechanism; it is executing the kill **in the wrong process**. Fix = move the kill and
   the start into a process that is already detached *before* the kill happens.

This is why the bug is invisible from the caller's side: the caller is dead. Nothing can
report the failure, so the deploy fails silently and permanently.

## Acceptance criteria

- **AC1** — Running the deploy from inside an embedded WebUI terminal leaves a **running
  server on `$PORT`**, even though the caller is killed mid-flight by the server-kill.
- **AC2** — The kill + start + readiness poll + post-restart `~/.claude.json` heal all run
  in a process that is **not** a descendant of the pty (survives the cascade).
- **AC3** — The build-first contract is preserved: install + build still run **synchronously
  in the caller**, and a failed install/build leaves the running server **untouched**
  (never "no server").
- **AC4** — The deploy outcome is recorded durably (log + machine-readable status file), so
  a caller that dies mid-deploy does not erase the evidence. A surviving caller still
  prints OK / FAIL as before.
- **AC5** — `.ps1` and `.sh` stay behavior-paired (both delegate to the same helper); PORT
  resolution (`$env:PORT` / `${PORT:-3847}`) keeps its current semantics in every sink.
- **AC6** — No autostart / watchdog / supervisor is introduced (explicitly out of scope).

## Design

Two new Node files (cross-platform — one implementation instead of two divergent shell
halves): `scripts/deploy-swap.mjs` (deploy choreography) + `scripts/deploy-procs.mjs`
(process discovery + termination). The caller builds and hands off; the swapper does the
rest and survives:

```
caller (may die mid-deploy)          deploy-swap.mjs (detached — survives the cascade)
  0. heal ~/.claude.json
  1. npm install + build  ──fail──> abort; running server UNTOUCHED (never gets here)
  2. spawn swapper detached ───────> kill listeners on $PORT (+ the tsx watch parent)
     (Start-Process / nohup|setsid)  WAIT until the port is actually free
  3. wait for the swapper's VERDICT     ├─ never freed? do NOT start: the OLD server
     (deploy-status.json, ts >= t0)     │   still runs — better than none. Report it.
     print OK / FAIL                    └─ freed → start `node dist/index.js` detached
     (best effort — may be dead)     confirm OUR child owns the port
                                     write deploy-status.json  ← the durable verdict
                                     heal ~/.claude.json (clean window)
```

Load-bearing details, each one a bug that was found and fixed during review:

- **The kill is `taskkill /F /PID`, never `/T`.** The swapper is a *descendant* of the
  server it kills, so a tree kill (what `dev-restart.js` uses) would kill the swapper —
  the outage, rebuilt inside the fix.
- **The caller's verdict comes from `deploy-status.json`, never from "is anything
  listening".** Its first probe lands before the swapper can have killed anything, so a
  port check would report the PRE-KILL server as success — a green OK over a deploy that
  has not happened, and if the swap then fails, over a machine with no server.
- **A kill that does not land aborts the deploy.** Starting anyway means EADDRINUSE and
  *nothing* running. The old server surviving is bad; no server is the outage.
- **The post-restart heal moves into the swapper** — it used to sit after the readiness
  check in the caller, i.e. in code that is already dead by then (Test-Update-Klausel:
  its ordering tests were re-pointed).
- **`start-server-production.ps1` must stay Windows-PowerShell-5.1-parseable.** The
  embedded terminal spawns `powershell.exe`, not `pwsh` 7. 5.1 reads a BOM-less file as
  cp1252, so an em dash inside a string decodes to a byte 5.1 accepts as a *string
  terminator* — the whole script fails to parse and the deploy silently never starts.
  Found the hard way (a green pwsh-7 syntax check, a dead E2E run). Now pinned by a test.

### Alternatives considered

### Alternatives considered

- **Guard-only (refuse to deploy from inside a WebUI terminal).** Rejected by the user
  (2026-07-14): deploys from the embedded terminal stay allowed, so a session can keep
  honoring the "merged ≠ deployed" rule. It would also need an unreliable pty-detection
  heuristic — no marker env var exists today — and the probe shows delegation works, so
  blocking buys nothing.
- **Harden the detach (WMI / schtasks).** Rejected as unnecessary: `Start-Process` children
  already survive the cascade (probe row 2). Extra machinery, no extra guarantee.
- **Re-order kill/start in the caller.** Impossible: the port cannot be re-bound before the
  old listener is gone.

## Affected boundaries

- Process lifecycle across the pty boundary (ConPTY teardown kills descendants).
- `~/.shipwright-webui/server-manual.log` + new `deploy-status.json` (I/O boundary).
- `$PORT` / `${PORT:-3847}` env contract, shared by caller and swapper.

## Known consequence (by design, not a regression)

Restarting the server necessarily kills **every** embedded terminal, including the one that
triggered the deploy. After this fix the Command Center comes back automatically, but the
session that deployed still loses its terminal and must be resumed after a UI reload. That
is inherent to restarting the process that hosts the terminals — the fix guarantees the
server returns, not that the caller survives.

## Confidence Calibration

- **Boundaries touched:**
  1. Process lifecycle across the pty boundary (ConPTY teardown kills descendants).
  2. Process-tree semantics of the kill itself (`/T` vs `/PID`).
  3. `$PORT` / `${PORT:-3847}` env contract, now shared by caller **and** swapper.
  4. I/O boundary: `server-manual.log` (truncate-on-deploy), new `deploy-swap.log`
     + `deploy-status.json`.

- **Empirical probes run:**
  1. **Cascade probe** — real `@lydell/node-pty` shell under a stand-in server, then
     `Stop-Process -Force` on that server (what step 2 did). Finding: the pty shell
     **dies**; a `Start-Process` child **survives**; a WMI-created child survives.
     ⇒ root cause confirmed, and delegation (not a fancier detach) is the fix.
  2. **End-to-end RED/GREEN** — the REAL deploy script run inside a REAL pty hosted
     by the process that owns the port (the embedded-terminal topology), against the
     PRE-FIX script from `git HEAD` and the fixed one:

     | variant | caller (pty) | server on :3947 | HTTP | deploy-status.json |
     |---|---|---|---|---|
     | pre-fix (`git HEAD`) | killed | **none** | – | absent |
     | fixed | killed | **up (pid 21916)** | **200** | `ok: true` |

     The caller dies in BOTH runs — the fix does not rescue it, it makes it
     dispensable. The pre-fix run reproduces the outage exactly, so the check
     discriminates.
  3. **`/T` self-kill probe (design-time)** — the swapper is a *descendant* of its own
     kill target, so `taskkill /F /T` (what `dev-restart.js` uses) would kill the
     swapper itself. Pinned by a test; the swapper kills `/PID` only.
  4. **`Start-Process` argument quoting** — measured, not assumed: with a path containing
     a space and no explicit quotes, node reports "Cannot find module" (the swapper would
     never run). The hand-off embeds the quotes.
  5. **Windows PowerShell 5.1 parse check** — `powershell.exe` (the shell the embedded
     terminal actually spawns) parses the script cleanly. The pwsh-7 parser said OK while
     5.1 failed: one em dash inside a string, decoded as cp1252, became a string
     terminator and killed the whole script. Now an ASCII-only rule on code lines, pinned
     by a test.
  6. **EBUSY on the shared log** — reproduced: a server holding `server-manual.log` makes
     `fs.openSync(…, 'w')` throw. The swapper now degrades (truncate → append → no log)
     rather than failing the deploy: a log file must never cost us the server.

- **Review rounds (both found real defects; both are folded in):**
  - *External LLM review* — PORT contract divergence between the `.sh` (which took any
    non-empty value) and the swapper (which rejects it): the caller polled one port while
    the deploy happened on another. Also: no-`lsof` hosts reported every healthy deploy as
    failed.
  - *Internal code review* — the caller declared success off ANY listener (i.e. off the
    PRE-KILL server, before the swap had even happened); `main()` had no `catch`, so a
    throw after the kill left no server *and* no status file; the kill did not verify that
    the port actually freed; and the AC3 tests pinned only ORDER, so deleting every abort
    guard would have kept them green while a failed build killed the server.

- **Test Completeness Ledger:**

  | # | behavior | status | evidence |
  |---|---|---|---|
  | 1 | Caller performs no kill; delegates to the swapper (both .ps1 + .sh) | tested | `server/src/test/deploy-detach.test.ts` (CI-gated) |
  | 2 | Hand-off happens only AFTER the build (failed build ⇒ old server untouched) | tested | same + `scripts/start-server-production*.test.mjs` |
  | 3 | Every install/build step carries an ABORT guard (order alone is not enough) | tested | `deploy-detach.test.ts` (added after the code review showed the order-only test stayed green with every guard deleted) |
  | 4 | Hand-off is detached (`Start-Process` / `nohup`\|`setsid`, stdin `</dev/null`) | tested | `deploy-detach.test.ts` |
  | 5 | Hand-off survives a repo path containing spaces | tested | measured (probe 4): unquoted ⇒ "Cannot find module"; quoted ⇒ correct argv |
  | 6 | `.ps1` parses under Windows PowerShell 5.1 (the embedded terminal's shell) | tested | 5.1 parser run + ASCII-only-code-lines test in `deploy-detach.test.ts` |
  | 7 | Swapper kills one PID, never the tree (`/T` would kill itself) | tested | `deploy-swap-contract.test.ts` |
  | 8 | Swapper does NOT start when the port never frees (old server beats no server) | tested | `deploy-swap-contract.test.ts` (`freed:false` path) |
  | 9 | Readiness = OUR child owns the port (a surviving old listener is not success) | tested | `deploy-swap-contract.test.ts` |
  | 10 | Readiness degrades (never fails) where listeners are unobservable (no `lsof`) | tested | `deploy-swap-contract.test.ts` (`process-alive`) |
  | 11 | Swapper starts the new server detached (it outlives the swapper) | tested | contract test + E2E probe 2 (server outlived the swapper's exit) |
  | 12 | Post-restart heal runs in the swapper, AFTER readiness (clean window) | tested | `deploy-swap-contract.test.ts` ordering assertion |
  | 13 | A verdict is written in EVERY path, including an unexpected throw | tested | `deploy-swap-contract.test.ts` (`.catch`) + `buildStatus` units |
  | 14 | An unopenable log never blocks the server start (EBUSY ⇒ degrade) | tested | contract test + probe 6 (server started, log skipped with a warning) |
  | 15 | Caller's verdict comes from a FRESH `deploy-status.json`, never a bare listener | tested | `deploy-detach.test.ts` (success flag must not be set by a listener check) |
  | 16 | PORT contract identical in all three (1-5 digits, > 0, else 3847) | tested | `scripts/deploy-swap.test.mjs` (units + structural parity on both callers) |
  | 17 | Kill scope is the Hono port only — never Vite's | tested | `deploy-swap.test.mjs` (`killPortsFor`) |
  | 18 | **AC1** — the server comes back although the caller is killed mid-deploy | tested | E2E probe 2, the RED/GREEN pair above |
  | 19 | `.sh` twin executes on **macOS** (setsid absent ⇒ nohup branch) | untestable | `requires-physical-device` — no macOS host here. Mitigated: all logic lives in the shared Node swapper (cross-platform, unit-tested); the `.sh` delta is the hand-off line — structurally pinned, `bash -n`-checked, and the nohup branch is exactly the one macOS takes. |

  0 testable-but-untested. Enumeration basis: the 6 acceptance criteria, every behavior
  the diff introduces (port contract, kill scope, kill verification, readiness, status
  file, heal placement, detach mechanics, log degradation), plus every defect the two
  review rounds surfaced (each became a row above).

- **Confidence-pattern check:**
  - *Asymptote (depth)*: the root cause was reproduced under a real pty, not inferred from
    the symptom, and the fix was re-verified against the pre-fix script in the same
    harness after every rework. Each mechanism was measured rather than assumed —
    `Start-Process` children survive the cascade; `Start-Process` does not quote its
    arguments; PowerShell 5.1 mis-parses a UTF-8 em dash. Two of those three contradicted
    what I first believed.
  - *Coverage (breadth)*: both callers, both platforms (Windows executed end-to-end;
    macOS structural + `bash -n` + shared Node logic), the happy path, and every failure
    path the reviews exposed (kill fails, child exits, no `lsof`, log locked, unexpected
    throw, stale status file) is pinned by a test.
  - *Where the confidence actually came from*: not from the first green E2E. The first
    version passed E2E while still carrying four defects that the two review rounds found
    — a caller reporting green off the pre-kill server being the worst of them. The E2E
    proves the outage is fixed; the reviews proved the fix was not yet safe.
  - *Residual risk*: the macOS hand-off line cannot be executed here (row 19). It is a
    two-branch shell line whose payload is the same tested Node helper.
  - *Known, deliberately out of scope*: the `tsx watch` sweep matches any repo's dev
    server (`tsx` + `src/index.ts` in the command line), inherited verbatim from the
    pre-fix inline sweep. Narrowing it needs per-PID cwd resolution; the comment now says
    so honestly and a triage item carries it (see the decision drop).
