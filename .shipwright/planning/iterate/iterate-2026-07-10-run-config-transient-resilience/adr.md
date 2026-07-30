# Iterate ADR — iterate-2026-07-10-run-config-transient-resilience (D10)

Campaign: webui-deep-audit-2026-07-10 · Sub-iterate D10 · Complexity: medium
(orchestrator override of a keyword-driven `large` false positive) · Type: bug
(spec_impact: none). Finding: F15 (MEDIUM).

## Change summary
- `server/src/types/run-config-v2.ts` — added server-only torn-read helpers
  (`RUN_CONFIG_RETRY_DELAYS_MS`, `isRetryableTornRead`, `retryTornRead`,
  `RetryOutcome<T>`). Placed here, not inline, because run-config-reader.ts is
  at its 439-LOC bloat ceiling (established `parseRunMode` precedent, memory
  `run_config_reader_at_bloat_ceiling`). Client mirror (`client/src/lib/…`) is
  untouched — no cross-package import, no client-bundle pollution.
- `server/src/core/run-config-reader.ts` — the existence **stat probe** now
  runs through the SAME `retryTornRead` envelope as the read path and falls back
  to last-good on exhaustion (was: bare try/catch → instant `invalid`). Read +
  parse paths reuse the shared helper; a new local `serveLastGood()` DRYs the
  three cache-fallback sites. `LAST_GOOD_TTL_MS` 5000 → 30000 (comfortably above
  the 5s client poll cadence — the pre-fix equality is why the cache was always
  expired at fallback). Net 438 → 431 LOC (no ratchet).
- `client/src/hooks/useRunConfig.ts` — `runConfigPollIntervalMs` keeps polling
  on `invalid` at a 10s backoff (`POLL_INVALID_RETRY_MS`) instead of latching
  OFF; `missing`/`v1_legacy` still OFF (stable no-pipeline states).

## AC2 RED-first evidence (pre-fix `main`)
- Server (`run-config-reader.transient.test.ts`): "serves last-good cache when
  the stat probe throws EPERM" → `expected 'invalid' to be 'ok'`; "last-good
  cache survives a full 5s poll gap" → `expected 'invalid' to be 'ok'`. 2 failed
  on pre-fix, green after.
- Client (`useRunConfig.test.ts`): "keeps polling on a transient invalid" →
  `expected false to be truthy`. RED pre-fix, green after.

## Self-Review (7-item)
1. Spec Compliance — PASS. Stat routed through the retry+cache envelope; TTL
   raised above the poll cadence; client stops latching. Matches Fix direction.
2. Error Handling — PASS. `retryTornRead` returns a discriminated outcome (never
   throws to the caller); non-retryable (EIO) + no-cache still → `invalid`;
   ENOENT resolves to `missing` via the default fsStat wrapper before retry.
3. Security Basics — PASS. Read-only observer (rules 1/12) intact — no writes to
   run_config / Claude JSONL; retry set unchanged (the 3 justified fs codes); no
   path handling altered.
4. Test Quality — PASS. AC2 RED-proven then green; malformed-readable → invalid
   (not stale) asserted; non-retryable EIO asserted; TTL-expiry boundary updated
   to 31s; real-fs round-trip probe (Calibration) run.
5. Performance Basics — PASS. Retry adds cost only on a real transient fault
   (~≤650ms budget); happy path adds one closure indirection. 10s invalid poll
   is LIGHTER than the 5s in_progress cadence.
6. Naming & Structure — PASS. `retryTornRead`/`serveLastGood`/`POLL_INVALID_
   RETRY_MS` descriptive; control flow < 3 levels; no dead code. reader 431 LOC
   (< 439 baseline); types 297 (< 300); new test files < 300; no ratchet.
7. Affected Boundaries (ADR-024) — PASS. Producer = orchestrator's atomic
   run_config write; consumer = readRunConfig → run-config route → useRunConfig
   poll. Real producer→file→consumer round-trip probe run (see Calibration).

## External Plan Review (Step 3.5, openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| A | HIGH | Footprint: touches types module + new transient test + useContinuePipeline.test.ts beyond the spec's 4-file list (AC4) | accepted-and-documented. Each deviation is sanctioned by the campaign brief, NOT a violation: (1) types module is EXPLICITLY directed by the brief ("add parse logic to the types module … NOT inline") + the spec Fix direction; (2) new `*.test.ts` is explicitly permitted by the brief when a footprint test hits the 300-LOC ceiling (the hook flagged run-config-reader.test.ts at 347); (3) useContinuePipeline.test.ts is FORCED by AC3 — its pre-existing block asserted `invalid→false`, the exact behavior inverted; leaving it → red suite. Serial #10, deps/blocks none, D01–D09 merged → no live parallel collision. |
| B | HIGH (gemini) | Node operational logic in a types module is an anti-pattern; if shared with the client it breaks the bundle | rejected-with-reason. Premise (shared file) is false here: server `types/run-config-v2.ts` and client `lib/run-config-v2.ts` are separate mirrors that never import each other (ADR-080 rule 7; `no-cross-package-imports.test.ts` passed). Helper added to the SERVER file only; `NodeJS.ErrnoException` is type-only; `retryTornRead` is a pure generic combinator (does no fs I/O). Follows the sanctioned `parseRunMode` precedent. Client build passed. |
| C | HIGH | TTL 5s→30s changes semantics: stale `ok` served up to 30s after the file becomes genuinely unreadable/malformed; untested | accepted-and-verified. Empirically FALSE for malformed-readable: the cache is served ONLY on a physical fault (stat/read/parse fails); a readable-but-malformed file returns `invalid` immediately (probe scenario 2). Genuinely-unreadable → stale-ok bounded to 30s then `invalid` (strictly better than pre-fix instant-vanish). All three cases the reviewer asked for are tested (fresh-cache→ok; expired→invalid @31s; malformed-readable→invalid). |
| D | MED | Retryability rule underspecified; over-broad retry can mask persistent perm errors | accepted-and-handled. Boundary = SyntaxError ∪ {EBUSY,EPERM,EACCES}; ENOENT deliberately non-retryable (→ `missing`). Identical set the read path already shipped — reused verbatim, now applied to stat too. Persistent EPERM surfaces within ≤30s (budget→cache-TTL→invalid), not masked forever. EIO-no-cache test asserts non-retryable still surfaces. |
| E | MED | Extracting helpers is abstraction-driven not change-driven; prefer local private helper | rejected-with-reason. Inline is explicitly forbidden by the brief (439-LOC ceiling); a private reader helper would still cross the ceiling. The types module is the codebase's established home for such logic (parseRunMode). Second production caller not required — the ceiling constraint is the driver. |
| F | LOW (gemini) | Client polls indefinitely every 10s on permanent corruption | rejected-with-reason. A bounded latch re-introduces the exact defect (a long transient would re-vanish the lane). 10s is lighter than in_progress 5s; server's 30s cache means the client rarely sees `invalid` at all. Genuinely-malformed run_config is a rare orchestrator bug. |
| G | LOW (gemini) | New run starting within the 30s window could over-serve the previous run's cache | rejected-with-reason. Cache is served ONLY on a physical read fault; a readable new-run file is parsed fresh and the cache refreshes to the new runId (probe scenario 4). Stale-serve applies only to the torn-write window we intend to mask, self-correcting next successful read. |

## External Code Review (Step 3.7, openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | MED (openai) | New server test file outside the spec footprint (AC4) | accepted-and-documented — see Plan-Review A(2). Reviewers saw only the spec's 4-file list, not the campaign brief that explicitly sanctions a new cohesive `*.test.ts` when a footprint test hits the ceiling. Core F15 behavior assessed "ship-with-fixes" where the only "fix" is the (already-sanctioned) footprint. |
| 2 | HIGH (gemini) | Footprint contract violation (useContinuePipeline.test.ts + transient test + run-config-v2.ts) | accepted-and-documented — see Plan-Review A(1/3) + B. Types module directed by the brief; useContinuePipeline touch forced by AC3; serial #10 → no parallel collision. No behavioral finding raised. |

Internal code-reviewer cascade: `reviews.code = delegated_to_orchestrator`
(orchestrator runs a code-reviewer subagent over the pushed diff before merge).

## Confidence Calibration (Step 3.8, touches_io_boundary)
Boundary: `shipwright_run_config.json` filesystem read — producer (orchestrator
atomic rename) → file → consumer (readRunConfig → run-config route → useRunConfig
poll cadence).
Probes run:
1. Injected-deps unit round-trips (committed): stat EPERM + fresh last-good →
   served ok; last-good survives a 5s poll gap; EIO-no-cache → invalid; existing
   read/parse retry + TTL-expiry suite green.
2. THROWAWAY real-fs probe (run then deleted): producer writes real config →
   readRunConfig with DEFAULT deps (real fs.stat + fs.readFile) → ok (runId
   run-a1b2c3d4); malformed-but-readable file WITH a fresh cache → `invalid`
   (NOT stale — proves stale-serve is bounded to physical faults); removed file
   → `missing` (ENOENT→null); rewrite valid → ok (cache refreshes to new
   content). PROBE PASS.
Findings: probe set 1 found the pre-fix bugs (RED), all fixed. Probe set 2 found
NO further issues → two consecutive clean probe rounds → asymptote reached,
boundary calibrated. The real-fs probe specifically falsified the plan-review
TTL-staleness worry (malformed-readable is never stale-served).
Edge cases not probed + why acceptable: a genuine cross-platform OS-level file
lock producing EPERM under real load (covered by the injected-deps EPERM test —
the code path is identical); indefinite 10s client polling on permanent
corruption (accepted resource tradeoff — see Plan-Review F).
