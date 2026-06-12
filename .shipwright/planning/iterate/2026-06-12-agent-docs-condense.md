# Iterate Spec — Agent-docs condense + correctness pass

- **Run ID:** `iterate-2026-06-12-agent-docs-condense`
- **Date:** 2026-06-12
- **Intent:** CHANGE (documentation refactor)
- **Complexity:** medium (classifier: medium, conf 0.7, history-calibrated; no risk flags)
- **Spec Impact:** MODIFY (agent_docs only; no FR/spec.md change — this is doc hygiene)
- **Files:** `.shipwright/agent_docs/architecture.md`, `.shipwright/agent_docs/conventions.md`
  (NOT `CLAUDE.md` — out of scope, always-loaded; NOT `decision_log.md` — it is the SSoT we point *to*)

## Problem

The two agent-facing reference docs have accreted bloat that an LLM agent must
re-read in full each session:

- **architecture.md "Architecture Updates"** is a chronologically-jumbled mix of
  giant `iterate-*` paragraphs AND terse `ADR-NNN` one-liners — many changes are
  recorded **twice** (once each form). The giant paragraphs duplicate detail that
  already lives, fully structured, in `decision_log.md` (Context/Decision/
  Rationale/Consequences/Rejected) and in the tracked `planning/iterate/*` specs.
- **conventions.md "Convention Updates"** has the same dual-form bloat; some
  entries are multi-sentence paragraphs rather than one-line ADR refs.
- **Learnings** + **DO-NOT** bodies carry verbose justification inline.
- Both docs have **structural drift** vs the current codebase.

## Decisions (user-approved, 2026-06-12)

1. **Balanced** condensing: fully collapse the two Updates lists to one-line
   ADR/spec pointers; trim redundancy in prose; **preserve** the empirical "why"
   in Learnings that has no ADR home (keep, tighter); DO-NOT rules keep the
   normative sentence + ADR/CLAUDE.md pointer, drop the long justification.
2. **Simplify the CLAUDE.md-mirrored blocks** ("Architecture rules" + "DO-NOT
   regression guards") in conventions.md to a terse index that points at the full
   always-loaded copy in CLAUDE.md + the ADR. CLAUDE.md itself is untouched.

## Acceptance Criteria

- **AC1** — architecture.md "Architecture Updates" is one **de-duplicated**,
  chronological, ADR/spec-anchored line per change. Each line: `**ADR-NNN /
  run-id** (date, FR): one-sentence what + primary new file(s)/component(s) →
  decision_log ADR-NNN` (or the tracked spec path when no ADR number is assigned
  yet). No giant paragraphs; no duplicate entries.
- **AC2** — architecture.md structural drift corrected: terminal/ tree gains
  `idle-reaper.ts`; "9 sub-routers" → **11** incl. `media/` + `pr-status/`;
  core/ tree gains the `campaign-*` family + `triage-enrich.ts`; the stale
  "128 ADR entries (… ADR-126)" count/range in "See also" updated; the inline
  `Iterate-2026-05-1x` / `Iterate v0.8.2` Data-Flow asides condensed to ADR refs.
- **AC3** — conventions.md "Convention Updates" = one-sentence ADR refs (no
  paragraphs); the stale "9 sub-routers" fact fixed; Learnings condensed (balanced);
  "Architecture rules" + "DO-NOT regression guards" trimmed to normative rule +
  CLAUDE.md/ADR pointer.
- **AC4 (gate)** — `client/src/test/doc-sync.test.ts` passes: every `REQUIRED_TOKENS`
  entry still appears in the bundle (CLAUDE.md ∪ architecture.md ∪
  component_inventory.md). ~28 tokens live **only** in architecture.md and MUST
  survive the condense.
- **AC5 (no info loss)** — every ADR-NNN cited by a condensed entry exists in
  `decision_log.md`; every no-ADR-yet entry points at a tracked `planning/iterate/*`
  spec.

## Affected Boundaries

- **doc-sync meta-test** (`client/src/test/doc-sync.test.ts`) — a contract that
  reads these docs as data. This is the empirical gate (AC4).
- No runtime code, no config/state `*_config.json`, no API/UI surface → **no risk
  flags**; `touches_io_boundary` does NOT apply (markdown prose, not a parser
  boundary). E2E / surface_verification = `none` (justification: docs-only, no
  runtime/UI behavior change).

## Confidence Calibration

- **Boundaries touched:** the doc-sync token-coverage contract (CLAUDE.md ∪
  architecture.md ∪ component_inventory.md).
- **Empirical probes run:**
  - Token-coverage probe — grepped all 47 `REQUIRED_TOKENS` across the bundle;
    found ~28 that live ONLY in architecture.md (must survive). Will re-grep
    post-edit + run the vitest gate.
  - SSoT probe — read decision_log ADR-166…170 verbatim; confirmed full
    Context/Decision/Rationale/Consequences/Rejected structure → safe to point to.
  - Tracked-spec probe — `git check-ignore` + `git ls-files` confirmed
    `planning/iterate/*` specs ARE tracked → no-ADR-yet entries lose nothing.
  - Drift probe — `ls server/src/{terminal,core,external}` vs the tree: found
    idle-reaper, media, pr-status, campaign-* family, triage-enrich missing/stale.
- **Test Completeness Ledger:** see below.
- **Confidence-pattern check:** depth = verified against the live filesystem +
  decision_log text, not from memory of the docs; breadth = all required tokens +
  all cited ADRs cross-checked, both target files.

## Test Completeness Ledger

| Behavior (introduced/changed) | Disposition | Evidence |
|---|---|---|
| Every doc-sync REQUIRED_TOKEN still present in bundle | `tested` | `npx vitest run doc-sync` green (F0) |
| ~28 architecture-only tokens survive the condense | `tested` | post-edit grep cross-check (each token count ≥1) |
| Every cited ADR-NNN exists in decision_log.md | `tested` | grep cross-check of cited ADRs vs decision_log headings |
| No-ADR-yet entries point at a tracked spec | `tested` | `git ls-files` of each cited spec path |
| Markdown still renders (lists/headings well-formed) | `untestable` (`requires-manual-visual-judgment`) | author read-through; simple list markup, no renderer in CI |

**Enumeration basis:** the change introduces no runtime behavior; the testable
surface is exactly the doc-sync contract + the internal-consistency invariants
(token survival, ADR existence, spec existence). All are mechanically checked.
