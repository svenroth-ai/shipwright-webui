# Architecture Brief: codex-model-catalog

## The problem

The New Iterate form lets an operator type a free-text Codex model slug for
three fields (Implementation model, Plan review, Review) with zero feedback
on whether that slug is real until the launch is attempted. A hardcoded
enum of valid slugs would need a code change every time the model provider
adds or renames a model, and has already lagged the provider's own catalog
in this project's own AGENTS.md reference doc.

## What already exists here

- `core/readiness-probe.ts` / `readiness-probe-run.ts` — the server already
  shells out to external CLIs (`uv`, `git`, `codex --version`) via
  `execFile`/`shell:false`, with a Windows `.cmd`-shim fallback for `codex`
  specifically, and reports the result over a cached HTTP endpoint
  (`routes/readiness.ts`, in-memory TTL cache + inflight coalescing).
- `external/launch/parse-body.ts` — a fixed syntactic allowlist regex
  (`CODEX_MODEL_SLUG_PATTERN`) is the sole server-side gate on any Codex
  model slug a launch actually uses; unaffected by this change.
- `hooks/useModelTierConfig.ts` + `external/model-config/routes.ts` — an
  existing pattern for a small, cached, read-only server-derived config
  value feeding a client dropdown.

## What would newly, permanently exist

A new server module that periodically shells out to `codex debug models`,
an in-memory TTL-cached HTTP endpoint serving the filtered result, and a
client hook/combobox consuming it. It runs on demand (no background timer —
probed lazily on request, like the readiness endpoint), holds no persisted
state (in-memory cache only, lost on restart), and is kept correct by
nothing beyond "the external CLI's own catalog changes" — there is no
schema this project owns that could drift, since the shape consumed is
just `{slug, display_name}` filtered by an already-existing validation
pattern.

## Options on the table

- **A:** Live-probe the installed Codex CLI's own catalog (`codex debug
  models`) on a cached server endpoint, feeding a combobox with a free-text
  fallback.
- **B:** Keep free text only, with no combobox/suggestions at all.
- **C:** Maintain a hand-curated slug list/enum in this codebase, updated
  manually as the provider ships new models.
- **D:** Do nothing further (ship #473/#474's free-text fields as final).

## Constraints that are not negotiable

- Server-side request validation (`CODEX_MODEL_SLUG_PATTERN`) cannot
  change or be bypassed — it is the actual trust boundary; any UI catalog
  is a convenience layered on top of it, never a replacement for it.
- The webui must never spawn a Claude/Codex *session* process directly
  (CLAUDE.md rule 1) — not applicable here in the launch sense, but the
  probe itself must stay a bounded, timeout-capped, argument-fixed
  `execFile` call, never a shell-interpreted command building on
  user-controlled input (mirrors the existing readiness probe's own
  security posture).
