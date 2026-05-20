# Iterate Spec: env-local-loading-fix

- **Run ID:** iterate-2026-05-10-env-local-loading-fix
- **Type:** bug
- **Complexity:** medium
- **Status:** draft
- **Supersedes:** Implementation gap in ADR-081 (network-profile-flag).

## Goal

ADR-081 shipped `SHIPWRIGHT_NETWORK_PROFILE` but failed to wire
`.env.local` into the dev-server process envs. Both halves
(`tsx watch` on the server, Vite via vite.config.ts on the client)
ignore `.env.local` for non-`VITE_*` keys today — so the documented
"edit .env.local and restart" workflow does NOT work. User had to
prepend env-vars on the command line to make the previous iterate
function. This fix closes that gap.

The OpenAI iterate-review for ADR-081 flagged exactly this concern as
finding #10 ("Confirm the top-level dev command actually propagates
the new env vars to both Vite and Hono") and I marked it NOTED
without verifying. Memory feedback `feedback_external_code_review_catches_high_bugs.md`
applies: external review caught a real bug, author handwaved it.

## Acceptance Criteria

- [ ] **AC-1 — Server `npm run dev` reads `.env.local`** from the repo
      root. `SHIPWRIGHT_NETWORK_PROFILE=tailscale` in `.env.local`
      causes Hono to bind to the resolved Tailscale-IP without any
      command-line env-var prefix. Implementation via Node's
      `--env-file-if-exists` flag (Node 20.12+) — no new dep.
- [ ] **AC-2 — Vite (`npm run dev` in client/) reads `.env.local`**
      from the repo root (one level up from `client/`). vite.config
      uses `loadEnv(mode, path.resolve(__dirname, ".."), "")` (empty
      prefix = load ALL keys, not just `VITE_*`) and merges into the
      env passed to resolveViteHost + resolveProxyTarget.
- [ ] **AC-3 — Empirical end-to-end smoke.** With
      `SHIPWRIGHT_NETWORK_PROFILE=tailscale` in `.env.local` AND no
      command-line env-vars, running `cd server && npm run dev` AND
      `cd client && npm run dev` produces:
        - Hono bound to `100.x.x.x:3847` (per `netstat -ano`)
        - Vite bound to `100.x.x.x:5173` (Vite log shows only one
          Network address)
        - No `[network-profile] WARNING: ... via explicit VITE_HOST`
          line (only the AC-3 profile-open path warning emits, which
          should NOT fire for profile=tailscale).
- [ ] **AC-4 — Backward compat preserved.** Command-line env-var
      prefixes still work (the previous iterate's user-facing
      workaround keeps working). Setting `VITE_HOST=true` on the CLI
      AND `SHIPWRIGHT_NETWORK_PROFILE=tailscale` in `.env.local` →
      VITE_HOST wins (per the documented precedence).
- [ ] **AC-5 — Missing `.env.local` is non-fatal.** Fresh checkout
      without `.env.local` boots both servers with defaults
      (loopback). Server uses `--env-file-if-exists` (not
      `--env-file`) to avoid hard-fail. Client's `loadEnv` returns
      empty object when file absent.
- [ ] **AC-6 — Unit-test coverage** asserts the precedence works
      against a process-env shape that simulates loaded `.env.local`
      values. New tests on both halves.

## Affected FRs

None — internal dev-tooling bug fix.

## Out of Scope

- `.env.production` support. Out of scope; production-mode binding
  belongs to the install-windows.ps1 VBS launcher (separate path).
- Hot-reload on `.env.local` changes. Dev-server restart is the
  contract.
- Per-mode `.env` files (`.env.development`, `.env.test`). Out of
  scope — single `.env.local` is enough today.
- Migrating from `--env-file-if-exists` to a userland dotenv package
  (e.g. `dotenv`). Node-native flag is simpler + zero-dep.

## Design Notes

n/a — config-loading mechanic.

## Affected Boundaries

`touches_io_boundary` FIRES — we change the env-loading path for
both halves.

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| User's `.env.local` | `tsx watch` via `--env-file-if-exists` → Hono process env | KEY=VALUE lines |
| User's `.env.local` | `vite.config.ts` via `loadEnv` → resolveViteHost / resolveProxyTarget | KEY=VALUE lines |

Boundary Probe coverage: same 8 categories from references/boundary-probes.md.

## Confidence Calibration

- **Boundaries touched:** env-file loading. Two distinct loaders
  (Node-native `--env-file-if-exists` server-side; Vite `loadEnv`
  client-side) both feeding into the same resolver chain established
  by ADR-081.
- **Empirical probes run:**
  1. **Node `--env-file-if-exists` smoke** (test #1 in
     env-file-loading.test.ts) — `node --env-file-if-exists=<fixture>
     -e "..."` returns the fixture value. Proves the Node-level flag.
  2. **tsx forwarding smoke** (test #2 in env-file-loading.test.ts)
     — `node --env-file-if-exists=<fixture>
     <tsx-cli-path> -e "..."` returns the fixture value. Proves the
     same flag flows through tsx's invocation path which the package.json
     dev script uses.
  3. **Missing env-file smoke** (test #3) — `--env-file-if-exists`
     does NOT hard-fail when file absent. Proves fresh-checkout boot.
  4. **package.json contract** (test #4) — regex-asserts the dev
     script string contains the flag in the correct position
     (`tsx watch --env-file-if-exists=../.env.local src/index.ts`).
  5. **Server-side merge precedence** (resolveHonoHost.precedence.test.ts
     × 8 tests) — process.env wins over file env in all 8 cases
     covering profile / IP override / empty-string handling.
  6. **Client-side merge precedence** (resolveProxyTarget.precedence.test.ts
     × 8 tests) — same shape for client, plus VITE_HOST-specific
     AC-4 coverage added post-code-review.
  7. **End-to-end live smoke (manual, operator-action):** killed both
     dev servers, ran `cd server && VITE_HOST= npm run dev` and
     `cd client && VITE_HOST= npm run dev` with NO command-line
     `SHIPWRIGHT_NETWORK_PROFILE` prefix. Result: both bound to
     `100.64.0.1` (Tailscale IP from `.env.local`). Vite log
     showed exactly ONE Network address (was 3 before). Hono log
     showed `bind=100.64.0.1` driven by `.env.local`.
  8. **Full server suite (825) + client suite (781) green** — no
     regressions on either side.
- **Edge cases NOT probed + why acceptable:**
  - **Concurrent dev-restart with .env.local mid-edit.** Not probed;
    dev-server restart is the contract (documented in spec under "Out
    of Scope"). Operator restarts when .env.local changes.
  - **Per-mode env files (`.env.development.local`).** Spec out of
    scope; loadEnv handles them transparently if user adds them.
- **Confidence-pattern check:** None of the external review findings
  produced an "are you confident? yes" → bug. All findings produced
  concrete code/test changes that landed and stayed green post-fix.

**Stopping rule met:** most-recent probe (full suites + live smoke)
returned no findings; all boundary categories covered; no asymptote
pattern fired.

## Verification (medium+)

- **Surface:** cli
- **Runner command:** `npm.cmd --prefix server run test -- --run --pool=forks src/lib/ && npm.cmd --prefix client run test -- --run src/lib/`
- **Evidence path:**
  `.shipwright/runs/iterate-2026-05-10-env-local-loading-fix/surface_verification.json`
- **Plus manual smoke** (operator action, documented in test_results.json
  degraded array): start `npm run dev` on both halves with
  `SHIPWRIGHT_NETWORK_PROFILE=tailscale` in `.env.local` and no CLI prefix.
  Assert netstat shows tailscale-IP bind.
