External / Architecture Review (medium+, Branch A/B/C gate), leadwright
lead-setup Intent Wizard (W14, iterate-2026-09-07-leadwright-setup-wizard).
Recorded from the iterate spec doc's own "## External / Architecture Review"
section (the raw provider JSON artifacts the section names —
`iterate-2026-09-07-leadwright-setup-wizard-architecture-review.json` and
`-iterate-review.json` — were not found on disk when this record was
written; this section is the durable record of what ran and what it found).

Two rounds, both legs (GLM via OpenRouter, GPT/openai via Codex CLI).

## Round 1 (--mode architecture, "should this be built at all / this shape")

Verdicts split within one step: GLM `approve`, openai `revise`. Both raised
the same proportionality concern: a multi-step wizard is more standing UI
machinery than the safety mechanism (verdict-gated, locked writes) strictly
requires, and a single-page form would carry the same mechanism at less UI
cost.

**Reconciliation: kept the multi-step wizard.** The card's own brief is
explicit and non-negotiable — "Follow client/src/components/wizard/
IntentWizard/ exactly... Invent no second idiom" — a PO-level style
constraint. GLM's own review independently reached the same place from
first principles: the disagreement was over UI weight, not over whether the
underlying mechanism (transport, locks, verdict gate, vocabulary route) is
sound; both approved that part.

GLM's two concrete, adopted findings: surface `leadwrightCheckoutRoot`
health outside the wizard (adopted); record a named retreat path for
`unclaimedCounts` if the cross-project read proves costly to keep correct
(recorded, not yet needed).

## Round 2 (--mode iterate, mini-plan vs spec)

Both legs `revise`, substantially overlapping. Every high-severity finding
was adopted:

- charter.md was never written in the first draft (both legs, high) — now
  written, ordered first in a new single server-side commit endpoint.
- the verdict's daemonConfig was client-assembled from scratch rather than a
  fresh read of the real file (both legs) — now server-side
  fresh-read-and-merge, exposed via a new GET .../daemon-config route.
- the three writes were client-sequenced with no atomicity or recovery story
  (both legs) — collapsed into one ordered, partially-idempotent server
  commit endpoint (charter.md -> daemon-config.json -> org-chart.json).
- the write routes had no server-side validation independent of a prior
  client verdict call (GLM, security) — now validated server-side, bound to
  a proposalDigest so a caller cannot commit a proposal the verdict never
  covered (openai's suggestion).
- no overall subprocess deadline beyond the stdin-write timeout (GLM) —
  added.
- the daemon-config existence check raced its own lock's ensureFile (GLM) —
  fixed, existence check now happens inside a non-ensureFile lock
  acquisition.
- the action->allowed_skills mapping guessed from an id instead of using the
  action catalog's own slash_command field (openai) — now reads that field
  directly.
- legacy non-kebab-case domains and Windows-path-form edge cases in the
  absolute-path guard (openai, low) — both now explicit, tested cases.

No unresolved finding from either round.

## No third round

Every finding from round 2 maps to a concrete, specific design change. The
internal review cascade (spec-reviewer -> code-reviewer -> doubt-reviewer)
subsequently checked the actual diff against the revised spec and found
further issues of its own (see spec_review_raw.json, code_review_raw.json,
doubt_review_raw.json in this same directory) — all fixed.

No human approval gate — `--autonomous`, self-approved after both external
rounds, per this run's stated mode.
