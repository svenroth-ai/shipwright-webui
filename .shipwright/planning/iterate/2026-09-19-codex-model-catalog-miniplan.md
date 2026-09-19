# Mini-Plan: codex-model-catalog

- **Run ID:** iterate-2026-09-19-codex-model-catalog

## 1. Files to create/modify

| File | Change |
|---|---|
| `server/src/core/codex-models-probe.ts` | new — runs `codex debug models`, parses + filters |
| `server/src/core/codex-models-probe.test.ts` | new |
| `server/src/routes/codex-models.ts` | new — `GET /api/codex-models`, TTL cache + inflight coalescing |
| `server/src/routes/codex-models.test.ts` | new |
| `server/src/index.ts` | edit — mount the new route |
| `client/src/lib/codexModelsApi.ts` | new — thin `httpJson` wrapper |
| `client/src/hooks/useCodexModels.ts` | new — `useQuery` wrapper |
| `client/src/components/external/NewIssueModal/ModelTierOverrideFields.tsx` | edit — `CodexModelField` gains `list=`/`<datalist>` |
| `client/src/components/external/NewIssueModal/ModelTierOverrideFields.test.tsx` | edit — new assertions, existing ones untouched |
| `.shipwright/agent_docs/architecture.md` | edit — new read-only observer entry (F2) |

## 2. Work breakdown

1. `codex-models-probe.ts`: `runCodexModelsProbe(deps)` — reuses
   `defaultRunShim` from `readiness-probe-run.ts` (same win32 `.cmd`-shim
   reasoning already documented there) to run `codex debug models` with no
   extra flags (confirmed: default performs the live refresh; `--bundled`
   would ship a stale catalog — see spec's Confidence Calibration). Parses
   `stdout` as JSON, filters `models[]` to entries that are objects with a
   string `slug` matching the existing `CODEX_MODEL_SLUG_PATTERN` (imported
   from `external/launch/parse-body.ts` — intra-server, not a DO-NOT #7
   cross-package import), a string `display_name`, and
   `visibility === "list"`; a non-conforming individual entry is dropped,
   not fatal to the whole list. Returns `{ ok: true, models }` or
   `{ ok: false }` on any failure (non-zero exit, thrown parse, `models` not
   an array) — never throws. **(external review fix, both reviewers)**:
   filtering catalog slugs through the same launch-validation pattern
   before they ever reach the client means a suggested slug can never be
   one the server would then reject. Test: real captured JSON fixture (full
   7-model sample, a malformed/empty one, and one with a bad individual
   entry) + non-zero-exit + timeout-shaped (`code: null`) cases.
2. `codex-models.ts`: `createCodexModelsRoutes({ ttlMs?, failureTtlMs?, probe? })`
   — same shape as `routes/readiness.ts` (in-memory `cached`/`inflight`),
   with TWO TTLs: success TTL default 5 minutes (`300_000`ms — long enough
   that repeatedly opening the New Iterate modal in one sitting doesn't
   re-shell every time, short enough that a same-day-shipped model shows up
   without a server restart), and a separate, shorter failure TTL default
   30s (`30_000`ms). **(external review fix, openai)**: without a distinct
   failure TTL, a genuinely broken/hanging `codex` would eat a full probe
   timeout on every single request past the (successful) TTL window; the
   failure TTL bounds how often a broken probe is retried, independent of
   how fresh a *successful* result must be. On a successful probe: cache +
   return `{status:"ok", models}`. On a failed probe: if a previous
   successful cache exists, return `{status:"stale", models: <last good>}`
   and remember the failure timestamp (not the success timestamp) so the
   next request within `failureTtlMs` skips straight to returning the same
   stale result without re-probing; if no previous cache exists, return
   `{status:"unavailable", models: []}` under the same failure-TTL
   short-circuit. Always HTTP 200. Test: mirrors `readiness.test.ts`'s
   cases (serves within TTL / coalesces concurrent cold requests /
   re-probes after TTL) plus stale-then-failure-TTL-suppresses-reprobe and
   unavailable-then-failure-TTL-suppresses-reprobe.
3. Mount in `index.ts` next to `createReadinessRoutes` (global route, not
   project-scoped — the Codex catalog isn't per-project). **(external
   review — network exposure, openai)**: mounted on the same Hono `app`
   instance via the identical `app.route("/", …)` pattern every other
   route uses, so it inherits the same CORS/loopback origin gate as the
   rest of `/api/*` — no bespoke, more-permissive path is introduced.
4. `codexModelsApi.ts` + `useCodexModels.ts`: mirrors `modelTierApi.ts` /
   `useModelTierConfig.ts` shape. **(external review fix, glm)**: client
   `staleTime` is set to 2 minutes — well under the server's 5-minute
   success TTL — so a fetch landing near the end of the server's cache
   window doesn't compound into a ~10-minute-stale worst case on the
   client side too.
5. `ModelTierOverrideFields.tsx`: **(external review fix — REQUIRED,
   both reviewers)** call `useCodexModels()` unconditionally at the top of
   `ModelTierOverrideFields` (never inside the `if (runtime === "codex")`
   branch) — a conditionally-invoked hook breaks React's rules of hooks the
   moment `runtime` can differ across renders (e.g. the toggle flips before
   this branch's early return). The query itself can still stay logically
   idle for non-Codex runtimes (`enabled: runtime === "codex"` inside
   `useCodexModels`, mirroring `useModelTierConfig`'s existing
   `enabled: Boolean(projectId)` pattern) — the *call*, not the *fetch*, is
   what must be unconditional. Generate one `useId()`-based id per
   component instance (`` `codex-model-catalog-${reactId}` ``) for the
   shared `<datalist>` — **(external review fix, both reviewers)**: a
   hardcoded string id would collide if two instances of this component
   are ever mounted at once (a second modal, or two tests rendering in
   parallel). All three `CodexModelField` instances point `list=` at that
   one instance-scoped id. Add one status caption line (mirrors
   `projectDefaultStatus`) for `stale`/`unavailable`, rendered once beneath
   the three fields — no per-field repetition. Existing validation/hint/
   border/`data-testid` logic in `CodexModelField` is untouched.
6. Update `.shipwright/agent_docs/architecture.md`'s read-only-observers /
   write-surface section with one new paragraph: `GET /api/codex-models` is
   a read-only observer of the external `codex` CLI's own catalog (not a
   webui-owned write surface, no new persisted state).

## 3. Component hierarchy

```
ModelTierOverrideFields (runtime === "codex" branch)
├── CodexModelField (Implementation model)  ─┐
├── CodexModelField (Plan review)            ├─ share one <datalist id="codex-model-catalog">
├── CodexModelField (Review)                ─┘   fed by useCodexModels()
└── status caption (stale/unavailable, once)
```

## 4. Data model changes
None — no new persisted state (server holds only an in-memory TTL cache,
identical posture to `routes/readiness.ts`; nothing written to
`~/.shipwright-webui/*.json` or any project file).

## 5. Test strategy
- Unit: `codex-models-probe.test.ts` (probe parsing/filtering/failure
  modes, fixture-driven from the real captured JSON shape), `codex-models
  .test.ts` (route caching/coalescing/degrade branches, mirrors
  `readiness.test.ts`).
- Component: `ModelTierOverrideFields.test.tsx` — new cases for datalist
  population + stale/unavailable caption; all pre-existing cases
  (validation hint, border color, testids, free-text-still-works) must
  keep passing unmodified.
- E2E (mandatory at medium+): extend/add a Playwright flow driving a
  Codex-runtime New Iterate modal, asserting the three fields render as
  comboboxes and a typed custom slug is still accepted.

## 6. Alternative approach (considered, rejected)

**Alternative: cache the catalog to disk (e.g. under
`~/.shipwright-webui/`) instead of in-memory-only, so a server restart
doesn't lose a "last known good" list.**

Rejected: this feature exists to track a catalog that "moves faster than
hand-maintained docs" (the card's own framing) — a disk-persisted stale
list surviving restarts works against that goal, adds a new persisted-state
surface for a genuinely low-stakes convenience (the free-text fallback
already exists and is always available), and every other "external tool
capability probe" in this codebase (`routes/readiness.ts`) already uses the
same in-memory-only TTL cache with no disk fallback — matching that
precedent keeps one pattern instead of two for the same class of problem.
A cold server always re-probes once (≤8s, async, off the request path for
everything else) rather than ever serving a potentially very stale disk
cache as if it were current.
