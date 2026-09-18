# Codex model-tier parameterization

**Run ID:** `iterate-2026-09-17-codex-model-tier-parameterization`
**Complexity:** medium (overridden from `small` — see Complexity Override below)
**Intent:** FEATURE
**Source:** `Spec/codex-model-tier-parameterization.md` (monorepo, gitignored local
planning doc) — follow-up to trg-517157fe / shipwright-webui#470.

## Complexity Override

Stage-1 keyword/history classification returned `small`. Overridden to
`medium` because the source planning doc lists five explicitly unresolved
design questions (model catalog, axis shape, AGENTS.md-branch plumbing,
persistence model, component boundary) spanning `client/` schema + two
`server/` prompt-composition branches, and needs a live-CLI confirmation
test per the spec's own AC2. `small` would skip the iterate spec, mini-plan,
and external plan review — none of which this change can safely skip given
the ambiguity was still open at hand-off.

## Motivation

Sven, live session 2026-09-17: toggling a task's Runtime between Claude and
Codex should show "the right models" each way — parity with Claude's
existing `review-model`/`plan-review-model` dropdowns, not just those
dropdowns disappearing for Codex (which is what #470 shipped, deliberately,
as the honest v1 stopgap).

## What #470 shipped and why it stopped there

`ModelTierOverrideFields` now returns `null` when `task.runtime === "codex"`
(`client/src/components/external/NewIssueModal/ModelTierOverrideFields.tsx:45`).
Verified against the real code: `--review-model`/`--plan-review-model` are
Claude-CLI-only flags (`server/src/config/default-actions.json:62-63`,
enum `opus/sonnet/haiku/inherit`), resolved generically by
`resolveParameters()` (`server/src/core/parameter-resolver.ts`) into
`ResolvedParam[]`, substituted into the Claude command template by
`applyActionSubstitutionBranch` (`server/src/external/launch/action-substitution-branch.ts`).

**Confirmed by re-reading the launch pipeline in this session:**
`applyRuntimeChokepoint` (`server/src/external/launch/runtime-chokepoint.ts:170`)
runs strictly AFTER `applyActionSubstitutionBranch` in `routes.ts` and, for
any `runtime === "codex"` task, unconditionally REPLACES `commands` with
`buildCodexCommands(...)` — which takes only
`{cwd, autonomy, resume, threadId, phase, description, hasAgentsMd}`. So even
before #470, any `review-model`/`plan-review-model` value a user picked for a
Codex task was already being silently discarded at the chokepoint, not just
displayed-but-ignored — #470 closed the *visible* leak (a control that looked
live but wasn't), not a previously-working path.

`buildCodexPrompt` (`server/src/core/launcher-codex.ts:121`) emits the model
pins as a **hardcoded prose sentence** — "Use gpt-5.6-terra with high
reasoning for ordinary implementation and finalization, and gpt-5.6-sol with
high reasoning for required review subagents" — but **only when
`!hasAgentsMd`**. When `AGENTS.md` exists (both `shipwright` and
`shipwright-webui` do — see `AGENTS.md:49-56` "Codex operating policy"),
`buildCodexPrompt` skips those lines entirely and the pins live solely in
that file's own prose.

## Revision after external plan review (2026-09-17)

`external_review.py --mode iterate` (openai leg; glm errored — "openai
package not installed" — one opinion is the gate's accepted minimum) returned
`SHIPWRIGHT_VERDICT: revise` with one HIGH and five MEDIUM findings. Verified
each against the real system rather than accepting or dismissing on the text
alone, then revised:

- **HIGH — review-model override cannot be verified, so it can't be presented
  as parity.** Confirmed empirically in this session: `codex exec --json`'s
  event stream carries no `model` field anywhere (`thread.started`,
  `turn.started`, `item.completed`, `turn.completed` — none), and the
  session's own self-report is unreliable even for its OWN top-level model
  (asked twice, got two different, both-wrong answers: `"gpt-5.6"` and
  `"gpt-5"`, never the actual configured slug). There is no external signal
  to confirm an internal review-subagent actually used a requested model.
  Shipping a control that cannot be confirmed live would repeat the exact
  failure #470 fixed — visible-but-inert. **Decision: drop the review-model
  override from this iterate's scope entirely.** Only the
  implementation-model override ships (see below, it structurally is
  verifiable). Documented as a known limitation in Non-goals, not silently
  dropped — this directly follows the reviewer's own suggested fallback.
- **MEDIUM — `reasoningEffort` under-designed.** Decision: keep it (AGENTS.md's
  own pins already pair model + reasoning level — "gpt-5.6-terra with high
  reasoning" — so it's a real, load-bearing second axis, not an afterthought),
  but design it as a proper second closed-enum control from the start, not an
  untyped add-on — see Scope.
- **MEDIUM — form-submission path untraced.** Added as an explicit,
  first-class step in the mini-plan (not an aside) with its own integration
  test, per the reviewer's suggestion.
- **MEDIUM — must verify across every `buildCodexCommands` command shape
  (fresh vs. resume), not just one.** Added to AC2 and to the mini-plan's
  unit-test matrix.
- **MEDIUM — "Default" label misleads (reads as the effective runtime
  default; it's actually AGENTS.md's stated policy, not a queried value).**
  Relabeled to "Suggested policy (AGENTS.md)" in the client scope below.
- **MEDIUM — needs strict server-side validation + safe command
  construction for both fields.** Already planned (closed-enum check in
  `parse-body.ts`); made explicit that `renderCodex` reuses the existing
  `q()` shell-quoting helper for the flag value, never manual interpolation.

## Architecture Review (2026-09-17, `--mode architecture`)

`external_review.py --mode architecture` over a brief (not the plan — see
`.shipwright/planning/iterate/iterate-2026-09-17-codex-model-tier-parameterization/architecture_brief.md`)
asked whether this should be built at all. openai leg answered
**"Yes ... but its smallest durable form is a model selector only"**
(`SHIPWRIGHT_VERDICT: revise`; glm errored, same as the plan-review call).
One MEDIUM finding: the reasoning-effort selector is a second permanent
compatibility matrix (model availability × supported effort levels ×
duplicated validation × UI explanation) for a problem statement that was
only ever "pick the right model". **Accepted — reasoning-effort dropped
from scope entirely.** This iterate ships the implementation-model override
only; Codex's own default reasoning behavior per model (or AGENTS.md's
existing "with high reasoning" guidance) is untouched. All references to a
`reasoningEffort` control below are removed accordingly — see the
"Revision" section for the review-model cut, and this note for the
reasoning-effort cut. Two independent review passes, two independent scope
reductions, same session — both applied before any code was written.

## Design questions — resolved

### 1. Actual Codex model catalog (confirmed against the live CLI)

`codex debug models` (installed CLI: `codex-cli 0.147.0`) was run live in
this session. User-selectable models (`"visibility":"list"`):

| slug | display name | default reasoning | supported reasoning levels |
|---|---|---|---|
| `gpt-5.6-sol` | GPT-5.6-Sol | low | low, medium, high, xhigh, max, ultra |
| `gpt-5.6-terra` | GPT-5.6-Terra | medium | low, medium, high, xhigh, max, ultra |
| `gpt-5.6-luna` | GPT-5.6-Luna | medium | low, medium, high, xhigh, max |
| `gpt-5.5` | GPT-5.5 | medium | low, medium, high, xhigh |

(`gpt-reserve` and `codex-auto-review` exist in the catalog but are
`"visibility":"hide"` — internal/reserved, excluded from the picker.)
AGENTS.md's two named pins (`gpt-5.6-terra`, `gpt-5.6-sol`) are both
confirmed live, valid slugs — not stale prose. `~/.codex/config.toml` on
this machine independently confirms `model = "gpt-5.6-terra"` and
`model_reasoning_effort = "high"` as the active local defaults, and lists
`"gpt-5.6-sol" = 2` under `[tui.model_availability_nux]` (a second
independent sighting of that slug in live config, not just AGENTS.md prose).

**Enum for the new control:** the four `"visibility":"list"` slugs, mirroring
ADR-127's closed-enum decision on the Claude side (no free-text field, per
the spec's own Non-goal).

### 2. One role or two — role-based, not tier-based

Confirmed via `codex --help` / `codex exec --help` / `codex review --help`:
there is no CLI-level "review subagent model" flag — `-m/--model` (or
`-c model=`) sets the model for the **whole top-level Codex session**, and
"review subagents" is an internal-to-the-agent concept AGENTS.md's prose
addresses, with no CLI parameter of its own (structurally the same shape as
Claude's own CLAUDE.md review-cascade instruction, which is also prose —
`--review-model`/`--plan-review-model` are a different, Claude-CLI-specific
mechanism that has no Codex analog).

**Decision (revised after external review — see "Revision" section above):
ONE picker pair, not two.** Only the **implementation model** ships as a real
override in this iterate — model + reasoning-effort, structurally settable
via a real CLI flag (see design question 3) and therefore verifiable. The
**review-model** axis (what AGENTS.md's prose asks Codex to use for its own
internal review subagents) is NOT built as a control here: there is no CLI
mechanism for it, and — confirmed empirically — no external signal exists to
verify it took effect even if injected as prose. Building an unverifiable
control would reproduce the exact "looks live, does nothing" failure #470
existed to fix, one layer deeper. This is a genuine, reviewed scope
narrowing from the spec's original ask, not an oversight — see Non-goals.

### 3. Where the override plumbs to, given the `hasAgentsMd` branch

**New finding, not anticipated by the source spec:** `codex`/`codex exec`
expose a real `-c model=<slug>` / `-c model_reasoning_effort=<level>` config
override (`-c, --config <key=value>`, TOML-typed). This is a **structured
CLI flag**, not prose — it is layered on top of `~/.codex/config.toml` and
any project-level config *before* Codex ever reads `AGENTS.md`, so it is
reliable across both the `hasAgentsMd` and `!hasAgentsMd` branches without
depending on Codex's own instruction-following.

**Decision (revised — implementation-model only, see above):** append
`-c model="<slug>"` and (when the user picked a level) `-c
model_reasoning_effort="<level>"` to the `codex`/`codex exec` command in
`buildCodexCommands` (`launcher-codex.ts`'s `renderCodex`), unconditional on
`hasAgentsMd` — a CLI flag, evaluated by Codex before AGENTS.md is even read,
and structurally reliable regardless of Codex's own instruction-following.
No prose injection needed for this axis, so `buildCodexPrompt` itself is
unchanged. The rejected alternative (amending `AGENTS.md` at launch time)
stays rejected, unchanged from the spec — mutates a file the operator didn't
ask to change, already rejected by `codex-light-webui.md` §2.3. The
review-model axis (prose-injection) is dropped from scope entirely — see
"Revision after external plan review" above and Non-goals.

### 4. Persistence model — ephemeral, same as Claude's

**Decision:** the override follows Claude's existing pattern — a
`paramValues` entry, "only for this session" (not stored on `task`). This is
the same UI hint text `ModelTierOverrideFields` already renders
(`hint="only for this session"`), kept identical for the Codex branch so the
two runtimes read consistently side by side. `task.runtime` itself stays the
one thing that's immutable per task; the model choice within that runtime
stays session-scoped, same as Claude's tiers today.

### 5. Component boundary — extend, don't fork

**Decision:** extend `ModelTierOverrideFields` with a Codex branch (the
spec's own "mirroring how it already branches on `runtime` to return null"
option) rather than a sibling `CodexModelOverrideFields`. The component
already owns the "More options" slot and the `runtime` prop; a second
sibling component would need its own slot wiring in `NewIterateModal.tsx`
for zero benefit — the two branches render structurally different `<select>`
sets but share the slot, the "only for this session" hint, and the
project-default status line pattern.

## Scope

### Server (`server/src/`)

- `core/launcher-codex.ts`: `CodexLaunchArgs` gains
  `implementationModel?: string` (one of the four confirmed catalog slugs —
  **reasoning effort dropped from scope**, see "Architecture Review" above).
  `renderCodex` appends `-c model="<slug>"` — the value passed through the
  existing `q()` shell-quoting helper (`shell-quote.ts`), never manually
  interpolated. Applies identically to both the fresh-launch and `resume`
  branches of `renderCodex` — both must be covered by the unit-test matrix
  (AC2). Codex's own default reasoning-effort behavior per model, and
  AGENTS.md's existing "with high reasoning" guidance, are untouched.
- `external/launch/runtime-chokepoint.ts`: reads the new override value off
  `parsed` (new `ParsedLaunchBody` field, see below) and passes it into
  `buildCodexCommands`.
- `external/launch/parse-body.ts`: one new optional field on
  `ParsedLaunchBody` — `codexImplementationModel: string` — validated
  against the confirmed four-slug closed enum, same rejection posture as the
  existing Claude tier fields (unknown value → 400, not silently dropped).
- **Decided (re-reading `parameter-resolver.ts` + `actions-schema-validator.ts`
  in this session):** do NOT route the Codex overrides through
  `resolveParameters()`/`default-actions.json`. That pipeline exists to
  produce `ResolvedParam[]` for `substitutePlaceholders()` — a *Claude*
  `command_template` concern. Its enum path (`parameter-resolver.ts:247-254`)
  silently resolves to `{ok: true, value: undefined}` (flag skipped) whenever
  neither `cli_flag` nor a matching `cli_flag_map` entry exists, which would
  make the Codex selection validate successfully and then vanish — precisely
  the #470 bug class, reintroduced one layer deeper. `applyRuntimeChokepoint`
  already fully discards `applyActionSubstitutionBranch`'s output for any
  Codex task (confirmed above), so plumbing through that pipeline buys
  nothing and risks this exact silent-drop failure mode.
  **Instead:** one new optional field on `ParsedLaunchBody`
  (`codexImplementationModel`), validated by a small dedicated closed-enum
  check (the four confirmed catalog slugs) in
  `parse-body.ts`, read directly by `runtime-chokepoint.ts` and passed into
  `buildCodexCommands`. No `server/src/types/` mirror entry is needed for
  this field (it's launch-body-internal, not part of the cross-package
  action-schema shape DO-NOT #7 guards) — confirm this against
  `action-schema-sync.test.ts` during build.

### Client (`client/src/`)

- `components/external/NewIssueModal/ModelTierOverrideFields.tsx`: add a
  `runtime === "codex"` branch rendering one select — Implementation model
  (the four catalog slugs) — instead of returning `null`. Reuses
  `FieldLabel` and the `"only for this session"` hint.
- **Decided:** since the Codex overrides are NOT part of the action-schema
  parameters (see server decision above), `modelTierOverrideSchema.ts` is
  untouched — Codex's enum is a small local constant (the four confirmed
  catalog slugs) in `ModelTierOverrideFields.tsx` itself, not
  schema-supplied. This is a deliberate, scoped exception to DO-NOT #11's
  spirit (avoid hardcoding things the server already knows): there is no
  live-catalog-serving endpoint today (AGENTS.md line 54 explicitly says the
  existing project-config file is Claude-only), and building one is a
  reasonable follow-up but out of scope here — see Mini-Plan Alternative B.
- **Storage decided:** reuse the existing generic `paramValues`/
  `setParamValues` props `ModelTierOverrideFields` already receives (no new
  state slice, no new prop threaded through `useNewIssueForm.ts`'s
  three-way split), under a reserved key
  (`"codex-implementation-model"`) that no server-supplied action-schema
  field name can collide with. `useNewIssueFormSubmit.ts` reads that key
  DIRECTLY when `runtime === "codex"` (not via `explicitParamEntries`,
  which iterates `currentSchema` and would never see it) and sets it on
  `body.codexImplementationModel` — the one new top-level launch-body field.
- Project-default status line: Claude's version reads
  `useModelTierConfig` → `shipwright_model_config.json`. Codex has no
  structured per-project config (AGENTS.md is prose, and the file itself
  says at line 54 "do not reinterpret ... as Codex model names"). The Codex
  branch's status line shows the confirmed pin as static text — **"Suggested
  policy (AGENTS.md) — gpt-5.6-terra"**, not "Default" (per
  the external review finding: this is AGENTS.md's stated policy, not a
  queried effective default, and mislabeling it that way overstates what's
  actually known). Not a live query — there is nothing live to query for a
  Codex project.

## Acceptance Criteria (refined from the spec's draft, then revised post-review)

1. Toggling Runtime to Codex shows the Implementation-model select in
   `ModelTierOverrideFields`'s existing slot; toggling back to Claude shows
   the unchanged opus/sonnet/haiku/inherit control.
2. A selected Codex implementation-model value reaches the launched command
   as a real `-c model=` flag — verified by (a) unit tests asserting the
   composed command string for BOTH the fresh-launch and `resume` branches
   of `renderCodex`,
   and (b) one live `codex exec` smoke invocation confirming the flags are
   accepted without error (not asserting an exact self-reported model name —
   confirmed in this session that Codex's own self-report is unreliable;
   the confirmable claim is "the flag is valid and accepted", matching what
   `-c` config overrides are designed to guarantee structurally).
   **(b) confirmed 2026-09-18:** `codex exec -c model="gpt-5.6-luna"
   --sandbox read-only --skip-git-repo-check --cd <scratch> "Reply with
   exactly: OK"` against codex-cli 0.147.0 — exit 0, banner reported `model:
   gpt-5.6-luna` (the requested override, not the AGENTS.md default
   `gpt-5.6-terra`), reply `OK`. The flag is accepted and honored.
3. No behavior change for a Claude-runtime task (existing
   `ModelTierOverrideFields` Claude branch, `applyActionSubstitutionBranch`,
   and `runtime-chokepoint.ts`'s Claude passthrough are all byte-identical).
4. No behavior change for a Codex task that does NOT set the override —
   `buildCodexPrompt`'s existing hardcoded-prose / AGENTS.md-branch logic is
   completely unchanged (this iterate touches `renderCodex`'s flag
   composition only, never `buildCodexPrompt`).

## Non-goals (revised post-review; review-model added here, was in-scope pre-review)

- Runtime selection, launch mechanics, resume/lifecycle, completion
  detection.
- A free-text/arbitrary model string field.
- A structured per-project Codex model-config file (AGENTS.md prose stays
  the project-level default; this change only adds a session-scoped
  override on top of it).
- **A review-model override control.** Dropped after external plan review:
  confirmed empirically that no external signal exists to verify Codex's
  internal review subagents actually honor a requested model (no `model`
  field anywhere in `codex exec --json`'s event stream; the session's own
  self-report of even its OWN top-level model was wrong in two different
  ways across two live test calls). Shipping this would be an unverifiable
  control presented as parity — the exact failure class #470 fixed.
  AGENTS.md's existing prose guidance for review subagents is unchanged and
  untouched by this iterate. A future iterate could revisit this if Codex
  ever exposes an observable signal for subagent model selection.

## Confidence Calibration

*(populated at Step 7.5, before F0 — placeholder during spec authoring)*

- **Boundaries touched:** `touches_io_boundary`? — re-evaluate at Repo Scout
  against the actual diff (composed CLI command strings + prompt text are
  boundary-adjacent but not `.env*`/`hooks.json`-shaped).
- **Empirical probes run:** `codex debug models` (live catalog), `codex
  --help`/`codex exec --help`/`codex review --help` (confirmed no
  per-subagent model flag exists), `~/.codex/config.toml` read (independent
  confirmation of both pinned slugs). AC2(b) live `codex exec -c
  model="gpt-5.6-luna"` smoke invocation, 2026-09-18 — exit 0, banner
  confirmed the override model, see AC2 for the full command/output.
- **Test Completeness Ledger:** server (44) + client (15) unit/component
  tests for the touched files pass as of 2026-09-18. `client/e2e/flows/
  runtime-toggle-codex.spec.ts` exercises the Codex runtime toggle but only
  in the plain task-creation modal (no "more options"/parameters step, so
  it never reaches `ModelTierOverrideFields`) — confirmed by reading it, not
  assumed; it needs no update. No other E2E spec reaches the Implementation-
  model select, so mini-plan step 8's "if touched" condition doesn't fire.
- **Confidence-pattern check:** to be filled at Step 7.5.
