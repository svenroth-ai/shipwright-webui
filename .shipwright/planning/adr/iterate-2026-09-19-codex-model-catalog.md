# Live Codex model catalog for the New Iterate launch form

## Context

Follow-up to PR #473/#474 (session-scoped Codex Plan review / Review free-text
override fields) and the dismissed trg-be9df375 (Implementation-model removal
proposal, now superseded). User feedback (2026-09-19): the three Codex model
fields in the New Iterate "More options" panel were blind free-text inputs
with no feedback on whether a typed slug is real until launch fails — but a
hardcoded model-slug enum would need a PR every time OpenAI ships a new Codex
model. "Neither is acceptable."

A pre-session spike established, empirically:
- `codex debug models` (installed CLI v0.155.0) returns clean JSON in ~0.65s.
- Its `visibility` field ("list" vs "hide") cleanly separates user-offerable
  models from internal/reserved ones (e.g. `codex-auto-review`).
- The CLI's own catalog moves faster than this repo's hand-maintained
  AGENTS.md would.
- `--bundled` (skip-refresh) returns a visibly OLDER catalog than the default
  refreshing invocation — confirmed by diffing both outputs.
- `codex debug models` requires NO authentication (re-ran with an empty
  `CODEX_HOME`, no `auth.json` — still exited 0 with the full catalog).

## Decision

Add a server-side probe + route (`core/codex-models-probe.ts` +
`routes/codex-models.ts`) that shells out to `codex debug models` via the
existing `defaultRunShim` win32-`.cmd`-shim pattern (`core/readiness-probe-run.ts`,
already used for the `codex --version` readiness check), filters to
`visibility === "list"` entries whose `slug` passes the existing
`CODEX_MODEL_SLUG_PATTERN`, and returns `{slug, display_name}` pairs. The
route wraps this in a two-tier in-memory TTL cache (5 min success / 30s
failure) with in-flight-promise coalescing, and always returns HTTP 200
(`status: "ok" | "stale" | "unavailable"`) — the endpoint never blocks or
fails the launch form.

Client-side, `ModelTierOverrideFields.tsx`'s three Codex model fields
(Implementation model, Plan review, Review) become comboboxes: a native
`<input list>` + shared `<datalist>` (id scoped via `useId()`) populated from
the endpoint, with the existing free-text input always still accepting a
custom/unlisted slug. Server-side `CODEX_MODEL_SLUG_PATTERN` validation is
unchanged and independent of catalog reachability. Implementation model keeps
its existing `-c model=` launch wiring.

## Consequences

- New global (not project-scoped) read surface `GET /api/codex-models`,
  no new persisted state (in-memory cache only, lost on server restart).
- The launch form's model suggestions now track whatever Codex CLI version is
  installed on the server host, rather than a maintained-by-hand list — a
  future new Codex model appears in the combobox with zero webui changes.
- A per-request cost bounded by the two-tier TTL: at most one `codex debug
  models` subprocess spawn per 5 minutes on success, or once per 30 seconds
  while the probe is failing (never once-per-request).
- Free text remains always accepted, so the feature degrades to today's
  behavior (blind free text) whenever `codex` is missing, unauthenticated (a
  no-op per the auth finding above), or its output is unparseable.

## Rationale

Native `<datalist>` was chosen over a Radix/headless combobox library:
zero new dependencies, and "always allow free text" is the default browser
behavior for `<input list>` — no extra logic needed to keep the field
editable past its suggestions. `defaultRunShim` (not `defaultRun`) is reused
because `codex` on Windows installs as a `.cmd` PATHEXT shim with no
`codex.exe`, and `execFile(cmd, args, {shell:false})` cannot invoke a `.cmd`
directly (Node's CVE-2024-27980 hardening) — this module already solved that
problem for the pre-existing `codex --version` readiness probe.

## Rejected Alternatives

1. **Hardcoded model-slug enum** (the status quo before PR #473, and the
   subject of the withdrawn shipwright#771 proposal) — rejected per the
   explicit user feedback: needs a PR every time OpenAI ships a new model,
   and this repo's own historical enum was already observed drifting behind
   the CLI's real catalog.
2. **Blind free text with no suggestions** (PR #473's shipped state) —
   rejected: no feedback on a typo'd slug until launch fails, the exact
   complaint this iterate answers.
3. **Disk-caching the catalog** (e.g. writing it to a project or user config
   file) — rejected: the in-memory TTL cache is simpler, requires no new
   write surface or migration, and the catalog is cheap enough to re-probe
   every 5 minutes; a stale-on-disk catalog would also silently outlive a
   `codex` CLI upgrade on the host.
4. **A Radix/headless combobox component** — rejected in favor of native
   `<input list>` + `<datalist>`: zero new dependencies, and free-text
   fallback is the platform default rather than something to reimplement.
5. **Grafting this onto the existing `/api/readiness` endpoint's cache** —
   rejected during Architecture Review (glm reviewer): would couple two
   probes with materially different freshness/degradation semantics (a
   readiness gate vs. a launch-form suggestion source) onto one cache
   lifetime.

## Review Cascade Summary

- **Architecture Review**: contradictory verdicts (glm=approve, openai=reject
  on whether to build the live-catalog endpoint at all, vs. a simpler
  static-refresh alternative). Per the architecture-review protocol's
  explicit STOP-and-ask rule (a hard override even under `--autonomous`), the
  operator was asked directly and selected "build the dropdown as planned."
- **External Plan Review (Branch A)**: 12 findings across both reviewers;
  highest-severity was a conditional-hook rules-of-hooks violation in the
  original mini-plan draft (`useCodexModels()` called inside a conditional
  branch) — fixed before Build by calling the hook unconditionally and
  gating only the fetch (`enabled: runtime === "codex"`). Other fixes:
  per-entry catalog defensiveness, a separate shorter failure-TTL (bounding
  retry cost against a persistently broken probe), server-side slug
  pre-filtering through `CODEX_MODEL_SLUG_PATTERN` before suggestions reach
  the client, `useId()`-scoped datalist id (fixing a shared hardcoded id that
  would collide across multiple mounts), halved client `staleTime` relative
  to the server TTL (avoiding a ~10-minute-old worst case), and E2E
  route-interception tests independent of whether the CI/dev machine has the
  real Codex CLI installed.
- **Internal cascade** (spec-reviewer → code-reviewer → doubt-reviewer): all
  PASS. code-reviewer's one finding (the shared `readiness-probe-run.ts`
  `ok` heuristic, written for `--version` probes, could false-negative a real
  catalog containing no dotted-version slug) was fixed by gating on
  `result.code === 0` instead, local to this probe, no shared-module change.
  doubt-reviewer raised three findings: a duplicate-slug de-dup gap (fixed),
  an untested client/server regex-mirror drift risk (fixed with a new
  cross-workspace sync test), and a possible Windows orphaned-process leak on
  a hung probe (accepted as pre-existing shared infrastructure risk in
  `defaultRunShim`/`win32-spawn.ts`, not introduced by this iterate — see the
  iterate spec's "Doubt Review (Stage 3)" section for the full writeup).
- **External Code Review (cascade, Branch A)**: both `glm` and `openai` legs
  returned `revise` (agreeing verdicts, no contradiction). Two medium-severity
  bugs fixed: the route's `probe()` call and the probe's own `run(...)` await
  both lacked a `.catch()`/`try-catch`, so a rejecting promise would 500 the
  endpoint instead of degrading to the required HTTP 200 contract — both
  fixed with regression tests. One medium finding fixed: the E2E spec used
  React 18's `useId()` output (contains colons) as a raw unescaped CSS id
  selector, which would throw at runtime — switched to an attribute selector.
  Two low findings accepted as-is (unbounded staleness-age signal to the
  client; one test's lack of an independent negative control) per the
  reviewer's own "acceptable, not blocking" assessment. See the iterate
  spec's "External Code Review" section for the full findings table.

## Verification

Server unit tests: 22 across `codex-models-probe.test.ts`,
`codex-models.test.ts`, and the new `codex-slug-pattern-client-sync.test.ts`
drift guard — all passing. Full server suite (4376 tests) and full client
suite (4278 tests) green at F0, both `tsc --noEmit` clean, lint clean (only
pre-existing warnings, none in touched files). F0.5 web-surface E2E:
`node client/e2e/isolated-stack.mjs client/e2e/flows/model-tier-defaults.spec.ts
--project=chromium --reporter=line` — 4/4 passing (`exit_code: 0`).
