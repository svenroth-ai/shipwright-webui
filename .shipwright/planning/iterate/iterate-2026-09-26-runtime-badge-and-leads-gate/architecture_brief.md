# Architecture Brief: runtime-badge-and-leads-gate

## The problem

Two conditional-render bugs on the WebUI. (1) `RuntimeToggle` shows a static
"fixed to Codex/Claude" bar on every task even when Settings' `codexAvailability`
allows only one runtime — there is no per-task choice in that state, so the bar
is misleading UI with nothing to do. Its accompanying "Codex Light doesn't
support campaign..." hint repeats on every task instead of stating the posture
once. (2) The board toolbar's Claim filter toggle (a Leadwright-only feature —
`claimedBy`/`claimToken` are set exclusively by leadwright's claim-task
mechanism) always renders, even when no `~/.claude/leads/org-chart.json`
exists, unlike its sibling Bot/BellDot lead-tag filter which is already gated.

## What already exists here

- `useOrgChartPresence()` — the single source of truth for "is Leadwright
  installed", already gating the Org nav entry, the Bot/BellDot lead-tag
  filter toolbar group, and the New-issue dialog's Leadwright fields
  (iterate-2026-09-09-leadwright-gate-org-presence).
- `RuntimeToggle`'s own `availability` prop, already distinguishing "both" vs
  a single forced runtime — it just renders the wrong thing in the latter case.

## What would newly, permanently exist

Nothing. Both fixes change existing conditional-render logic in place:
`RuntimeToggle` returns `null` instead of a fixed pill when `availability !==
"both"`; `ClaimFilterToggle` gets the same `useOrgChartPresence()` gate its
sibling toolbar control already has. The Codex Light hint moves from two
per-task call sites into the existing Settings card, reworded, with no new
storage or mechanism.
