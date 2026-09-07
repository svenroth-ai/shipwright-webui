Stage-1 spec-compliance review (spec-reviewer), leadwright lead-setup Intent
Wizard (W14, iterate-2026-09-07-leadwright-setup-wizard). Reconstructed from
this session's own record (raw agent replies were not durably saved before
this write — see reviews.json disposition note); the finding content below
is accurate to what was found and fixed in each round.

## Round 1: REJECT (3 findings)

1. ELOCKED convention missing on the daemon-config.json / org-chart.json
   writes in commit.ts — a genuine cross-process lock conflict fell through
   to the app-wide error handler's generic (wrong-resource) message instead
   of a named 409, violating CLAUDE.md rule 6 / DO-NOT #6.
   Fix: added explicit try/catch mapping ELOCKED -> 409
   {error: "daemon_config_locked" | "org_chart_locked"}.
2. The plain-surface `/api/org/*` routing decision (the wizard calls
   `server/src/routes/org-lead-setup-wizard.ts`, not the secret-gated
   `/api/external/org/*` family) was a correct, deliberate divergence from
   the iterate spec's original routes list, but was not recorded in the
   spec doc itself.
   Fix: added a "Correction (post-implementation, verified against the
   shipped code)" section to the spec doc documenting the decision and its
   rationale (mirrors two prior same-week iterates' convention).
3. `DomainSelect` had no degrade path for when the shared domain vocabulary
   fetch fails — W14 requires ONE shared vocabulary used by both the
   wizard and the card modal, converted from free text; a failed fetch must
   never silently present an empty/broken select.
   Fix: added an `unavailable` prop to DomainSelect that renders a plain
   free-text input (still kebab-case validated downstream) instead of a
   select with no options, wired to `domainVocabulary.isError` in both
   NameIdDomainStep.tsx and LeadwrightFields.tsx.

## Round 2: REJECT (2 new findings, found on a fuller re-check)

1. `writeNewCharterFile` (commit-writes.ts) had no symlink check, unlike
   the daemon-config.json / org-chart.json writes — a gap in the "every
   filesystem write in this feature is symlink-checked immediately before
   its mutating syscall" requirement.
   Fix: added an injectable `lstat` parameter and `assertNotSymlink` calls
   on both the lead directory and the charter.md path itself, before
   `mkdirSync`/`writeFileSync` respectively.
2. The spec doc cited `GET /api/external/org/beat-register/health` for the
   leadwright-checkout health check, but the shipped code uses
   `GET /api/diagnostics` instead (no such general beat-register/health
   route exists) — an undocumented but correct divergence.
   Fix: added a second "Correction (post-implementation, verified against
   the shipped code)" paragraph to the spec doc under "Server — checkout
   health", pointing at `diagnostics.leadwright-checkout.test.ts`.

## Round 3: PASS

No new findings. All 5 findings from rounds 1-2 verified fixed against the
current diff; both spec-doc corrections present; ELOCKED and symlink-escape
conventions consistent across all three writes (charter.md, daemon-config.json,
org-chart.json). Cleared to proceed to code-reviewer (Stage 2).
