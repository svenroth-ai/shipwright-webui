# Mini-Plan — Codex model-tier parameterization

**Revised three times.** 2026-09-17, after external review: plan review
(openai leg, verdict `revise`) dropped the review-model override from
scope; architecture review (openai leg, verdict `revise`) then dropped the
reasoning-effort selector too. 2026-09-18, after shipwright#771 shipped a
real `codex_review`/`codex_plan_review` config axis: the four-slug closed
catalog enum (steps 3 and 5 below) is withdrawn in favor of a free-text
field validated by the same syntactic allowlist #771 established, and a new
step 9 adds a read-only Reviewer Identity display sourced from #771's
config keys. See the iterate spec's "Revision after external plan review",
"Architecture Review", and "Revision after shipwright#771" sections for the
full rationale — this file's steps below are updated in place, not
duplicated.

## Chosen approach

One session-scoped override for a Codex-runtime task — implementation model
only — plumbed outside the existing `resolveParameters()`/action-schema
pipeline (that pipeline is Claude-`command_template`-specific and would
silently drop the value — see spec's server-scope decision):

`-c model="<slug>"` CLI flag appended to the `codex`/`codex exec` launch
command (`launcher-codex.ts`).

Plumbing: `ParsedLaunchBody` gains one optional field
(`codexImplementationModel: string`) → validated in `parse-body.ts` against
the confirmed four-slug catalog enum → read by `runtime-chokepoint.ts` →
passed into `buildCodexCommands`.

Client: `ModelTierOverrideFields.tsx` grows a `runtime === "codex"` branch
(one `<select>`: model) instead of returning `null`; enum is a local
constant, not server-schema-driven (see spec's client-scope decision).

### Steps

1. **Traced the form-submission path (confirmed):**
   `useNewIssueFormSubmit.ts:170-175` builds `body.parameters` via
   `explicitParamEntries(input.currentSchema, input.paramValues,
   input.paramEnabled)` — which iterates `currentSchema` only
   (`paramHelpers.ts:76`, `for (const p of schema)`), so any `paramValues`
   key NOT present in the action schema is silently dropped, confirming the
   plan's decision to avoid `paramValues` for this override. **Fix:** a new
   dedicated top-level `body.codexImplementationModel` field, built from its
   own local component state (not `paramValues`), mirroring how
   `campaignSlug`/`campaignStep`/`masterRun` are already separate top-level
   launch-body fields outside the schema-driven `parameters` object. Scope:
   this iterate wires the override through `useNewIssueFormSubmit.ts`'s
   create+launch flow only — parity with Claude's `review-model`/
   `plan-review-model`, which have the same limitation (neither survives a
   bare `{resume:true}` Resume/Relaunch POST from TaskDetail; both are
   "only for this session" by the existing UI hint text, not a bug this
   iterate needs to fix).
2. `launcher-codex.ts`: extend `CodexLaunchArgs` with `implementationModel?:
   string`; extend `renderCodex` to append `-c model="<slug>"` (via the
   existing `q()` quoting helper) in BOTH the fresh-launch and `resume`
   branches. TDD: unit tests first, command-string assertions for
   {fresh, resume} × {override set, override unset} = 4 cases minimum.
3. `parse-body.ts`: one new optional field. ~~Closed-enum validation (the
   four confirmed catalog slugs).~~ **Revised 2026-09-18:** syntactic
   allowlist (`CODEX_MODEL_SLUG_PATTERN`, mirrors shipwright#771's
   `_CODEX_MODEL_SLUG_PATTERN` verbatim), trimmed before validating.
4. `runtime-chokepoint.ts`: read the field off `parsed`, pass into
   `buildCodexCommands`.
5. `ModelTierOverrideFields.tsx`: Codex branch. ~~One select, same
   `FieldLabel`/`"only for this session"` hint pattern.~~ **Revised
   2026-09-18:** a free-text `<input>`, same `FieldLabel`/hint pattern,
   placeholder "Suggested policy (AGENTS.md) — gpt-5.6-terra" (not
   "Default" — external review finding), plus a best-effort inline warning
   (non-blocking; server is the real gate) when the typed value doesn't
   match the client-mirrored pattern.
6. Wire the new field into the launch POST body per step 1's trace.
   Integration test: runtime toggle → selected value → launch request body
   → parsed launch value → resulting Codex command — the exact chain the
   external review flagged as the critical, easy-to-silently-break link.
7. Live confirmation test (AC2): one real `codex exec` invocation with the
   override set, confirming the `-c model=` flag is accepted without error.
   Do NOT assert an exact self-reported model name — confirmed live in this
   session that Codex's self-report is unreliable even for its own default
   model (two different wrong answers across two calls); the claim under
   test is "the flag is valid CLI config, accepted by the process", not
   "the model self-identifies correctly".
8. Full test suite; E2E spec update if `NewIssueModal`'s E2E coverage
   touches the Codex runtime toggle.
9. **(added 2026-09-18, post-#771 — AC5)** `model-tier-config-reader.ts`:
   extend to read `codex_review`/`codex_plan_review` (non-empty string
   after trim, same fail-soft/invalid-value-tolerant posture as the
   existing Claude-tier roles; independently — one bad key must not blank
   a good sibling key or any Claude tier). Widen `ModelTier`/`VALID_TIERS`
   to accept `fable` (DO-NOT #7 mirror fix for #771's Claude-tier
   addition). `ModelTierOverrideFields.tsx`: second, read-only block in the
   Codex branch showing both values (or an honest "not configured" status)
   — no `<input>`/`<select>`, matching "Framework config is never mutated
   here" (`external/model-config/routes.ts`). TDD: reader unit tests first,
   then the component test.

## Alternative considered — Option B: server-side live catalog endpoint

**Superseded 2026-09-18:** the premise this rejection argued from (a
hardcoded four-slug enum vs. a live-catalog-serving endpoint) no longer
applies — the enum itself was withdrawn in favor of a syntactic allowlist,
so there is no longer a catalog to keep in sync either way. Kept below for
the historical record of why a catalog-serving endpoint wasn't built; the
same reasoning (scope, new route/hook/readiness-guard/caching policy) would
apply equally to an *autocomplete-suggestion* endpoint if one were proposed
later, which is why that's called out explicitly as still out of scope in
the revised Non-goals.

Add a small `GET /api/external/codex-model-catalog` route that shells out to
`codex debug models` (or caches its result) and serves the confirmed
`"visibility":"list"` slugs to the client, mirroring how `useModelTierConfig`
reads Claude's project config today. This would make the Codex enum
self-updating across Codex CLI upgrades instead of a hardcoded constant.

**Rejected for this iterate:** adds a new server route, a new client hook, a
new readiness/availability question (what happens when `codex` isn't
installed on this machine — the enum endpoint would need the same
`isCodexCliAvailable()` guard `runtime-chokepoint.ts` already has), and a
caching/staleness policy — real scope beyond what the source spec asked for.
The four slugs are a small, named, stable-looking set (confirmed live in
this session); a follow-up iterate can add the live endpoint if the catalog
turns out to drift often. Noted as a known limitation in AC/testing, not
silently dropped.
