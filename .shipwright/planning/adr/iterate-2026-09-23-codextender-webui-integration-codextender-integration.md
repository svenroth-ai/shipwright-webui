# Codextender integration mode for Codex-runtime tasks

## Context

Codex Light (a prior iterate) added Codex CLI as an alternate task runtime.
Some users don't run the real `codex` CLI at all — they run "Codextender", a
local LiteLLM proxy that lets an ordinary `claude` process draw on a
Codex-plan subscription. WebUI needed to support that path through the same
task model and the same New Iterate/model-tier UI, without conflating it
with Codex Light or requiring webui to spawn anything itself (CLAUDE.md
architecture rule 1 is unconditional).

## Decision

Added a global `codexIntegrationMode: "light" | "codextender"` setting,
orthogonal to `task.runtime`. A Codextender-mode Codex-runtime task's
launch/fork reuses the already-built plain-Claude `CopyCommandForms` and
prepends an env-var block (`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/
`ANTHROPIC_MODEL`/`CODEXTENDER_ACTIVE`/`CODEXTENDER_MODEL`) pointed at the
local proxy (`core/launcher-codextender.ts`), instead of building a
`codex ...` command. Availability is gated by a new liveness probe
(`GET /health/liveliness`, no auth) in `runtime-chokepoint.ts`'s
`checkCodextenderProxyAvailable`, kept separate from the model-catalog probe
(`GET /v1/models`, which the proxy requires `Authorization: Bearer <token>`
for). AC7/AC9's Codex Light campaign/new-pipeline blocks are bypassed for
Codextender mode, since it drives ordinary `claude` and has the same
pipeline/resume machinery a Claude-runtime task does. The client's
`ModelTierOverrideFields`/`CodexModelOverrideFields` gained an
`isCodextender` branch: Codextender-only placeholders, a
`GET /api/codextender-models` catalog hook, and a static `sol`/`astra`
fallback when the proxy is unreachable (Codex Light's own empty-list
behavior is unchanged).

## Consequences

- New global setting surface (`Settings → Codex` gains an integration-mode
  select + a Codextender-port input), new read surface (the two proxy
  endpoints), new route (`GET /api/codextender-models`).
- `fork.ts` cannot call the shared chokepoint (pre-existing constraint,
  §2.1), so its own Codextender branch duplicates the mode check and reuses
  the same error-message builders via a new shared
  `runtime-chokepoint-errors.ts` file.
- A `CodextenderCwdMismatchError` is now a real, user-facing 500
  (`codextender_cwd_mismatch`) rather than a silent double-`cd`-prefix, for
  the case where a custom action's commands were built from `project.path`
  instead of `task.cwd` (see Rejected alternatives).

## Rationale

Reusing the plain-Claude `CopyCommandForms` (rather than building a fresh
Codextender-specific command from scratch) keeps every existing Claude
launch/resume/fork code path as the single source of truth for the actual
`claude` invocation shape; Codextender only ever adds an env-var prefix in
front of it. Splitting the liveness probe from the model-catalog probe
follows directly from the proxy's own two different auth requirements
(verified live against a running Codextender instance during this run's
spec-review round) — collapsing them into one probe would have made the
AC8-equivalent preflight either always fail (if it required auth) or the
model catalog always 500 (if it didn't).

## Rejected alternatives

1. **Silently fall back to prepending the env-var block when the `cd`-prefix
   doesn't match `cwd`** (the original implementation) — rejected after
   Stage-3 doubt review: this produces an ambiguous, double-`cd`-prefixed
   command with no error, which can launch in the wrong directory
   undetected. Replaced with a typed `CodextenderCwdMismatchError` and a
   fail-loud 500.
2. **A single combined proxy-availability probe reused for both AC8
   preflight and model catalog** — rejected by the spec-reviewer's first
   round (Stage-1 hard-gate REJECT): the two endpoints have different real
   auth requirements, and this shape reads as passing spec review only by
   accident of which endpoint happened to be probed.
3. **Reading `codexIntegrationMode` from an independent `useSettings()` call
   inside `ModelTierOverrideFields`** — rejected by code review in favor of
   threading it down as a prop from the same `form.codexIntegrationMode`
   value its sibling `RuntimeFieldFragment` already receives, avoiding a
   second settings read for the same value.

## Testing

Server: `codextender-proxy-probe.test.ts` (both probes),
`launcher-codextender.test.ts` (env-prefix injection + cwd-mismatch throw),
`runtime-chokepoint.codextender.test.ts` (chokepoint branch + AC7/AC9 bypass
+ cwd-mismatch 500), `fork.codextender.test.ts` (fork inheritance + TOCTOU
regression). Client: `ModelTierOverrideFields.codextender.test.tsx`. E2E:
`client/e2e/flows/codextender-integration.spec.ts` (3 tests — Codextender
placeholders/catalog, static fallback + unreachable caption, light-mode
non-regression), run via the isolated stack, F0.5 surface_verification
`web` surface, `tests_run: 3`, exit 0.
