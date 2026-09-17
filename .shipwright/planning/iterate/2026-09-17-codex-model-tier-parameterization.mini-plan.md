# Mini-Plan — Codex model-tier parameterization

**Revised twice after external review** (2026-09-17): plan review (openai
leg, verdict `revise`) dropped the review-model override from scope;
architecture review (openai leg, verdict `revise`) then dropped the
reasoning-effort selector too. See the iterate spec's "Revision after
external plan review" and "Architecture Review" sections for the full
rationale. This plan covers the implementation-model override only — one
value, one CLI flag.

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
3. `parse-body.ts`: one new optional field, closed-enum validation (the
   four confirmed catalog slugs).
4. `runtime-chokepoint.ts`: read the field off `parsed`, pass into
   `buildCodexCommands`.
5. `ModelTierOverrideFields.tsx`: Codex branch — one select, same
   `FieldLabel`/`"only for this session"` hint pattern; static
   "Suggested policy (AGENTS.md) — gpt-5.6-terra" status line (not
   "Default" — external review finding).
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

## Alternative considered — Option B: server-side live catalog endpoint

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
