# Leads org route

## What

A new `/api/external/org/*` route family (5 endpoints: `GET`/`PUT /file`,
`GET /org-chart`, `GET /leads/:leadId/usage`, `POST /decisions/countersign`)
reading and writing `~/.claude/leads/**` — leadwright's org directory, a
different tool's data, not a Shipwright project. Gated by a host-bind
allowlist (loopback or the operator's own Tailscale tailnet, PO decision
2026-08-16) and a shared secret (`X-Shipwright-Leads-Secret`, constant-time
compare), applied once as router middleware. The one write action that races
leadwright's own daemon (countersign) is serialized through a
`proper-lockfile` contract over `decisions-proposed.md`. Full design
rationale: `.shipwright/planning/iterate/2026-08-17-org-route-leads.md`.

## Plan-Review-Findings

`external_review.py --mode iterate` (Step 3.5, mini-plan vs spec), both
providers, `revise`. 11 findings — see the iterate spec's own "## Plan
Review" section for the full table; summarized here for completeness since
they shaped the shipped contract: the generic `PUT /file` allowlist would
have let an unlocked write bypass the countersign lock on
`decision_log.md`/`decisions-proposed.md` (HIGH, both — fixed: those two
kinds route through `withDecisionsLock` inside `file-write.ts`); countersign
needed to key on `{timestamp, leadId}` not timestamp alone (MEDIUM, both);
the two-file decision-log move needed to be crash-atomic via an
idempotent-retry check (HIGH/MEDIUM, both); `decisions-lock.ts`'s direct
file access needed the same symlink defense as `file-write.ts` (HIGH,
openai); `usage.ts`'s `leadId` param needed traversal validation (HIGH,
both). All 11 adopted before build; none rejected.

## External-Code-Review-Findings

`external_review.py --mode code`, provider openrouter, 2 legs requested.
First pass: `degraded: false`, both legs completed. Second (post-fix) rerun
— run with `uv run --with openai` after an initial `openai package not
installed` degradation — the deepseek leg returned an empty reply
(per-leg degradation, `reviews_succeeded: 1/2`, `degraded: false` overall
since ≥1 leg completed); the openai leg completed and returned the 5
findings below.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| EC-1 | high (security) | The named org-chart endpoint `join`s and `readFileSync`s `org-chart.json` with no `lstat` symlink rejection or realpath containment — a symlinked file could be read through this authenticated route. | **accepted-and-fixed** — `org-chart.ts` now `lstat`-checks the resolved path before reading; a symlinked final component returns 403 `symlink_forbidden`. |
| EC-2 | medium (spec) | Generic `PUT /file` auto-vivified a missing `decisions-proposed.md` — `withDecisionsLock`'s own `ensureFile` bootstrap (needed so `proper-lockfile` has a target to lock) was silently satisfying the write's edit-existing-only contract too. | **accepted-and-fixed** — `file-write.ts` now does a pre-lock `lstat` existence probe; a genuinely missing target 404s before the lock is ever acquired. |
| EC-3 | medium (spec) | Countersign accepted any non-empty `timestamp`/`leadId` string instead of validating ISO-8601 timestamp / lead-id shape — the existing tests used placeholder values like `"T1"`, confirming rather than catching the gap. | **accepted-and-fixed** — `ISO_TIMESTAMP_RE` + the shared `LEAD_ID_RE` format checks added ahead of the match logic; 400 `timestamp_invalid`/`leadId_invalid` on mismatch. |
| EC-4 | medium (edge-case) | Duplicate proposed entries sharing the same `(timestamp, leadId)` were silently mishandled — only the first match was ever moved, a second request found the already-logged entry and discarded the still-unlogged duplicate. | **accepted-and-fixed** — `countersign.ts`'s match now uses `.filter()` instead of `.find()`; >1 match returns 409 `duplicate_proposal_identity` on both the initial-match and idempotent-retry paths, instead of silently picking one. |
| EC-5 | medium (bug) | `parseOrgChart` accepted an array for `leads`, because `typeof [] === "object"` — `{"leads":[]}` passed validation instead of being rejected as malformed. | **accepted-and-fixed** — explicit `Array.isArray(obj.leads)` rejection added before the shape checks. |

All 5 fixed before commit; none rejected. The doubt-reviewer's separate
adversarial pass (CRLF-terminated header parsing, a post-lock symlink
re-check for TOCTOU, hardening the lock-unification and two-process tests
with negative/falsification controls, and the boot-time weak-secret
warning) is recorded in
`.shipwright/planning/iterate/iterate-2026-08-17-org-route-leads/doubt-reviewer-payload.json`
and not duplicated here — none overlapped with the external-review set
above.

## Rationale

Models `server/src/external/file/write.ts`'s allowlist / path-guard /
realpath-guard / symlink-rejection / atomic-write pattern, since that is
the closest existing precedent for a scoped file API in this codebase, and
adds exactly the three things that file already didn't need: a host-bind
gate, a shared-secret gate, and a cross-process lock for the one file two
processes actually contend on. `org-chart.json` gets a **named, typed**
read (not `GET /file?path=org-chart.json`) because the acceptance bar is
"malformed → error, never a half structure," which needs real parsing, not
byte-streaming. Decision-log entries use opaque, header-delimited blocks —
this route never parses the Context/Decision/Consequence prose inside an
entry, matching the triage doc's own framing that transfer format is "a
named response shape, nothing more."

## Rejected

A local CLI instead of a network route (Architecture Review, deepseek) —
not adopted: the launch card explicitly specifies an HTTP-shaped route
with a host-BIND allowlist, which is meaningless for a local CLI, and cites
a dated PO decision for one of its rules; re-litigating an already-settled
binding choice is not what "stop only for a genuine PO decision" means.
Shipping the usage endpoint later, once leadwright has a producer
(Architecture Review, both) — not adopted: the triage doc pre-empts this
exact objection ("the shape is fixed now anyway, because the follow-up
package would otherwise invent its own"), and the launch card independently
requires the interface now. A byte-for-byte port of leadwright's own
`.strict()` Zod org-chart schema — rejected: write-time invariants stay
leadwright's job; this route's read side only needs to refuse a
non-object/missing-field file, matching CLAUDE.md rule 7's no-cross-package
mirror discipline.
