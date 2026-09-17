# Architecture Brief: Codex implementation-model override

## The problem

A task's Runtime toggle (Claude/Codex) shows a live model-tier picker for a
Claude task but nothing for a Codex task, even though Codex-driven sessions
also run under a pinned model choice today (fixed by project config or
prompt text). Sven asked for the Codex side to show a working equivalent
picker, not just have the Claude-only control disappear.

## What already exists here

- `ModelTierOverrideFields` — a Claude-only session-scoped model-tier picker
  (`opus/sonnet/haiku/inherit`), wired through `resolveParameters()` and
  `applyActionSubstitutionBranch` into `--review-model`/`--plan-review-model`
  CLI flags on the Claude launch command.
- `buildCodexPrompt`/`buildCodexCommands` — the Codex launch-command builder;
  currently takes no model parameter at all. Codex's model choice today
  comes from either `AGENTS.md` prose (when present) or a hardcoded prose
  sentence in the composed prompt (when absent).
- `runtime-chokepoint.ts` — the one place that decides Claude-vs-Codex
  command composition per task; already the natural insertion point for any
  runtime-specific launch parameter.
- Codex's own CLI (`codex`/`codex exec`) already exposes a general `-c
  key=value` config-override mechanism, independent of this project.

## What would newly, permanently exist

A per-launch, session-scoped override value (model + reasoning effort) that
flows from a new client control through the launch request body into a CLI
flag on the Codex launch command. It exists only for the duration of one
launch (not stored on the task); nothing new runs on a schedule, holds a
credential, or writes new persistent state. The thing that must be kept
correct going forward is the catalog of valid model slugs/reasoning levels
shown in the picker, matching whatever Codex's own CLI actually accepts.

## Options on the table

- **A:** Add a Codex-side override control, plumbed through a new
  runtime-chokepoint-adjacent code path (bypassing the existing Claude
  parameter-resolution pipeline).
- **B:** Route the Codex override through the existing
  `resolveParameters()`/action-schema pipeline used for Claude's tiers.
- **C:** Do nothing further — leave the Codex picker hidden (current
  shipped state, shipwright-webui#470).
- **D:** Build a live server endpoint that queries Codex's own CLI for its
  current model catalog, rather than hardcoding the known slugs client-side.

## Constraints that are not negotiable

- Webui never spawns Codex directly (CLAUDE.md architecture rule 1, extended
  to Codex by the Codex Light spec) — any override must reach Codex only
  through the command string the user's own terminal executes.
- No cross-package imports between `client/` and `server/` (DO-NOT #7) —
  any shared enum must be mirrored, not imported.
