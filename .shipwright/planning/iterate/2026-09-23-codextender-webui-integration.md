# Iterate: Codextender WebUI integration (Part B)

- **run_id**: iterate-2026-09-23-codextender-webui-integration
- **type**: feature
- **complexity**: medium (classifier: keyword match, confidence 0.7, no risk flags, cross_split: false)
- **source spec**: `C:\01_Development\shipwright\Spec\codextender-integration.md`, Part B items 1-6
  (plus a mid-run user clarification pasted into the session, folded in below,
  and a Part B.5 update settling the datalist re-source decision)

## Scope

Wire a second Codex-integration mechanism ("Codextender" — a local LiteLLM
proxy that re-points a real `claude` process at a Codex-plan model via
`ANTHROPIC_BASE_URL`) into the WebUI, alongside the existing "Codex Light"
mechanism (real `codex` CLI as a pty TUI). Per-task Claude/Codex UX is
unchanged; only the mechanism selected by a new global setting differs.

Out of scope (Part C, monorepo-side): review-driver selection, the
`inherit`-tier answer, `review_claude_cli` env-scrubbing fix. Those land in a
separate `shipwright` monorepo iterate.

## Affected Boundaries

- `.shipwright-webui/settings.json` (via `GET/PUT /api/settings`) — new
  fields, `touches_io_boundary`.
- `sdk-sessions.json` (via `SdkSessionsStore`) — new optional task field.
- The Codextender proxy's HTTP surface (`GET /v1/models`) — a new outbound
  network boundary, probed with a short timeout, never trusted for anything
  beyond a model-slug suggestion list + an availability boolean.

## Design decisions (settled during Repo Scout, not re-litigated at build time)

1. **Three settings** on `GlobalSettings` (client + server mirrors,
   `client/src/types/settings.ts` / `server/src/types/settings.ts`):
   - `codexIntegrationMode?: "light" | "codextender"` (default `"light"`).
   - `codexAvailability?: "both" | "claude_only" | "codex_only"` (default
     `"both"`).
   - `codextenderPort?: number` (default `4000`) — new field, resolves the
     spec's own open question; needed by both the AC8 probe and the
     model-datalist source.
   - Rename `codexRuntimeDefault` → `runtimeDefault` (same type/meaning).
     Site list (verified against current repo state, not the spec's
     possibly-stale line numbers): `client/src/types/settings.ts`,
     `server/src/types/settings.ts`, `CodexSettingsCard.tsx`,
     `useNewIssueFormState.ts`, `useNewIssueForm.ts`,
     `server/src/index.ts` (triage-promote `getCodexRuntimeDefault` wiring),
     `server/src/core/settings-reader.ts`'s own doc comment,
     `CodexSettingsCard.test.tsx`, `server/src/core/settings-reader.test.ts`,
     `server/src/routes/triage.promote-runtime.test.ts`.

2. **`RuntimeToggle`** gets an `availability` prop (default `"both"`):
   renders the existing two-segment radiogroup for `"both"`; renders a
   single fixed, non-interactive label (styled like one active segment) for
   `"claude_only"` / `"codex_only"`. Every launch-surface caller
   (`useNewIssueFormState.ts`, `useEditTaskForm.ts`) auto-assigns
   `runtime`/`task.runtime` to the one allowed value with no operator choice
   when availability isn't `"both"` — `runtimeDefault` only seeds the
   on-open value when it IS `"both"`.

3. **UI hint** — when `codexIntegrationMode === "light"` and Codex is
   reachable at all (`codexAvailability` is `"both"` or `"codex_only"`), an
   advisory line under the Runtime field on every launch surface (create +
   edit) names Codex Light's AC7/AC9 campaign/pipeline restriction
   (confirmed still real for Codex Light — see decision 6 below for why it
   does NOT apply to Codextender).

4. **`launcher-codextender.ts`** — reuses the ALREADY-BUILT plain-Claude
   `CopyCommandForms` (the chokepoint's own `args.commands`, built by the
   caller in `routes.ts` the same way a Claude-runtime task always is) and
   prepends a per-shell env-var prefix (`ANTHROPIC_BASE_URL`,
   `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`, `CODEXTENDER_ACTIVE=1`,
   `CODEXTENDER_MODEL`) right after the recomputed `buildCdPrefix(shellForm,
   cwd)` (an exact-match string slice point, since `buildCdPrefix` is
   pure/exported — no regex parsing of the rendered string). **Superseded
   sub-decision, corrected during F11 PR-review preflight**: this line
   originally proposed a fixed bearer-shaped placeholder value for
   `ANTHROPIC_AUTH_TOKEN` (matching the `codextender` CLI's own README
   example) — that shape was rejected by the PR-review preflight's second
   round before ever shipping (`resolveCodextenderAuthToken()` has NO
   built-in fallback; it reads `CODEXTENDER_AUTH_TOKEN` from the environment
   only, failing closed with `codextender_auth_token_missing` when unset —
   see the ADR's Rejected-alternatives item 5). A later preflight round
   (7/8) additionally found the resolved token's literal VALUE landing in
   the visible, copyable command text (terminal scrollback exposure); fixed
   by writing it once to a private per-launch temp file and having each
   shell read it back via its own no-echo idiom (PowerShell `Get-Content`,
   cmd `set /p VAR=<file`, posix `$(cat file)`) instead of interpolating the
   value directly — see the ADR's Rejected-alternatives item 9. **Alternative
   considered and rejected**: reimplementing `launcher.ts`'s private argv
   builders inside the new module (the `launcher-codex.ts` pattern) —
   rejected because Codextender's launch target genuinely IS an ordinary
   Claude launch; duplicating session/resume/name/plugin-dir logic would
   drift from `launcher.ts`'s own fixes over time for zero benefit. Model
   alias resolves from `parsed.codexImplementationModel` (reusing the
   existing free-text field — Part A's "no closed enum" stance), defaulting
   to `"sol"` when absent.

5. **Task-level `codexIntegrationMode` stamp** (new optional field on
   `ExternalTask`, `server/src/core/sdk-sessions-store.ts`) — decided instead
   of a live settings re-read inside `ws-upgrade-handler.ts` /
   `transcript/routes.ts`. Rationale: `codexIntegrationMode` (unlike
   `runtime`, fixed at task creation) is only known for THIS session at
   *launch* time — the global setting can change later — so the ADR-309
   liveness guards (decision 6) need to ask "what did THIS session actually
   launch as", not "what does the global setting say right now". Stamped in
   `applyRuntimeChokepoint`'s `taskUpdate` at every Codex-runtime launch;
   fork inherits it verbatim from the parent (mirrors `runtime:
   parent.runtime`) rather than re-deriving from current settings. This also
   means `ws-upgrade-handler.ts` / `transcript/routes.ts` need **zero** new
   async dependencies — a synchronous field read on the already-loaded
   `task`, consistent with CLAUDE.md rule 4 (stateless transcript reads) and
   the no-chokidar/no-extra-I/O posture of the terminal WS path.

6. **Campaign/pipeline blocking** (`isCodexNewPipelineBlocked` /
   `isCodexCampaignBlocked`) — confirmed against `codex-light-webui.md`'s own
   AC7/AC9 rationale (§3.5, "Non-goals"): AC9 blocks `new-pipeline` because a
   real Codex-CLI single thread has no oracle row for multi-phase progress;
   AC7 defers campaign parity to "Codex Light 2" for the same reason (no
   app-server/thread-resume machinery). Both are Codex-CLI-specific. Under
   Codextender the driving binary is `claude` — the SAME oracle/resume
   machinery an ordinary Claude-runtime campaign/pipeline task already uses.
   **Fix**: both predicates take a new `codexIntegrationMode` parameter
   (the fresh per-launch value, NOT `task.codexIntegrationMode` — a
   first-ever Codextender launch has no persisted stamp yet) and short-circuit
   `false` when it's `"codextender"`.

7. **Model picker** (`ModelTierOverrideFields.tsx`, Part B.5, settled by a
   mid-run user clarification — supersedes the spec's own open question):
   a new server module (`codextender-models-probe.ts`, sibling of
   `codex-models-probe.ts`) does `GET http://127.0.0.1:<codextenderPort>/v1/models`
   with a short timeout (no CLI shell-out — LiteLLM already serves this).
   Same result shape reused for TWO purposes: (a) the AC8 pre-flight
   (uncached, fresh probe every launch, same posture as `isCodexCliAvailable`)
   and (b) a new cached route `/api/codextender-models` (mirrors
   `codex-models.ts`'s TTL-cache shape exactly, separate cache instance) for
   the client datalist. Client: new `getCodextenderModels()` /
   `useCodextenderModels()`, mirroring the existing Codex Light pair.
   `ModelTierOverrideFields.tsx` reads `codexIntegrationMode` from
   `useSettings()` and switches which hook's data feeds the shared
   `<datalist>` — the input fields themselves stay identical free-text
   inputs either way. Kept as `<datalist>` (never a closed `<select>`), and
   on `status !== "ok"` with an EMPTY model list (proxy unreachable — e.g. a
   backlog task created before Codextender was ever started), falls back to
   a static `sol`/`astra` suggestion pair instead of an empty list — the
   Codex Light arm's existing behavior (empty datalist + a status message)
   is intentionally NOT changed, since a Codex-CLI operator has another way
   to find real slugs (`codex debug models` themselves); a Codextender-only
   operator has none.

## Confidence Calibration

- **Boundaries touched:** settings.json (io-boundary), sdk-sessions.json,
  outbound HTTP to the local proxy.
- **Empirical probes run:** confirmed via source read (not live execution —
  no running Codextender proxy in this environment) that
  `buildCdPrefix`/`CopyCommandForms` are exported and pure, that
  `isCodexNewPipelineBlocked`/`isCodexCampaignBlocked` are keyed on
  `actionId`/campaign-intent fields (not `phase`), and that
  `codex-models.ts`'s TTL-cache shape is self-contained and copyable.
- **Test Completeness Ledger:** populated per-file at F5 (small+); every new
  branch (availability variants, mode branch, block bypass, liveness guard,
  datalist fallback) gets a unit test; the fork-path companion fix and the
  ADR-309 companion fix each get a regression test pinning the pre-fix bug.
- **Confidence-pattern check:** integration coverage n/a (`cross_component`
  not triggered — this touches ordinary route/type/component surfaces, not
  the merge/hook/pipeline-validator machinery `CROSS_COMPONENT_FILE_PATTERNS`
  lists).

## Internal Plan Review (opus-plan-reviewer)

- **Ran:** yes — but out of order: this run's complexity is medium+ and the
  pass should have run before Branch A/B/C (Step 5-int); it did not, and was
  only caught and run retroactively at F11 while resolving the deterministic
  finalization verifier's `plan_internal` review-record gap. Recorded here so
  a future run of this project doesn't mistake the ordering deviation for a
  degraded-handling case — the pass itself completed normally, just late.
  Spawned over the iterate spec alone (no mini-plan file exists for this run,
  the documented non-degraded case for a spec-only input).
- **Severity:** high (2 findings at this severity).
- **Summary:** the reviewer found two real, code-verified defects in the
  already-shipped Codextender launch path — one a credential/config leak into
  a persistent shell, one a mode-pinning gap across Resume. Both independently
  confirmed against the actual source (not taken on the reviewer's word) and
  fixed in this same F11 pass before delivery.
- **Findings:**
  - [HIGH, fixed] `launcher-codextender.ts`'s PowerShell (`$env:X = 'Y';`) and
    cmd (`set X=Y &&`) env-var prefixes mutate the embedded terminal's own
    persistent shell environment, not a scoped child process (unlike the
    posix `X=Y command` form) — `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/
    `ANTHROPIC_MODEL` silently outlive the one Codextender launch and leak
    into whatever the user types next in the same tab. Fixed by appending an
    unconditional per-shell cleanup suffix (`Remove-Item Env:...`/
    `& set X=`) after the claude invocation.
  - [HIGH, fixed] `routes.ts` re-read the `codexIntegrationMode` global
    setting fresh on every launch (including Resume of an already-running
    task) instead of pinning to the task's own previously-stamped mode. A
    global-setting flip between a task's first launch and a later Resume
    could silently switch mechanisms mid-session — e.g. a real `codex`-CLI
    thread (`task.threadId` set, no Claude JSONL) resumed under a flipped
    Codextender setting would take the Claude-resume branch instead,
    discarding that thread's history rather than erroring. Fixed by adding
    `resolveCodexIntegrationModeForLaunch()` (pure, unit-tested) and pinning
    to `task.codexIntegrationMode` once it's set.
  - [medium/low, disclosed] the reviewer raised additional medium- and
    low-severity items (design nits and defense-in-depth suggestions on the
    same launch/fork surfaces); their verbatim text did not survive this
    session's context-window compaction and is not reconstructed here rather
    than risk misattributing content to the reviewer. None were reported at
    high severity, so none trip the "declined/disclosed high" stop-gate.
    Disclosed as a known limitation below rather than re-spawning the review.
- **Known limitations:** the medium/low findings above were not individually
  re-triaged in this pass (text not retained) — worth a fresh, dedicated
  `opus-plan-reviewer` pass in a follow-up iterate if the operator wants full
  closure on them; nothing at that severity blocks this delivery.
- **Status:** 2 fixed, 6 medium + 3 low disclosed (untriaged this session per
  the limitation above).

## Open questions carried forward (not resolved here, per spec)

- Per-role independent Codex-model selection for reviews (Part C, deferred).
- `review_claude_cli` env-scrubbing fix (Part C, its own small monorepo fix).
- Windows-autostart health badge in the WebUI — stays deferred (Part A/open
  questions), not built here.
- `codex_only` + CLI/proxy genuinely unavailable at every launch — this
  iterate ships AC8's existing per-launch block (actionable message) for
  both mechanisms; an earlier Settings-page warning is left as a follow-up,
  not required for the stated goal.
