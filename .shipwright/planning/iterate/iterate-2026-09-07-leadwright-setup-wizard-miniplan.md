# Mini-Plan: leadwright lead-setup Intent Wizard

## Chosen approach

Mirror the existing `IntentWizard` idiom (question-left, live `FlightPlanRail`
right) with a **new, sibling reducer/component tree**
(`LeadSetupWizard/`) rather than extending the existing one — the existing
reducer/types are hardcoded to an unrelated `new|adopt|grade` door domain.
The genuinely generic pieces (`FlightPlanRail`, `StepDots`, `WzPrimary`/
`WzOutline`, the `.wz-*` CSS classes) are imported and reused verbatim, so
nothing about the *idiom* forks — only the domain-specific reducer, screens,
and verdict-transport hook are new.

Server side: four new routes under the existing `/api/external/org/*`
mount (verdict transport, add-lead, add-daemon-config-entries, domain
vocabulary), one new generic lock module copied from `decisions-lock.ts`'s
shape (that module is hardcoded to the decisions files, so a literal reuse
isn't possible — a structural copy is), one new pure subprocess-transport
module reusing the *existing* `resolveSpawn` Windows-safe spawn helper
(`core/win32-spawn.ts`) rather than writing a second spawn primitive, and two
vendored JSON schemas with a test-time fidelity check (mirroring
`claim-record-lock-contract.json`'s pattern) rather than a new runtime
JSON-Schema-validator dependency.

The wizard writes org-chart.json and daemon-config.json itself, sequentially,
only after the verdict route reports `ok: true` — never before, and never
computing its own pass/fail judgment over L19's findings.

## Alternative considered — rejected

**A lighter-weight single-page form (no multi-step wizard, no live rail),
still gated on the same verdict call.** Rejected because the card's explicit
requirement is parity with the existing Intent Wizard idiom ("no new idiom"),
and because the id-vs-domain distinction the card calls out as the actual
defect this closes is much easier for an operator to notice as two separate,
clearly-labelled rows on a live summary panel than as two adjacent fields on
a single dense form — the whole point of surfacing "Because you said X → Y"
per field is to make exactly that kind of adjacent-but-different pair
visible as it's typed, which a static form does not do.

## Fields the card's 7 questions don't map onto `LeadSchema` 1:1

Resolved with explicit, editable defaults rather than silently invented —
table in the iterate spec ("Fields the 7 questions don't cover"). Flagged
here because it's the one place the mini-plan diverges from a literal reading
of the card: `reports_to`, `manages`, `charter_path`/`learnings_path`,
`max_concurrent_tasks`, `model`, `allowed_tools`, `paused` all need a value
leadwright's schema requires but the card's question list never asks for.
