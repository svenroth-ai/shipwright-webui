# Iterate ADR — D12 spawn-env-port-strip (F17)

run_id: iterate-2026-07-10-spawn-env-port-strip
complexity: medium · risk flags: touches_io_boundary · change_type: bug

## Decision
Extend `buildSpawnEnv` with a narrow strip-list `WEBUI_OPERATIONAL_ENV_KEYS =
["PORT","VITE_PORT","HONO_HOST"]`, deleted AFTER the base+caller merge
(mirroring the existing PARENT_SESSION_ENV_KEYS strip one line above), so the
webui's own network-bind vars never leak into the embedded-terminal pty. New
co-located test `spawn-env.test.ts`.

## Self-Review (Step 3.6 — 7-item checklist)
1. **Spec Compliance** — PASS. Strips PORT/VITE_PORT/HONO_HOST per the fix
   direction; "audit config.ts consumers" done and documented (no network-bind
   SHIPWRIGHT_* exists → narrow strip; the broad SHIPWRIGHT_* sweep the spec
   floats is explicitly justified-out). Footprint = the 2 named files only.
2. **Error Handling** — PASS. Pure map transform; `delete` on absent keys is a
   no-op; no throw path introduced.
3. **Security Basics** — PASS. Reduces env-leak surface (server topology/bind
   settings no longer disclosed to terminal sessions). No secrets touched. ADR-067
   shell-only whitelist untouched (env-map only).
4. **Test Quality** — PASS. AC2 RED-first proven (5 tests failed on pre-fix
   main); green after. Composite test pins the FULL parent-session strip set +
   the SHIPWRIGHT_WEBUI / NO_FLICKER contracts + caller-cannot-re-leak.
5. **Performance Basics** — PASS. Three `delete`s on an object already built;
   O(1), no new allocation/loop growth.
6. **Naming & Structure** — PASS. `WEBUI_OPERATIONAL_ENV_KEYS` mirrors the
   sibling `PARENT_SESSION_ENV_KEYS` const + loop; ≤ 234 LOC, < 300 ceiling.
7. **Affected Boundaries (ADR-024)** — PASS. Boundary = webui-server env →
   pty child-process env. Producer = production launchers (stamp PORT) + the
   `{ ...process.env }` spread; consumer = the spawned shell / a nested dev
   server. Real round-trip probe run (see Confidence Calibration).

Items failed: 0 / 7.

## External-Plan-Review-Findings (Step 3.5 — openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| P1 | medium | Audit config.ts SHIPWRIGHT_* consumers; name which are preserved | accepted-and-fixed — audit done; documented in code comment + a pinning test; only non-network knobs exist → narrow strip stands |
| P2 | medium | Strip-after-merge could break a caller intentionally passing PORT | rejected-with-reason — empirical call-site audit: the ONLY runtime caller `pty-manager.spawn` calls `spawnFn` with NO env field → `opts.env` is always undefined; `callerEnv` is a test-only escape hatch. No caller sets PORT. Strip-after-merge is the safer, symmetric choice |
| P3 | medium (gemini) | Strip BEFORE the merge to preserve caller intent | rejected-with-reason — same as P2; no runtime caller passes network vars, and defensive after-merge symmetry with the marker strip is the intended contract |
| P4 | low | Add merge-order regression assertion | accepted-and-fixed — "a caller-supplied env cannot re-leak the network vars" test |
| P5 | low | Windows case-insensitivity (`port` vs `PORT`) | rejected-with-reason — empirically probed on this Win11 box: launchers stamp canonical uppercase, `{...process.env}` preserves uppercase, exact-delete removes all three. Case-variant needs non-standard manual injection outside the finding |
| P6 | low | Test isolation / process.env leakage across runs | not-applicable — the test passes an explicit `baseEnv` arg; process.env is never mutated → parallel-safe by construction |
| P7 | low | Add HOST to strip-list | rejected-with-reason — no webui launcher stamps HOST (verified in start-server-production.sh / install-windows.ps1 / dev-restart.js); outside the finding footprint |

## External-Code-Review-Findings (Step 3.7 — openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| C1 | medium | Only 3 network vars stripped, no SHIPWRIGHT_* audit visible | accepted-and-fixed — strengthened the code comment to spell out the config.ts audit result; added a pinning test that a non-network SHIPWRIGHT_* (MAX_CONCURRENT) still flows through. Narrow strip is correct on merits |
| C2 | low | Composite test only checks CLAUDE_CODE_CHILD_SESSION | accepted-and-fixed — extended to pin the FULL parent-session set (CHILD_SESSION / SESSION_ID / ENTRYPOINT / CLAUDECODE) |
| C3 | — (gemini) | Rambling restatement of caller-strip + case questions | no-action — both already resolved (P2/P5); no new actionable finding |

Internal code-reviewer cascade: `reviews.code = delegated_to_orchestrator`
(campaign mode; runner has no Agent tool).

## Confidence Calibration (Step 3.8 — touches_io_boundary)
Boundary: webui-server env → embedded-pty child-process env.
Probes run (real, empirical):
1. **Round-trip probe** (producer→spread→consumer): `PORT=3847 VITE_PORT=5173
   HONO_HOST=true node -e "{...process.env}; delete uppercase; assert absent"`
   on this Win11 box → keys spread as canonical uppercase, exact-delete removes
   all three. Finding: none (behaves as designed). 
2. **RED-first regression probe**: new test suite RED on pre-fix main (5/5
   failed — leak confirmed reproducible), GREEN after fix.
3. **Call-site probe**: traced the sole runtime caller `pty-manager.spawn` →
   `spawnFn(shell, [], {cwd,cols,rows})` — no env field → `opts.env` undefined;
   confirms strip-after-merge breaks no real caller. Finding: none.
Asymptote: probe 1 + probe 3 both no-finding after the fix → boundary
calibrated. Edge not probed: case-variant env injection (`Port`) — accepted, no
launcher produces it (probe 1 covers the canonical case). asymptote_reached: true.
