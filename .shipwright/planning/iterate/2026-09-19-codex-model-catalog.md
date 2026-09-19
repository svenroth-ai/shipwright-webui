# Iterate Spec: codex-model-catalog

- **Run ID:** iterate-2026-09-19-codex-model-catalog
- **Type:** feature
- **Complexity:** medium
- **Status:** implemented

## Goal
Follow-up to PR #473/#474: the Codex Implementation model / Plan review / Review
fields in the New Iterate "More options" panel are currently blind free-text
inputs with no feedback on whether a typed slug is real until launch fails.
Replace them with comboboxes backed by a live, self-refreshing model catalog
(`codex debug models`) so the user gets suggestions without the webui ever
hand-maintaining (and inevitably falling behind) a slug enum.

## Acceptance Criteria
- [x] A new server endpoint runs `codex debug models` (reusing the
      `execFile`/`shell:false` probe pattern from
      `core/readiness-probe-run.ts`'s `defaultRunShim`, since `codex` is a
      Windows `.cmd` PATHEXT shim), caches the parsed result for a short TTL,
      and returns only `visibility === "list"` entries as `{slug, display_name}`
      — the large per-model payload (descriptions, reasoning-level metadata,
      multi-KB `model_messages.persistent_instructions` prompt text) is
      discarded server-side and never reaches the client.
- [x] The endpoint never blocks or fails the launch form: when the probe
      fails (codex not installed, non-zero exit, timeout, unparseable
      stdout) it degrades to a `stale` response (last good cache, if any) or
      `unavailable` (empty list) — both HTTP 200, never 4xx/5xx for this
      reason.
- [x] `ModelTierOverrideFields.tsx`'s three Codex model fields (Implementation
      model, Plan review, Review) become comboboxes (`<input list>` +
      `<datalist>`) populated from the endpoint, with the existing free-text
      input always still accepting a custom/unlisted slug — the dropdown is
      a convenience, never a restriction.
- [x] Server-side request validation is unchanged: `CODEX_MODEL_SLUG_PATTERN`
      in `parse-body.ts` remains the sole gate, applied identically whether
      the live catalog was reachable or not.
- [x] Implementation model keeps its existing `-c model=` launch wiring
      (unaffected by this change; its prior removal proposal, trg-be9df375,
      is superseded).

## Spec Impact
- **Classification:** modify
- **MODIFY:** FR-01.16 Action catalog — the existing
  `(iterate-2026-09-19-codex-reviewer-fields, MODIFY)` acceptance criterion
  describing the three free-text Codex model fields gets a new AC line
  describing the combobox/catalog behavior layered on top of it (the
  free-text contract itself — validation regex, launch env-var wiring,
  never-persisted posture — is unchanged, so this is additive, not a
  rewrite of the existing line).
- **NONE justification:** n/a (classification is modify)

## Out of Scope
- Reasoning-level (`low`/`medium`/.../`ultra`) selection — out of scope,
  the existing `-c model=`/env-var wiring carries only the slug.
- Any change to `CODEX_MODEL_SLUG_PATTERN` itself or to how the value is
  threaded into the launch command — unchanged per WHAT (3).
- Resolving whether AGENTS.md's own hardcoded model mention is redundant
  with this catalog — stays an open question per the card, not decided here.
- A per-project or per-task persisted "last used Codex model" — out of
  scope; these three fields keep their existing session-only,
  never-persisted posture.

## Design Notes
No new visual component: the existing `CodexModelField` free-text `<input>`
gains a `list="<paramKey>-options"` attribute plus a sibling `<datalist>`
built from the fetched catalog. Native `<datalist>` was chosen over a
Radix/headless combobox because (a) it needs zero new dependency in a file
that currently imports none, (b) the "always allow free text" requirement
is the *default* behavior of `<input list>` (no suppression to fight), and
(c) the existing invalid-shape hint / border-color / `data-testid` behavior
is preserved untouched — only the `list` attribute and the `<datalist>`
sibling are added. A one-line status caption (mirroring the existing
`projectDefaultStatus`/`defaultOptionLabel` pattern already in this file)
reports `stale`/`unavailable` so the user understands why suggestions look
thin or absent, without blocking typing.

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| `codex debug models` (external CLI stdout) | `server/src/core/codex-models-probe.ts` | JSON (`{models: [...]}`) |
| `GET /api/codex-models` (server route) | `client/src/lib/codexModelsApi.ts` | JSON (`{status, models}`) |

This is a genuine `touches_io_boundary` case (parsing an external process's
JSON stdout that this codebase does not control the shape of) — the Boundary
Probe sub-step in Build TDD applies.

## Confidence Calibration
- **Boundaries touched:** external `codex debug models` stdout → server
  probe → `GET /api/codex-models` → client hook.
- **Empirical probes run (this session, before any code was written):**
  - `codex debug models` (installed CLI v0.155.0, this dev machine):
    exit 0, ~0.48s wall time, pure-JSON stdout (`{"models":[...]}`, 7
    entries, 5 `visibility:"list"` / 2 `"hide"` — matches the card's spike
    exactly).
  - Warnings (e.g. a PATH-alias warning under an unusual `CODEX_HOME`) print
    to **stderr only** — stdout stays pure, parseable JSON; confirmed by
    capturing stdout/stderr separately and `JSON.parse`-ing stdout alone.
  - **Auth requirement resolved: none.** Re-ran with `CODEX_HOME` pointed at
    an empty, freshly-created directory (no `auth.json`, i.e. a simulated
    logged-out state) — `codex debug models` still exited 0 and returned the
    full catalog in ~0.18s. The probe does not require a logged-in Codex
    CLI; the endpoint therefore needs no auth-specific degraded path.
  - **`--bundled` flag exists** ("skip refresh, dump only the catalog shipped
    with this binary") and returns a visibly *older* catalog (9 models,
    missing the newly-listed `gpt-reserve`, carrying stale entries like
    `gpt-5.4`/`gpt-daybreak-*-latest` the refreshed call no longer lists) —
    confirms the default (non-`--bundled`) invocation performs a live
    refresh, which is the entire point of this feature (staying ahead of a
    hand-maintained enum). Decision: do **not** pass `--bundled`.
  - Sub-second latency without a visible stall is consistent with either a
    fast/cached remote lookup or a local daemon-backed cache; not fully
    distinguishable from this machine alone, and not load-bearing for the
    design either way — the server-side TTL cache + generous 8s probe
    timeout (reusing `PROBE_TIMEOUT_MS`) tolerate either case.
- **Test Completeness Ledger:** see below (filled after Build; enumerated
  now from the ACs above).

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | Probe parses real `codex debug models` JSON shape, filters to `visibility==="list"` + valid slug/display_name, maps to `{slug, display_name}` | tested | `codex-models-probe.test.ts` (7 cases) PASSED |
  | 2 | Probe drops an individual malformed entry without failing the whole list | tested | `codex-models-probe.test.ts::drops an individual malformed entry...` PASSED |
  | 3 | Probe returns not-ok on non-zero exit / timeout / unparseable stdout / non-array `models` | tested | `codex-models-probe.test.ts` (4 cases) PASSED |
  | 4 | Route serves a fresh probe result within TTL without re-probing, coalesces concurrent cold requests | tested | `codex-models.test.ts` (2 cases) PASSED |
  | 5 | Route degrades to `stale` (last good cache) when a later probe fails | tested | `codex-models.test.ts::degrades to stale...` PASSED |
  | 6 | Route degrades to `unavailable` (empty list) when no cache exists and the probe fails | tested | `codex-models.test.ts::degrades to unavailable...` PASSED |
  | 7 | Route suppresses re-probing for `failureTtlMs` after a failure, then retries once it elapses | tested | `codex-models.test.ts` (3 cases) PASSED |
  | 8 | Client combobox renders fetched slugs as datalist options, free text still accepted | tested | `NewIterateModal.codex-model.test.tsx::populates the shared datalist...` PASSED + real-browser E2E `model-tier-defaults.spec.ts::suggests catalog slugs...` PASSED |
  | 9 | Client shows an `unavailable`/`stale` caption without blocking typing | tested | `NewIterateModal.codex-model.test.tsx::shows an 'unavailable' caption...` PASSED + real-browser E2E `model-tier-defaults.spec.ts::shows an unavailable caption...` PASSED |
  | 10 | Existing invalid-shape validation/hint/border/testid behavior unchanged | tested | `NewIterateModal.codex-model.test.tsx` (4 pre-existing cases, unmodified) PASSED |
  | 11 | `CODEX_MODEL_SLUG_PATTERN` server validation unchanged regardless of catalog reachability | covered-by-existing-test | `parse-body.test.ts` (pre-existing, untouched) |
  | 12 | Codex hook call is unconditional (no rules-of-hooks violation when runtime toggles) | tested | `NewIterateModal.codex-model.test.tsx::Runtime=Claude (toggled back from Codex)...` PASSED — toggling Codex→Claude→Codex across renders raises no React warning/crash |
  | 13 | Probe gates on `result.code === 0`, not the shared version-regex `ok` heuristic — succeeds on an all-integer-slug catalog | tested | `codex-models-probe.test.ts::still succeeds when the shared version-regex heuristic reports ok:false...` PASSED |
  | 14 | Probe de-dupes a repeated slug from the external CLI, first-wins | tested | `codex-models-probe.test.ts::de-duplicates a repeated slug...` PASSED |
  | 15 | Client's inline slug-pattern mirror stays byte-identical to the server's canonical `CODEX_MODEL_SLUG_PATTERN` | tested | `codex-slug-pattern-client-sync.test.ts` PASSED |
  | 16 | Probe and route both degrade to the HTTP-200 contract (never 500) when the probe/`run` promise REJECTS, not just resolves `ok:false` | tested | `codex-models-probe.test.ts::is not-ok (never throws) when the run override REJECTS` + `codex-models.test.ts` (2 rejecting-probe cases) PASSED |

- **Confidence-pattern check:** asymptote — the architecture-review "is this
  proportionate?" question already produced a `reject` + a fix-integration
  cycle before Build began (see `## Architecture Review`); no further
  "are you confident?" loop surfaced during Build itself. Coverage — every
  ledger row above is `tested` or `covered-by-existing-test`;
  0 untested-testable. Rows 13-16 added after code-review/doubt-review/
  external-code-review fixes (see those sections).

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** medium
- **Summary:** Solid, well-scoped plan that correctly reuses the readiness-probe TTL-cache and win32-shim patterns, keeps the server-side slug validation gate untouched, and strips the large per-model payload before it reaches the client; the only real gaps are a missing backoff on repeated probe failures and two low-severity documentation/test-coverage completeness notes.
- **Findings:**
  - performance/medium: no backoff on repeated probe failures (unbounded retry cost) — **fix** (converges with external `openai` review's same finding; integrated as the failure-TTL below).
  - completeness/low: new modules should also land in `component_inventory.md` (+ optionally `doc-sync.test.ts` `REQUIRED_TOKENS`) — **fix**, folded into Step 6/F2.
  - completeness/low: E2E environment may not have Codex CLI installed, so the "populated catalog" path may only be unit-tested, not E2E-proven — **fix**, resolved by route-interception in the E2E (already decided from the external `openai` review) rather than depending on a real installed CLI.
  - architecture/low: the probe intentionally runs from the server's own cwd, not a project directory (global, not per-project) — **fix**, one-line comment in `codex-models-probe.ts`.
- **Known limitations:** none disclosed (every finding integrated as a fix).
- **Status:** 4 fixed

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-09-19-codex-model-catalog/architecture_brief.md`
- **Verdicts:** glm=approve · openai=reject
- **Smallest thing that would do (per reviewers):** openai proposed retaining
  free text and adding a discoverability hint pointing at `codex debug
  models` (no new endpoint). glm proposed "as proposed" (option A), noting
  a smaller-still alternative (folding the probe into the existing
  readiness endpoint) is not actually smaller since it would couple two
  probes with different freshness/degradation semantics.
- **Findings:** glm — proportionality/low: the feature has accumulated a
  fair amount of defensive machinery (failure TTL, status captions, TTL
  skew handling, datalist-id collision handling) for a non-blocking
  convenience — **accepted, not fixed further**: this is a deliberate
  "resist further hardening beyond what's already planned" note, not a
  request for more code. openai — proportionality/medium: a live-probe
  pipeline is disproportionate to preventing a recoverable launch-time typo
  — **rejected-with-reason**, see Reconciliation below.
- **Reconciliation:** openai's `reject` recommends exactly the "keep free
  text, add a hint" alternative — which is Option B/D from the brief's own
  options list. That alternative was not silently rejected by this run's
  author; it is the status quo the *user's own iterate request* explicitly
  named and rejected before this run started: *"free-text with no feedback
  on correctness until launch is bad UX, but a hardcoded model-slug enum
  would need a PR every time OpenAI ships a new Codex model — neither is
  acceptable."* Per protocol, a `reject` from either reviewer stops the run
  and asks the operator rather than deciding unilaterally — the operator
  (Sven) was asked directly, framed in plain terms (build the dropdown vs.
  take the simpler hint-only alternative vs. rework), and chose **"Build
  the dropdown as planned."** Decision: proceed with Option A exactly as
  scoped in the mini-plan. glm's approval plus the operator's own
  pre-stated and now-reconfirmed rejection of the free-text-only
  alternative together settle the contradiction; openai's finding is
  recorded, not silently dropped, but does not change the plan.

## External Plan Review (Branch A)
Both providers reviewed the spec + mini-plan (`external-plan-review-raw.json`).
- **glm — approve**, one required fix: `useCodexModels()` was originally
  planned as a conditionally-called hook inside the `runtime === "codex"`
  branch — a rules-of-hooks violation. Also flagged: client `staleTime`
  skew vs. server TTL, cold-start probe latency on the first request,
  shared `<datalist>` id collision risk, and per-entry catalog defensiveness.
- **openai — revise**: same conditional-hook finding at `high` severity,
  plus: no backoff on repeated probe failures, catalog slugs not filtered
  through `CODEX_MODEL_SLUG_PATTERN` before being suggested, route
  network-exposure posture unstated, datalist id collision, and E2E
  determinism (depending on a real installed Codex CLI).
- **Contradiction check:** none — both converge substantively (glm's
  "approve" already named the same required fix openai rated "revise" on).

**Triage (fix / disclose / decline, all with reason):**
| Finding | Disposition | Reason |
|---|---|---|
| Conditional hook call | **fix** | Real correctness bug (rules of hooks); both reviewers flagged it independently, one at `high`. |
| Client `staleTime` == server TTL (skew) | **fix** | Cheap: set client `staleTime` to 2 min, well under the server's 5 min. |
| Shared hardcoded `<datalist>` id | **fix** | Real collision risk (two mounted instances); `useId()` is a one-line fix. |
| Per-entry catalog defensiveness | **fix** | Cheap, and this is genuinely untrusted external-process output. |
| No failure backoff (unbounded re-probe cost) | **fix** | Converges with the Internal Plan Review's `medium`-severity finding; added a separate 30s failure TTL. |
| Catalog slugs not pre-filtered against `CODEX_MODEL_SLUG_PATTERN` | **fix** | Cheap (intra-server import, not a cross-package violation) and prevents a suggested-but-rejected slug. |
| Route network-exposure posture unstated | **fix (already satisfied by design)** | Mounted via the identical `app.route("/", …)` pattern as every other route — no bespoke exposure; documented explicitly in the mini-plan rather than left implicit. |
| E2E depends on a real installed Codex CLI | **fix** | Route-intercept `/api/codex-models` with a fixed response in the E2E; keep real-parsing coverage at the unit level. |
| Cold-start first request pays up to 8s probe latency | **disclose** | Same accepted tradeoff as `routes/readiness.ts`'s existing precedent (synchronous probe-then-respond); does not block form typing (async fetch, free text always usable). Not worth a stale-while-revalidate redesign for a convenience feature. |
| Doc-sync completeness (`component_inventory.md`) | **fix** | Folded into the mini-plan's Step 6 / F2. |

No `severity: high` finding was declined or merely disclosed — the one
`high` (conditional hook) is fixed, so the Step 3.5 "STOP and ask the user"
gate for a declined/disclosed high-severity finding does not apply.

## Self-Review
```
Self-Review:
  1. Spec Compliance:    [pass] All ACs implemented: probe + route + combobox + status caption + unchanged server validation + unchanged Implementation-model wiring; no extra features beyond scope.
  2. Error Handling:     [pass] Probe never throws (try/catch around JSON.parse, defensive shape checks); route always returns HTTP 200 across ok/stale/unavailable; no unhandled null at any boundary.
  3. Security Basics:    [pass] `execFile(shell:false)` with fixed literal args ("codex debug models") — no injection surface; catalog slugs re-filtered through the existing `CODEX_MODEL_SLUG_PATTERN` before ever reaching the client; `display_name` renders through React (auto-escaped); no secrets/tokens involved; launch validation (the real trust boundary) is untouched.
  4. Test Quality:       [pass] Every new test asserts observable outcomes (JSON shapes, DOM attributes/values), not internals; happy + error/degrade paths covered per behavior (see Test Completeness Ledger).
  5. Performance Basics: [pass] No N+1/loop-of-calls; TTL + failure-TTL caching bounds probe frequency; catalog is a handful of entries, no pagination concern; probe is async (execFile), never blocks the event loop.
  6. Naming & Structure: [pass] Files match existing conventions (`core/`, `routes/`, `lib/`, `hooks/`); all new/modified files are 279 lines or fewer (well under the 300-line guideline); naming mirrors the sibling `readiness`/`modelTier` modules.
  7. Affected Boundaries:[pass] Producer (external `codex debug models` stdout) → consumer (`codex-models-probe.ts`) identified; a real captured-JSON fixture round-trips through the probe in `codex-models-probe.test.ts` (touches_io_boundary fired — this is the Boundary Probe sub-step, satisfied).
  8. Test Hygiene Probe: [pass] `scan_test_hygiene.py --diff` → "no findings".

Action: All clear, proceed to commit.
```

## Doubt Review (Stage 3)

Fresh-context adversarial pass, run after code-reviewer PASS (async/subprocess
+ external-CLI trust boundary triggered it). Concurrency/ordering was hand-traced
across every TTL/failure-TTL/coalescing interleaving and could not be disproven.
Three boundary/blast-radius doubts were raised; disposition below.

1. **[low, fixed] Duplicate slug from the external CLI.** No de-dup step existed
   over `rawModels`, so two `visibility:"list"` entries sharing a `slug` would
   reach the client as two `<option>`s sharing one React key. Fixed:
   `runCodexModelsProbe` now de-dupes on `slug` (first-wins, `Map`-based);
   regression test added (`codex-models-probe.test.ts`, "de-duplicates a
   repeated slug, first-wins").
2. **[low, fixed] Client/server regex drift, untested.** The client's inline
   "best-effort hint" mirror of `CODEX_MODEL_SLUG_PATTERN`
   (`ModelTierOverrideFields.tsx`) was byte-identical to the server's today but
   had no test pinning that. A future edit to either side alone would let the
   shared catalog `<datalist>` suggest a slug the client's own hint then paints
   as invalid. Fixed: added
   `server/src/external/launch/codex-slug-pattern-client-sync.test.ts`, a
   cross-workspace text-comparison drift guard mirroring
   `action-schema-sync.test.ts`'s existing pattern (reads the client file's
   *content* via `node:fs`, not its types — no cross-package import).
3. **[medium, accepted — not fixed] Possible Windows orphaned-process leak on a
   hung `codex debug models` probe.** `defaultRunShim`'s win32 branch runs the
   probe as `cmd.exe /d /s /c codex ...` (codex is a `.cmd` PATHEXT shim); if a
   grandchild process (the actual Codex CLI binary) is what hangs rather than
   `cmd.exe` itself, Node's `execFile` timeout kills only the immediate child,
   potentially leaving an orphan. **Accepted as pre-existing shared
   infrastructure, not introduced by this iterate**: `defaultRunShim` and its
   timeout-kill behavior already back the pre-existing `codex --version`
   readiness probe (`readiness-probe-run.ts`), so any process-tree-kill gap is
   inherited infrastructure risk, not new surface this change adds. This
   iterate's own Confidence Calibration does note the sub-second latency is
   "consistent with... a fast/cached remote lookup" without ruling out network
   I/O, which is why the doubt-reviewer flagged this probe specifically as
   somewhat more likely to exercise a real hang than the `--version` probe —
   but fixing `win32-spawn.ts`/`readiness-probe-run.ts` to do tree-aware kill
   (e.g. `taskkill /t`) is a shared-module change affecting every other
   `defaultRunShim`/`defaultRun` caller, out of scope for a launch-form
   combobox feature. Filed as a candidate follow-up, not blocking this PR.

## External Code Review

Branch A (keys present, `external_code_review.enabled: true`) — cascaded to
`glm` (via OpenRouter) and `openai` (via Codex), driver `claude`. Both legs
succeeded; verdicts agreed (`revise`/`revise`, no contradiction). Findings and
disposition:

| # | Severity | Reviewer | Finding | Disposition |
|---|---|---|---|---|
| 1 | medium | openai | `codex-models.ts`'s route handler had no `.catch()` on `probe()`; a rejecting probe would 500 the endpoint instead of degrading to `unavailable`/`stale`, violating the "always HTTP 200" AC. | **fixed** — `.catch()` added before the degrade `.then()`; regression tests added (rejecting-probe → still-200 unavailable/stale). |
| 2 | medium | openai | `runCodexModelsProbe`'s own `await run(...)` had the identical gap — the docstring claimed "never throws" without a `try/catch` backing it for a rejecting `run` override. | **fixed** — wrapped in `try/catch`, returns `{ok:false, models:[]}`; regression test added. |
| 3 | medium | glm | E2E spec's `page.locator(`#${datalistId} option`)` used React 18's `useId()` output (contains colons, e.g. `:r1:`) as a raw unescaped CSS id selector — would throw at runtime. | **fixed** — switched to an attribute selector (`[id="${datalistId}"] option`), which needs no escaping. |
| 4 | low | glm | Stale-serve window during `failureTtlMs` has no bounded "how stale" signal to the client (no `staleAt`/age field). | **accepted, not fixed** — matches the spec's own stated "stale = last good cache" semantics; explicitly called "acceptable as-is... not blocking" by the reviewer. No client behavior depends on staleness age today. |
| 5 | low | glm | `"memoises within the TTL"` test has no negative control on its own; only catches a "cache forever" regression jointly with the separate `ttlMs: -1` re-probe test. | **accepted, not fixed** — reviewer's own note: "coverage as a whole is sound," observational only. |

All fixes verified: server unit tests (22 passing across the three affected
files), `tsc --noEmit` clean (server + client), and the F0.5 web-surface
E2E re-run green (`exit_code: 0`, `tests_run: 4`, including the corrected
locator).

## Verification (medium+)
- **Surface:** web
- **Runner command:** `node client/e2e/isolated-stack.mjs client/e2e/flows/model-tier-defaults.spec.ts --project=chromium --reporter=line`
- **Evidence path:** `.shipwright/runs/iterate-2026-09-19-codex-model-catalog/surface_verification.json` — `exit_code: 0`, `tests_run: 4` (2 pre-existing Codex-runtime cases + 2 new specs authored for this iterate), real Chromium via `isolated-stack.mjs`.
