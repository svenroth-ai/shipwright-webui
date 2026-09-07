# Lead-setup wizard: real-verdict re-verification + single write-sequence lock

## Context

Setting up a leadwright lead today means hand-writing three files
(`org-chart.json`, `<leadId>/charter.md`, `daemon-config.json`) that must
agree in ways nothing checks, and every failure is silent. This card (W14)
replaces that with a 7-question guided wizard whose Finish action is gated
on a real verdict from leadwright's own preflight checker
(`daemon/setup-preflight.ts`, card L19), not a client-side approximation.

## Decision

1. **The same real subprocess transport (`core/leadwright-preflight-transport.ts`)
   runs leadwright's actual `check-setup.ts` at two points**: once at the
   Verdict step (preview, non-committing) and again, server-side, inside
   `commitCore` immediately before the write sequence — using the exact
   merged proposal about to be written, never the client's earlier snapshot.
2. **`expectedProposalDigest` stays as a UX staleness check only** ("your
   answers changed since you last checked"), not a security gate. It is an
   unsigned SHA-256 a client could compute without ever calling `/verdict`,
   so `commitCore` no longer trusts a matching digest as proof of a green
   verdict — the re-run in (1) is what actually gates the write. A red or
   unparsable re-verification 409s (`verdict_not_ok`) or 502s
   (`leadwright_transport_failed`) and never writes.
3. **One `withOrgFileLock` on `org-chart.json` spans the entire
   charter.md + daemon-config.json + org-chart.json write sequence**, with a
   fresh re-read + re-check of `org-chart.json` as the first thing inside
   the lock. A second concurrent commit for the same new `leadId` cannot
   enter the critical section until the first's full commit has finished
   and released the lock, so its own fresh check correctly sees the
   collision and 409s (`org_chart_lead_exists`) before writing anything —
   closing a true-concurrency race the earlier sequential-resubmission fix
   did not cover.
4. **`mergeLeadProposal` now accepts `existingCharters`** (every other
   lead's current `charter.md`, read via `readExistingLeadCharters`) and
   includes them in the `charters[]` array sent to leadwright's real
   preflight subprocess. Verified directly against the local leadwright
   checkout's `daemon/setup-preflight.ts`: it iterates every lead in
   `orgChart.leads` and produces an unsatisfied `charter-bands:<leadId>`
   finding for any lead absent from the inline `charters[]` array — there
   is no on-disk "path mode" fallback for the inline stdin contract, so
   omitting existing leads' charters would make every setup with 2+ leads
   fail preflight for a reason unrelated to the lead actually being added.

## Consequences

- The commit endpoint can no longer be tricked into writing an org entry
  that violates leadwright's own MUSS rules by an attacker who computes a
  matching digest without going through `/verdict` — every commit is gated
  on a genuinely fresh, server-observed green result.
- A true concurrent-commit race for the same new `leadId` now always
  resolves to exactly one winner and one clean 409, with no partial writes
  (charter.md or daemon-config.json silently clobbered ahead of the
  org-chart.json conflict check).
- `commitCore` now issues one extra subprocess call per commit (the
  server-side re-verification) — an accepted latency cost for closing an
  unsigned-digest bypass; leadwright's preflight is already the same
  subprocess the Verdict step calls, so no new external dependency.
- `commit.ts` and `commit.test.ts` were extracted into
  `commit-validate.ts`/`commit-validate.test.ts`,
  `commit.test-fixtures.ts`, and `commit-lock.test.ts` to stay under the
  300-line bloat ceiling after these fixes; this also surfaced (and fixed)
  a previously-hidden `PreflightLead.budget.window` literal-type mismatch
  that the server `tsconfig.json`'s `**/*.test.ts` exclusion had been
  hiding from `tsc --noEmit`.

## Rationale

Both external LLM reviewers (openai + GLM) independently flagged the
unsigned-digest bypass and the true-concurrency race as high-severity —
cross-checking the `leadwright-proposal-merge.ts` doc comment's claim of a
"path mode" fallback against the actual local leadwright source confirmed
the reviewers were right and the original doc comment was factually wrong,
so the fix closes a real bug rather than a false positive.

## Rejected alternatives

- **Signing the digest (HMAC) instead of re-running preflight**: still
  wouldn't prove leadwright's *current* rules were satisfied — a lead
  approved under yesterday's charter-band rules could still be stale today.
  Re-running the real subprocess is the only check that reflects "right
  now."
- **Per-file locks (charter.md, daemon-config.json, org-chart.json
  independently) instead of one spanning lock**: this is exactly the
  sequential-resubmission shape the earlier doubt-review fix closed, but a
  true concurrent pair can still both pass each file's own late conflict
  check before the other's write lands — only a single lock spanning the
  whole sequence closes the race for real.
- **Keeping the "path mode" charter read (leadwright reads charters from
  disk)**: contradicted by the real `daemon/setup-preflight.ts`, which has
  no such fallback for the inline stdin contract used here.
