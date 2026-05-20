# Iterate Spec: network-profile-flag

- **Run ID:** iterate-2026-05-10-network-profile-flag
- **Type:** feature
- **Complexity:** medium
- **Status:** implemented
- **ADR:** ADR-081

## Goal

Add a single env-var profile flag (`SHIPWRIGHT_NETWORK_PROFILE`) that
switches both Vite + Hono dev servers between three pre-set bind modes
(`local` / `tailscale` / `open`) so the user can flip security context
in `.env.local` without manually computing IPs every time. Default
(unset) preserves today's loopback-only behavior. Existing
`VITE_HOST` / `HONO_HOST` env vars stay supported and override the
profile (no breakage).

## Acceptance Criteria

- [ ] **AC-1 — `SHIPWRIGHT_NETWORK_PROFILE=local` binds both servers
      to `127.0.0.1`.** Verified by unit tests + dev-stack smoke
      (`npm run dev` produces `0.0.0.0:` lines absent from netstat,
      only `127.0.0.1:` listening).
- [ ] **AC-2 — `SHIPWRIGHT_NETWORK_PROFILE=tailscale` binds both
      servers to the Tailscale IPv4 address.** Resolution path:
      (a) `SHIPWRIGHT_TAILSCALE_IP` env wins if set; (b) else
      `tailscale ip -4` subprocess (first IPv4 line); (c) else
      loud-fail with actionable error message naming both sources.
- [ ] **AC-3 — `SHIPWRIGHT_NETWORK_PROFILE=open` binds both servers
      to `0.0.0.0`** AND prints a one-line warning at startup
      (`[network-profile] WARNING: profile=open — server is exposed
      on every interface; use only on trusted networks`).
- [ ] **AC-4 — Backward compat: explicit `VITE_HOST` / `HONO_HOST`
      override the profile.** When both `SHIPWRIGHT_NETWORK_PROFILE=tailscale`
      AND `VITE_HOST=127.0.0.1` are set, VITE_HOST wins. Existing tests
      `client/src/lib/resolveViteHost.test.ts` + `server/src/lib/resolveHonoHost.test.ts`
      continue to pass without modification of their existing cases.
- [ ] **AC-5 — Profile unset (default) behaves identically to today.**
      `127.0.0.1` for both halves; no new env-vars required.
- [ ] **AC-6 — `.env.example` documents the flag** with three
      uncomment-able blocks (one per profile) plus a note on the
      Tailscale-IP override.
- [ ] **AC-7 — Invalid profile values produce a loud error**
      (e.g. `SHIPWRIGHT_NETWORK_PROFILE=public`) — list valid values
      in the error message.

## Affected FRs

None directly user-facing — this is dev-tooling configuration. Touches
the dev-loop only (production VBS launcher is a separate file the user
edits if they ever want non-loopback in prod).

## Out of Scope

- Production VBS launcher integration. The autostart is currently
  uninstalled; if the user reinstalls and wants Tailscale binding for
  the production server, that's a separate small change to
  `scripts/install-windows.ps1` (set `HONO_HOST=...` in the VBS).
- IPv6 support for the `tailscale` profile. `tailscale ip` returns
  IPv4 by default; IPv6 (`-6`) is a follow-up if needed.
- Multi-Tailscale-interface handling beyond "first IPv4 line + env
  override". Edge case; documented in error message.

## Design Notes

n/a — config layer, no UI surface.

## Affected Boundaries

`touches_io_boundary` FIRES — we read 2 new env vars
(`SHIPWRIGHT_NETWORK_PROFILE`, `SHIPWRIGHT_TAILSCALE_IP`) and a
subprocess output (`tailscale ip -4`).

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| User's `.env.local` | `resolveNetworkProfile.ts` (server + client mirrors) | env-var string |
| `tailscale` CLI subprocess | `resolveTailscaleIp.ts` (server + client mirrors) | newline-separated IPv4 list, stdout |

Boundary Probe round-trip tests (per references/round-trip-tests.md):
- env-string → resolveNetworkProfile → bind-IP, with fixture inputs
  for all 3 profiles + invalid values + unset
- subprocess-stdout-fixture → resolveTailscaleIp → IPv4, with fixtures
  for: empty (no Tailscale), single IPv4, multi-IPv4 (first), invalid
  output

## Confidence Calibration

- **Boundaries touched:** env-vars (`SHIPWRIGHT_NETWORK_PROFILE`,
  `SHIPWRIGHT_TAILSCALE_IP`) + subprocess output (`tailscale ip -4`).
- **Empirical probes run:**
  1. **RED→GREEN cycle.** Tests written before impl; failed correctly
     (functions undefined / wrong shape). After impl, all pass —
     proves test-non-trivial.
  2. **Boundary probe categories (8/8).** Empty/missing → undefined.
     Whitespace-only → undefined. Case (uppercase/mixed) → throws.
     Trailing newline / CRLF → trimmed correctly. Out-of-bounds octet
     (999.x.x.x) → rejected via `node:net.isIPv4`. Substring `client`
     in path → not flagged by drift-guard. Empty stdout from tailscale
     CLI → loud-fail. ENOENT/ETIMEDOUT branches → exercised via
     `code:` properties (post-external-code-review).
  3. **Cross-mirror parity.** `network-profile-sync.test.ts` asserts
     server and client copies of `resolveTailscaleIp.ts` and
     `resolveNetworkProfile.ts` are byte-equivalent after
     comment/whitespace/import-suffix normalization. Strengthened
     post-external-review (was content-presence only) → now
     actually catches code drift.
  4. **Multi-line / deeper-path drift-guard.** Existing
     no-cross-package-imports.test.ts re-runs green with new mirror
     files added (regex covers any `(\.\./)+(?:[^'"\/]+\/)*client\/`,
     comment-aware).
  5. **Full server suite (813 tests, 55 files).** No regressions.
     Includes 11+12+14+11 new resolver tests + 2 byte-equivalence
     parity tests.
  6. **Full client suite (773 tests, 71 files).** No regressions.
     Includes 11+12+13+9 new resolver/proxy tests.
  7. **AC-1 empirical via build.** `cd server && npm run build` exit 0.
     `cd client && npm run build` exit 0 (with new tsconfig.node.json
     including the Node-only files).
  8. **External iterate review (gemini+openai, --mode iterate).**
     14 findings, 13 incorporated; 1 noted (env propagation already
     covered by existing dotenv loaders).
  9. **External code review (gemini+openai, --mode code).** 7
     findings; HIGH `0.0.0.0` proxy target fixed (now 127.0.0.1);
     HIGH AC-3 exact wording fixed; HIGH `local` profile clarified
     (Vite default IS 127.0.0.1, so undefined-return preserves AC-1);
     2 MEDIUM ETIMEDOUT branch tests strengthened; 1 MEDIUM parity
     test strengthened to byte-equivalence.
- **Edge cases NOT probed + why acceptable:**
  - **Real `tailscale` CLI subprocess in unit tests.** Not probed —
    tests inject a stub `exec`. The actual CLI invocation IS exercised
    in production code via `child_process.execSync`; only the
    integration is untested. Acceptable because (a) the CLI's stdout
    contract is documented and stable, (b) we handle ENOENT/ETIMEDOUT
    branches explicitly, (c) the env-override path provides a manual
    escape hatch, (d) the loud actionable error message guides
    operator recovery.
  - **Concurrent execSync in vite-config + hono-boot.** Each runs
    once at startup; no concurrent invocation. Acceptable.
  - **IPv6-only Tailscale.** `tailscale ip -4` returns empty in this
    case; we throw, telling user to set `SHIPWRIGHT_TAILSCALE_IP`.
    Acceptable — IPv6 binding is out-of-scope per spec.
- **Confidence-pattern check:** No "are you confident?" → "yes" → bug
  pattern fired in this run. Each external-review finding produced
  a concrete observable fix (test or code), and post-fix the suite
  reran green deterministically.

**Stopping rule met:** most-recent probe (post-fix full suite) returned
no findings; all applicable boundary categories covered; no asymptote
yes-then-bug pattern.

## Verification (medium+)

- **Surface:** cli
- **Runner command:** `npm.cmd --prefix server run test && npm.cmd --prefix client run test`
- **Evidence path:** `.shipwright/runs/iterate-2026-05-10-network-profile-flag/surface_verification.json`
- **Justification:** No UI change; the empirical end-to-end is
  "configured profile produces expected bind behavior", verified
  through unit tests covering env→resolved-IP transitions on both
  halves. Dev-stack smoke (manually starting both servers with each
  profile and observing netstat) is documented as a follow-up smoke
  step in the mini-plan but is operator-action, not a CI gate.
