# Iterate ADR — D21 preview-config-validation

- Run ID: `iterate-2026-07-10-preview-config-validation`
- Campaign: `webui-deep-audit-2026-07-10` · Sub-iterate: `D21`
- Complexity: medium · Hardening: STANDARD
- Risk flags (classifier): `touches_io_boundary` (real — preview URL/port edge);
  `touches_auth` + `touches_migrations` (spurious keyword hits — no auth/SQL code)
- Depends on: D20 preview-child-lifecycle (merged) · Blocks: none (last in the preview chain)

## Decision

Stop trusting profile-authored values raw at the manager's edges (audit F10/F30):

1. **F10 — host-pin the RETURNED URL.** The returned `entry.url` was naive
   concatenation `` `http://localhost:${port}${readyPath}` `` — a profile
   `ready_path` of `@evil.com/` produced `http://localhost:5173@evil.com/`
   (`localhost:5173` parsed as userinfo, `evil.com` as host) so
   `window.open(url)` navigated off-host; `dashboard` produced the unopenable
   `http://localhost:5173dashboard`. Now built via a new `buildPreviewUrl(port,
   readyPath)` that resolves the path through the URL constructor against a
   pinned `http://localhost:<port>` origin using the **same** normalization the
   probe's `buildReadyUrl` uses (`replace(/^[/@]+/, "/").trim() || "/"`), rejects
   any protocol/host drift (falls back to the bare origin), and preserves the
   historical host-only shape for a root path.
2. **F30 — reject an invalid port before spawning.** A profile with
   `dev_server.command` but a missing/invalid port defaulted `port` to `0`,
   skipped the pre-spawn probe (`if (port > 0)`), then probed the dead port for
   the full 60s timeout before tree-killing the healthy dev server and
   misreporting `preview_timeout`. Now a new `isValidPort` type guard rejects a
   missing/zero/negative/non-integer/out-of-range port up front with
   `PreviewProfileInvalidError` (route → `400 preview_profile_invalid` with a
   `detail` that names the omission); the old `port > 0` probe guard becomes an
   unconditional probe.

Both helpers live in `server/src/core/preview-child-lifecycle.ts` — the cohesive
home of the sibling `buildReadyUrl` — because `preview-session-manager.ts` is at
its 393-line grandfathered bloat baseline (anti-ratchet forbids growth). AC2
regressions go in a new `preview-session-manager.validation.test.ts`
(`preview-session-manager.test.ts` is at its 341 baseline). This expands the
spec's 3-file footprint per the campaign guardrail — identical to the merged D20
precedent. Serial ordering (D20→D21, predecessors merged) = no parallel collision.

Preserved invariants: D03 `shell:false` + win32 spawn path; D20 lifecycle
(drain/treeKill/awaitExit/in-flight dedup); ADR-044 single-spawn-path. Net
production delta on the manager: −1 line (392, ≤ 393).

## AC2 — RED-first evidence

`preview-session-manager.validation.test.ts` run against the **unmodified**
source: **5 failed / 1 passed** — the `@evil.com/` case returned
`http://localhost:5173@evil.com/`, `dashboard` returned
`http://localhost:5173dashboard`, absolute off-host returned the concatenated
string, and the missing/invalid-port cases resolved (spawn called) instead of
throwing. The 1 pass is the root-path case the pre-fix concat already produced
(`http://localhost:5173`). After the fix: all 6 green; full server suite 2003
passed / 1 skipped.

## Self-Review (7-item)

1. **Spec Compliance** — pass. F10 (host-pin returned URL via the probe's
   sanitizer) + F30 (reject invalid port pre-spawn) implemented exactly as the
   Fix direction; concrete failing scenarios no longer reproduce.
2. **Error Handling** — pass. Invalid port → `PreviewProfileInvalidError`
   (never spawns); `buildPreviewUrl` try/catch → safe origin fallback on
   malformed input; port-in-use path unchanged.
3. **Security Basics** — pass. Returned URL host+scheme-pinned to
   `http://localhost` (rejects `@`/`//`/`\\` authority smuggle, absolute
   off-host, `javascript:`/`data:` schemes); probe still 127.0.0.1-pinned;
   env still drops `CLAUDE_*`/`SHIPWRIGHT_*`.
4. **Test Quality** — pass. RED-first proven (5 fail on pre-fix); unit branch
   coverage for both helpers; route 4xx mapping pinned; injected
   platform/processKill seams keep host process-kill off the box.
5. **Performance Basics** — pass. Pure string/URL work; no new I/O or polling;
   the invalid-port reject REMOVES a 60s dead-port probe.
6. **Naming & Structure** — pass. `buildPreviewUrl`/`isValidPort` named siblings
   of `buildReadyUrl`; manager stays ≤393; DRY `opts()`/`spawnWith()` test helpers.
7. **Affected Boundaries (ADR-024)** — pass. Boundary = the preview URL string
   (producer `buildPreviewUrl` → consumer browser `window.open`/URL parser) and
   the profile-JSON port edge (producer profile-loader → consumer manager). Real
   round-trip probe run (see Confidence Calibration): 15 adversarial ready_paths
   + 9 ports, 0 off-host escapes. The route layer consumes the same
   `PreviewProfileInvalidError.detail` it already mapped — additive, non-breaking.

## Confidence Calibration (medium + touches_io_boundary)

Boundaries + empirical probes (producer→string→consumer round-trip against the
built `dist`):

- **Returned preview URL (F10)** — probe: 15 adversarial `ready_path` values
  (`@evil.com/`, `//evil.com/x`, `\\evil.com/x`, `http://evil.com/`,
  `https://evil.com`, `javascript:alert(1)`, `data:text/html,x`,
  `user:pass@evil.com/`, `  @evil.com`, `dashboard`, `/dashboard`, `/`, `?tab=1`,
  `#top`, `/a?b=1#c`) → assert `new URL(result).hostname === "localhost"` (the
  window.open parser). Finding: pre-fix `@evil.com/` escapes off-host (RED);
  post-fix **0/15 off-host** — smuggles land as on-host paths, off-host/non-http
  fall back to the bare origin.
- **Port config (F30)** — probe: 9 port values incl. `0`/`-1`/`3000.5`/`65536`/
  `"3000"`/`undefined`/`NaN` → assert `isValidPort` verdict. Finding: **0/9
  mis-validations**; `"3000"` (string) correctly rejected (empirically verified
  no bundled profile authors `dev_server.port` as a string — supabase-nextjs =
  numeric `3000`, the only profile with a `dev_server.port`).

Asymptote: the first probe found the pre-fix off-host defect → fix → re-probe;
two consecutive clean anchors (the 24-case adversarial battery = 0 findings, and
the full server suite = 0 failures) → **calibrated**. **Edge not probed:** a real
browser `window.open` navigation — modelled by the URL-parser probe (the same
parser window.open uses); no frontend file changed, so the F2 browser-verify
gate does not apply.

## External-Plan-Review-Findings

| # | Provider | Sev | Finding | Disposition |
|---|----------|-----|---------|-------------|
| 1 | openai/gemini | high | Plan expands the 3-file footprint (new cohesive file + new test files) → parallel-collision / AC4 | rejected-with-reason — `preview-session-manager.ts` (393) + `.test.ts` (341) are at grandfathered bloat baselines; the vendored anti-ratchet hook BLOCKS growth; campaign brief mandates new cohesive/test files; identical to merged D20; serial D20→D21 (predecessors merged) = no collision |
| 2 | openai | med | `buildPreviewUrl` fallback diverges from the probe's normalization | rejected-with-reason (verified) — buildPreviewUrl uses the IDENTICAL `replace(/^[/@]+/, "/").trim() || "/"` as buildReadyUrl (l.203≡l.239); only the return type differs (string+origin-fallback for window.open vs URL\|null for fetch) — by design |
| 3 | openai | med | Root host-only shape may break literal URL comparisons | accepted-and-verified — historical `http://localhost:5173` (no trailing slash) preserved exactly; existing manager test still green; added an explicit root-path regression |
| 4 | openai/gemini | med/low | String ports (`"3000"`) from profile JSON would be wrongly rejected | rejected-with-reason (verified) — real profiles author `dev_server.port` as a JSON number (supabase-nextjs=3000; no string-port profile exists); type is `number`; coercion would mask a malformed profile + is scope creep beyond the finding |
| 5 | openai | med | Two helpers is heavier than needed; `buildPreviewUrl` single-use | rejected-with-reason — a named, unit-tested host-pinning sanitizer IS the fix (replacing the vulnerable inline concat) and is required for per-branch diff coverage; sibling of the existing `buildReadyUrl` |
| 6 | openai | med | Does any path use `port<=0` to mean "skip probe" for a non-HTTP mode? | accepted-and-verified — grep confirms no non-HTTP preview mode; the removed `port>0` guard WAS the F30 defect; PreviewButton gates on `dev_server.command`, a portless preview was always broken |
| 7 | openai | low | No query/fragment-only ready_path test | accepted-and-fixed — added `?tab=1` test (`buildPreviewUrl` preserves search+hash) |
| 8 | gemini | med | Add explicit `url.protocol === "http:"` to reject `javascript:`/`data:` | accepted-and-fixed — added protocol check + `javascript:`/`data:` tests (hostname check already caught them; explicit is clearer for a hardening change) |
| 9 | openai | low | localhost/127.0.0.1 host inconsistency between display + probe | accepted-and-verified — pre-existing intentional split (server-side fetch pins loopback IP `127.0.0.1`; browser-facing URL keeps the historical `localhost` name + contract); both loopback |
| 10 | openai | low | Error-timing change (`preview_timeout`→`preview_profile_invalid`) may need client/telemetry updates | partially-accepted — server now returns the correct code + naming `detail`; client already handles `preview_profile_invalid` (PreviewButton.tsx:143), no breakage. Deferred LOW follow-up: surface `err.detail` in that toast so it names the port omission (kept server-only to avoid a browser-verify-triggering client change disproportionate to a LOW finding) |

## External-Code-Review-Findings

| # | Provider | Sev | Finding | Disposition |
|---|----------|-----|---------|-------------|
| 1 | gemini | high | A verbatim git warning is pasted into `isValidPort` → SyntaxError, breaks build | rejected-with-reason — HALLUCINATION: `isValidPort` is clean source (`port <= 65535`), `tsc --noEmit` exits 0, 2003 tests green. The git CRLF warning was terminal output, never in the source |
| 2 | openai | high | `buildPreviewUrl.trim()` diverges from `buildReadyUrl` (claimed no-trim) → probe/return URL mismatch | rejected-with-reason — FALSE PREMISE: `buildReadyUrl` DOES `.trim()` (l.203); both use the identical normalization, so leading/trailing-space paths normalize identically. No mismatch |
| 3 | openai | med | Tests outside the expected footprint (AC4) | rejected-with-reason — same as plan #1 (bloat baselines + anti-ratchet + campaign precedent) |
| 4 | openai | low | localhost vs 127.0.0.1 host policy mismatch (display vs probe) | accepted-and-verified — same as plan #9; pre-existing intentional loopback split, no change |

## Internal code-reviewer

`reviews.code: delegated_to_orchestrator` — the runner has no Agent tool; the
campaign orchestrator spawns the spec-reviewer→code-reviewer cascade over the
diff and merges findings back here.

## Deferred follow-up (LOW — NOT fixed in D21)

- **Client toast copy for the port omission.** The `preview_profile_invalid`
  toast (`PreviewButton.tsx:143`) is hardcoded to a `dev_server.command`
  message; for a missing-port profile it should surface `err.detail`
  ("dev_server.port must be a positive integer"). Kept server-only here (a
  toast-copy change triggers the mandatory F2 browser-verify cycle,
  disproportionate to a LOW finding); the API already returns the correct code +
  detail and the destructive F30 behavior is fully fixed.
