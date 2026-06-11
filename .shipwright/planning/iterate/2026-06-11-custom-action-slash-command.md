# Iterate Spec — Custom-action `slash_command` for `{task.initial_prompt}`

- **run_id:** `iterate-2026-06-11-custom-action-slash-command`
- **Intent:** FEATURE · **Complexity:** medium (history-calibrated) · **Risk flags:** none
- **Spec Impact:** ADD (new optional action-schema field + new substitution capability)
- **Date:** 2026-06-11

## Problem

Custom actions in `<project>/.shipwright-webui/actions.json` cannot inject the
task **description** into a slash-command prompt as a single CLI argument.

- The `{task.description?}` placeholder emits the description as a **separate,
  independently shell-quoted positional argument** appended after the slash
  command. Example template `… /content-creator{task.description?}` →
  `claude … /content-creator 'desc'` = **two** positional tokens.
- The Claude CLI accepts exactly **one** `[prompt]` positional
  (`Usage: claude [options] [command] [prompt]`). The first token
  (`/content-creator`) becomes the prompt; the second token (the description)
  is a surplus positional and is **silently dropped**. The skill runs with no
  arguments → the brief is lost.
- The bundled actions avoid this with `{task.initial_prompt}`, which fuses
  slash + autonomy + params + description into **one** shell-quoted argument.
  But `buildSlashCommand()` hardcodes that placeholder to the three bundled
  ids (`new-task` / `new-iterate` / `new-pipeline`) and throws
  `UnknownActionError` for any custom id. So custom actions have **no clean
  path** to a fused prompt.
- Secondary failure: `GET /api/external/projects/:id/actions` dry-runs every
  template (`get.ts` → `dryRunTemplate`). A custom action using
  `{task.initial_prompt}` makes `buildSlashCommand` throw → `dryRunTemplate`
  re-throws (not an `InvalidPlaceholderError`/`UnknownPhaseError`) → the route
  returns **500** and the whole actions config fails to load.

## Goal / Acceptance Criteria

- **AC-1** A custom action MAY declare an optional top-level
  `slash_command` string (e.g. `"/content-orchestrator"`).
- **AC-2** With `slash_command` set and template using `{task.initial_prompt}`,
  substitution for a **non-builtin** actionId fuses slash + (autonomy) +
  (params) + flattened description into **one** shell-quoted positional in all
  three shell forms. For `slash_command="/content-orchestrator"` +
  description `"Erstelle Artikel"`:
  - posix → `'/content-orchestrator Erstelle Artikel'`
  - powershell → `'/content-orchestrator Erstelle Artikel'`
  - cmd → `"/content-orchestrator Erstelle Artikel"`
- **AC-3** Builtin behavior is **unchanged**: `new-task` / `new-iterate` /
  `new-pipeline` keep their hardcoded slash mapping and ignore any
  `slash_command` (builtins win).
- **AC-4** Per-shell escaping is preserved end-to-end (the existing `q()`
  wrapping the whole `inner` prompt is the single escape point; no
  double-escaping).
- **AC-5 (fail-loud at load, per user decision):** `validateActionsSchema`
  rejects, with a clear code:
  - `missing_slash_command` — a non-builtin action whose template contains
    `{task.initial_prompt}` but has no (or empty) `slash_command`.
  - `invalid_slash_command` — `slash_command` present but not matching
    `SLASH_COMMAND_PATTERN` (`/^\/[A-Za-z][A-Za-z0-9:_-]*$/`).
  Both surface as `GET /actions` / upload **400** (not 500).
- **AC-6** `GET /actions` dry-run no longer 500s for a well-formed custom
  action using `{task.initial_prompt}` (dry-run gets the action's
  `slash_command`).
- **AC-7** Existing `{task.description?}` (new-plain style, description-as-whole-
  prompt) behavior is **unchanged** — no regression.
- **AC-8** An uploaded/edited config round-trips `slash_command` (the upload
  re-serializes parsed JSON via `JSON.stringify`, which preserves the field
  regardless of TS types). The client `ActionDefinition` deliberately does NOT
  add the field — the client never reads it (server is sole substituter) and
  mirroring would ratchet the already-oversized `externalApi.ts`.

## Out of scope

- No change to `{task.description?}` semantics.
- No new UI field in the New-Task modal (slash_command is config-authored, not
  user-input per task).
- Auto-rewriting the user's content-marketing `actions.json` (delivered as an
  artifact; applied post-deploy).

## Affected Boundaries

- `.shipwright-webui/actions.json` parse boundary (`project-actions-loader.ts`
  `ActionDefinition`) — **new optional field**.
- Command-template substitution (`actions-substitute.ts`) — the documented
  **security boundary** for shell-command generation. Change reuses the
  existing per-shell escapers; the new value (`slash_command`) is a
  server-config literal routed through the same `q()` wrap as the existing
  hardcoded builtin slashes.
- Schema validation (`actions-schema-validator.ts`) — two new error codes.
- Launch route substitution branch (`action-substitution-branch.ts`) and
  actions GET dry-run (`actions/_helpers.ts` + `actions/get.ts`).

## Self-Review (Step 7)
1. **Solves the stated problem?** Yes — custom action + `slash_command` +
   `{task.initial_prompt}` fuses slash+brief into one positional (verified
   unit + integration).
2. **YAGNI?** One optional field + one fallback branch + two validator codes.
   No speculative surface (no new UI, no new placeholder).
3. **Reuses existing patterns?** Yes — reuses the existing `q()` escape wrap
   and the `{task.initial_prompt}` fusion path; SSoT set shared with validator.
4. **Tests cover happy + error paths?** Yes — fusion (happy) + missing/invalid
   slash_command + UnknownActionError backstop (error).
5. **No security regression?** `slash_command` is a server-config literal
   routed through the same `q()` wrap as the hardcoded builtin slashes;
   `SLASH_COMMAND_PATTERN` rejects garbage at load time. No new escape path.
6. **Files ≤300 LOC / no bloat ratchet?** All touched files unchanged in
   structure; small additive deltas.
7. **Affected Boundaries:** actions.json parse (`ActionDefinition`),
   command-template substitution (security boundary), schema validation,
   launch substitution branch, actions GET dry-run, client type mirror — all
   exercised by tests.

## Confidence Calibration
- **Boundaries touched:** actions.json parse/schema, command-template
  substitution (security boundary), launch substitution branch, actions GET
  dry-run, client type mirror.
- **Empirical probes run:**
  - Custom id + slash_command across all 3 shells → ONE fused positional;
    verified by `actions-substitute.test.ts` + the launch-route consumer-chain
    test `routes.slash-command.test.ts` (both forms asserted, two-positional
    regression explicitly negated).
  - `validateActionsSchema` emits `missing_slash_command` /
    `invalid_slash_command` and passes a valid custom config / builtin-exempt /
    non-initial_prompt cases — `actions-schema-validation.test.ts`.
  - `validateTemplate` (the GET /actions dry-run path) returns null for a
    custom `{task.initial_prompt}` template when slash_command supplied (was
    `UnknownActionError` → 500) — AC-6 unit test.
  - Builtin actions unaffected: full server suite 1607/1607 green; tsc 0;
    lint 0. Client tsc 0; doc-sync + action-schema-sync green.
- **Test Completeness Ledger:**

  | Behavior | Disposition | Evidence |
  |---|---|---|
  | Fuse slash+desc → 1 positional (posix/ps/cmd) | tested | actions-substitute.test.ts + routes.slash-command.test.ts |
  | Empty description → slash only, no trailing space | tested | "emits only the slash command…" |
  | Multi-line description flattened in fused token | tested | "flattens a multi-line description…" |
  | Single-quote escaped inside fused token | tested | "escapes a single-quote…" |
  | Builtin ids ignore slash_command | tested | "BUILTIN ids ignore slash_command…" |
  | Custom id w/o slash_command → UnknownActionError | tested | "throws UnknownActionError…" |
  | validateTemplate accepts custom initial_prompt + slash | tested | AC-6 test |
  | schema missing_slash_command | tested | schema test |
  | schema invalid_slash_command | tested | schema test |
  | schema valid custom passes / builtin exempt / non-IP exempt | tested | schema tests |
  | Launch route end-to-end fusion (consumer chain) | tested | routes.slash-command.test.ts |
  | Client `ActionDefinition` carries slash_command | covered-by-existing-test | client tsc + upload re-serializes parsed object via JSON.stringify (no field filtering) |

  0 untested-testable behaviors.
- **Confidence-pattern check:** asymptote (depth) — fusion reuses the
  battle-tested `q()`-wrapped initial_prompt path; special-char/quote depth
  already covered for builtins, now extended to custom. coverage (breadth) —
  3 shells × {empty, multi-line, quoted} descriptions × {builtin, custom,
  missing-slash, invalid-slash} × {substitution unit, schema, dry-run, launch
  route}.
