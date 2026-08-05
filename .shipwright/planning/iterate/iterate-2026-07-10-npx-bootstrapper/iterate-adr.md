# Iterate ADR — A06 npx bootstrapper (`@svenroth-ai/shipwright`)

Run ID: iterate-2026-07-10-npx-bootstrapper · FR-01.49 · change_type=feature ·
complexity=large (risk flags: touches_build, touches_io_boundary) ·
campaign webui-wow-usability-2026-07-10.

## Decision

New third npm workspace `bootstrapper/` publishing `@svenroth-ai/shipwright`
as the one install+update surface for plugins + Command Center. Manifest-derived
plugin list, cache-sync that ports `update-marketplace.sh` behaviour (shared/
sync = make-or-break), attach-or-swap server management that NEVER kills :3847,
and a MANUAL publish gate. One additive `server/src` change: `/api/diagnostics`
exposes `app:{name,version}`.

## External-Plan-Review-Findings (Step 3.5 — OpenRouter: gemini + openai)

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| G2 | High | Missing @lydell/node-pty native-binary check (spec §1) | accepted-and-fixed — `probes.checkNativePty` gates boot/swap; loud remediation |
| G3/O8 | High | Server reads `../../package.json` for `app.version` but it is NOT in the `files` whitelist → packaged server reports "unknown" → swap never fires | accepted-and-fixed — ship `server/package.json` (build-package + whitelist); empirically probed |
| O1 | High | npx cache is transient; detached server/swapper reference cache paths | accepted-as-followup — running processes hold their files; a stable per-user release dir is a larger scope (noted in PR) |
| O2 | High | Manifest precedence: override should be highest, not last | rejected-with-reason — spec §2 mandates local→remote→override; documented tension + follow-up |
| O3 | High | npm-pack inventory alone doesn't prove the server boots | accepted-and-fixed (partial) — Step 3.8 boots the staged server on an alt port + hits diagnostics; full tarball-install smoke = follow-up |
| O4 | High | cache-sync concurrency/atomicity (no lock) | accepted-as-followup — matches update-marketplace.sh (no lock); verifyCacheCoherent is the loud safety net |
| O5/H2 | High | marketplace add/update exit codes ignored | accepted-and-fixed — `ensurePlugins` records `marketplaceOk`, logs non-already-exists failures |
| O-H3 | High | cache verify silently "coherent" when a requested plugin has no install dir | accepted-and-fixed — `verifyCacheCoherent(requestedNames)` flags every missing manifest plugin |
| O-H5 | High | probeServer treats any fetch failure as "free" → boots 2nd server onto an occupied non-HTTP port | accepted-and-fixed — TCP occupancy decided first; occupied-but-not-ours → foreign |
| O-H4 | High | Ship/run `check_plugin_cache_sync.py` as post-condition | rejected-with-reason — self-contained JS verify checks the SAME invariants (canary + hook refs + layer + stale-dir) cross-platform without a python-at-verify dep + sibling-repo file; documented |
| O7/identity | High | Swap identity: a foreign process could expose a version-shaped diagnostics | accepted-and-fixed — added `app.name` identity; probe requires it |
| O-M6 | Med | preflight probes `claude` shell:false on Windows → false "absent" (claude.cmd) | accepted-and-fixed — defaultRun uses shell on Windows |
| O-M7 | Med | changed-set via JSON.stringify → key-order false positive | accepted-and-fixed — `mapsEqual` order-independent |
| O-M8 | Med | `PORT` env not validated (only `--port`) | accepted-and-fixed — `resolvePort` + validate effective port |
| O-M9 | Med | swap readiness `>=` vs AC1c "equals" | accepted-and-fixed — exact `=== 0` match |
| O9 | Med | manifest name hardening (dupes / control chars) | accepted-and-fixed — reject non-identifier names + duplicates |
| G1 | Med | over-split files (claude-cli/cache-runtime) | rejected-with-reason — enforces the 300-LOC ceiling + mirrors repo's pure/impure split (kill-targets vs deploy-procs) |
| G4 | Low | Node engine check redundant with npx engines | rejected-with-reason — npx engine block is bypassable; clearer message retained |
| O-M10/11 | Med | tests are DI, not real stub-claude-on-PATH subprocess | accepted-as-followup — DI asserts the exact invocation sequence; Step 3.8 boots the real staged server; a subprocess-PATH harness is additive |

## External-Code-Review-Findings (Step 3.7)

Same table as above (the code review re-surfaced O-H2/H3/H5, O-M6/7/8/9); all
High/Med fixed or dispositioned in the round-2 remediation. Internal reviewer
cascade (spec-reviewer HARD-GATE → code-reviewer → doubt-reviewer):
`reviews.code.status = delegated_to_orchestrator` (runner has no Agent tool).

## Self-Review (Step 3.6 — 7-item)

1. **Spec Compliance** — PASS. AC1–AC9 each have a test; manifest-derived
   (grep guard), never-kill (grep guard), cache RED→GREEN, publish is a human
   gate (no publish/token/workflow).
2. **Error Handling** — PASS. Offline-safe version + manifest fetch; loud named
   errors for foreign port / incoherent cache / missing prereq; plugin failures
   recorded + non-zero exit.
3. **Security Basics** — PASS. Manifest names validated to a package-identifier
   charset before reaching `claude plugin install`; Windows shell-outs carry
   only fixed internal literals; no secrets; no token references.
4. **Test Quality** — PASS. 85 hermetic tests + a real staged-server boot probe;
   RED-first for the cache-coherence + python-stub traps.
5. **Performance Basics** — PASS. Bounded timeouts on every probe/fetch; no
   unbounded loops; sequential plugin installs are inherent.
6. **Naming & Structure** — PASS. Pure/impure split mirrors the repo; every
   authored file ≤300 LOC; no dead code.
7. **Affected Boundaries (ADR-024)** — PASS. Producer = packaged Hono server
   `/api/diagnostics`; consumer = bootstrapper `probeServer` + `decideAction`.
   A REAL round-trip probe was run (Step 3.8), not just asserted.

## Confidence Calibration (Step 3.8 — touches_io_boundary)

- **Boundary:** packaged server `/api/diagnostics` (producer) → bootstrapper
  `probeServer`/`decideAction` (consumer) — the attach-vs-swap I/O contract.
- **Probes run:** (1) booted the STAGED packaged server (`node
  bootstrapper/server/dist/index.js`) on alt port 38471 (NEVER :3847) with
  `SHIPWRIGHT_STATIC_DIR`/`SHIPWRIGHT_PROFILES_DIR` set, hit `/api/diagnostics`,
  asserted `app.name` identity + `app.version=0.23.0` (NOT "unknown"); (2)
  re-ran the same probe through the new TCP-first `probeServer`, asserting
  decideAction → attach@0.23.0 / swap@0.24.0 / attach@0.22.0; node-pty native
  binary loaded (ok). Plus real-socket unit probes: HTTP-identity, wrong-name→
  foreign, raw-TCP-hang→foreign, ECONNREFUSED→free.
- **Findings:** probe #1 would have caught the `server/package.json`-missing bug
  (fixed before the probe on review). Both probes PASS.
- **Asymptote:** two consecutive probes, no new findings → boundary calibrated.
- **Edge-cases NOT probed (acceptable):** a real `claude plugin install`
  against a live marketplace (network + mutates the real cache — DI-tested
  instead); a full tarball install in a clean HOME (documented follow-up).
