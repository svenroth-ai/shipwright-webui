# Iterate — A00 Harness hardening (isolated E2E + CI gate + visual regression + terminal byte-path guard)

- **Run ID:** `iterate-2026-07-10-harness-hardening`
- **Campaign:** `webui-wow-usability-2026-07-10` · sub-iterate **A00** (#1 of 22, blocks A01–A21)
- **Intent:** CHANGE (harness/infra) · `change_type=chore` · **Spec Impact: NONE**
- **Complexity:** medium (classifier: `medium`, `prior_source: history`)
- **Risk flags:** `touches_build` (`client/package.json`, `client/playwright.config.ts`,
  `.github/workflows/ci.yml`, `client/tsconfig.e2e.json`)
- **Base:** `origin/main` @ `95f00587`

## Problem (measured, not asserted)

Verified against this repo at 2026-07-14:

| Claim | Measurement |
|---|---|
| Playwright specs in `client/e2e/flows/` | **114** |
| …that run in CI | **0** — `ci.yml` gates only tsc + oxlint + vitest + diff-cover |
| Specs pinning a host:port literal | **17** (`:3847` ×23, `:5173`, `:3000`, `:4847`, `:3863`) |
| Specs pinning an operator UUID | **27** |
| Specs pinning `webui.activeProjectId` | **24** |
| Visual-regression coverage | **0** (`grep -rl toHaveScreenshot client/e2e` → 0) |
| `test:e2e` script in `client/package.json` | **absent** (CLAUDE.md documents it) |
| `client/e2e/**` covered by `tsc --noEmit` | **no** — `tsconfig.json` sets `rootDir: ./src` |

Two of the pinned project UUIDs are *live machine state* (`eab3bd8d-…` is in Sven's
real `~/.shipwright-webui/sdk-sessions.json` today). Three more (`fa10a30a-…`,
`50e86b6e-…`, `31b4076d-…`) are **dead** — they name projects/tasks that no longer
exist, so those specs are already broken and nobody notices, because nothing runs them.

**Net effect:** an autonomous agent can open a fully-green PR — tsc clean, lint clean,
vitest passing, diff-coverage above the bar — having visually destroyed a screen.
vitest cannot see that the board lost its columns or that a glass panel turned
white-on-white. The campaign behind this repaints ~15 screens.

## Approach

1. **`e2e/helpers/env.ts`** — single source for every environment-dependent value
   (`APP_BASE` / `API_BASE` / `WS_BASE` + `apiUrl()` / `wsUrl()`). IPv4-pinned
   defaults (node resolves `localhost` → `::1`; the Hono bind is v4).
2. **`e2e/helpers/fixtures.ts`** — seed-and-return, never assume. `seedProject()` /
   `seedTask()` create through the real API and return generated ids;
   `setActiveProject()` seeds `localStorage` via `addInitScript`. Hex ids for
   run-config fixtures (`RUN_ID_PATTERN` silently rejects non-hex → card never renders).
3. **De-hardcode `e2e/flows/**`** — mechanical; no assertion weakened. Specs that
   genuinely assert on live machine artefacts go into a named `quarantine` Playwright
   project — counted, not skipped, not deleted.
4. **Visual regression** — `visual` Playwright project, `e2e/visual/routes.ts` manifest
   (`baselined` | `pending` + owning sub-iterate), baselines committed, generated in the
   pinned `mcr.microsoft.com/playwright:v1.59.1-noble` container.
5. **CI** — new **`E2E smoke (gate)`** job (exact name = the ruleset contract) + a
   `Visual regression (gate)` job, both in the pinned container.
6. **Terminal byte-path guard** — extend `ws-capture.ts` with outbound-frame assertions;
   one spec pins the exact bytes the client sends for auto-execute / keystroke / paste.
   That is the invariant A18's restyle must not move.
7. **`tsconfig.e2e.json`** — type-check the 114 specs (today: nothing does).

### Baseline generation — deviation from the sub-iterate spec (approved 2026-07-14)

The sub-iterate spec mandates generating baselines **inside the pinned Playwright
container**. This machine has **no Docker, no Podman, and no WSL distro**, so no
container can run locally. Approved alternative: **CI generates them.** Playwright
writes the actual PNG and fails the test when a snapshot is missing; the visual job
uploads `e2e/visual/__screenshots__/**` as an artifact on failure, which is downloaded
and committed. The baselines are then produced by *byte-exactly* the environment that
later polices them — strictly stronger than a local container that merely matches the
image tag. Cost: one CI round-trip mid-iterate. `test:visual:update` remains the
documented local-refresh path for anyone who does have Docker.

## Acceptance Criteria

- **AC1 — the visual gate BITES.** A deliberate regression (token colour flip) makes the
  `visual` project FAIL; failing output captured in evidence; then reverted.
- **AC2 — isolated-stack green.** De-hardcoded suite runs on a temp-`USERPROFILE`
  alt-port stack with 0 environment failures (from 36). Quarantined specs counted +
  justified in the PR body.
- **AC3 — the CI job blocks a merge.** `E2E smoke (gate)` runs on PRs and goes red when a
  smoke spec fails. The ruleset `required_status_checks` entry is flagged to Sven by
  exact job name as the manual arming step.
- **AC4 — baselines committed + manifest honest.** Every route that exists today is
  baselined (container-generated); every not-yet-built route is `pending` with an owning
  sub-iterate; the guard test fails if a route is neither.
- **AC5 — terminal byte path locked.** The byte-path guard is RED against a deliberate
  mutation of the outbound frame builder and green on `main`; the existing
  terminal/replay corpus stays green.
- **AC6 — provenance honesty.** No-op in product code for A00; asserted by confirming the
  visual baselines capture no fabricated "live" data (seeded fixtures only).
- **AC7 — suites green + footprint held.** `npm run build && npm run test` green in both
  workspaces; every new/changed file ≤300 LOC; `shipwright_bloat_baseline.json` not
  ratcheted.

## Affected Boundaries

- **Process/env boundary** — `BASE_URL` / `API_BASE_URL` / `PORT` / `VITE_PORT` /
  `USERPROFILE` / `SHIPWRIGHT_E2E_ISOLATED` read by the harness (`touches_io_boundary`
  shape: env parse). Round-trip probe: `env.ts` defaults ⇄ isolated-stack overrides.
- **HTTP/WS boundary** — seeded fixtures speak the real `/api/projects` +
  `/api/external/tasks` contracts; the byte-path guard pins the **outbound** WS frame
  envelope (`{type:"data",data:…}`) that ADR-068-A1 makes client-owned.
- **CI boundary** — `ci.yml` job names are a contract with the `main-protection` ruleset.

## Confidence Calibration

*(populated at Step 7.5, before F0)*

- **Boundaries touched:** see above.
- **Empirical probes run:** *(pending)*
- **Test Completeness Ledger:** *(pending)*
- **Confidence-pattern check:** *(pending)*

## Non-goals

- No user-visible behaviour change. No `spec.md` FR edit (`spec_impact=none`).
- Not running all 114 specs in CI — the smoke subset is the gate (<~5 min).
- Not building the wizard / Ship's-Log / design-gate / First-Contact surfaces
  (A08/A14/A15/A16 own those) — they enter the manifest as `pending`.
