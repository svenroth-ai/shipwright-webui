# Architecture Brief: decision-reject-reason

## The problem

When the operator rejects a decision an AI lead proposed, the proposal disappears and only an audit
line with an identifier remains: no wording, no reason. The leads therefore cannot learn what was
rejected or why, and propose the same idea again in other words, which costs the operator another
review each time.

## What already exists here

- `decisions-proposed.md` (leads write, operator decides), guarded by one cross-process file lock
  shared with the leadwright daemon.
- `decision_log.md`: the countersigned decisions, written only by this web UI under that lock.
- Per-lead `audit.jsonl` with a `decision_rejected` record (identifier + optional operator reason).
- A "repeat of a rejected proposal" hint in the web UI, computed from those audit records.

## What would newly, permanently exist

An org-wide, append-only `decisions-rejected.md` next to the two decision files, written only by the
web UI when the operator rejects a proposal: one block per rejection with the proposed line, the lead,
the time and the operator's optional reason, in a fixed grammar the leadwright daemon parses and feeds
to the leads. Countersign gains an optional operator note in the decision log block. The grammar is a
cross-repository contract kept correct by a documented section plus a pinned sample file in this repo.

## Options on the table

- **A:** one org-wide `decisions-rejected.md` written under the existing decisions lock.
- **B:** one rejected-decisions file per lead, in the lead's own folder.
- **C:** put the rejected text and reason into the existing audit record and let leadwright read the
  audit logs.
- **D:** do nothing (leads keep re-proposing).

## Constraints that are not negotiable

The file name, location (org-wide), lock, and block shape are already agreed with the leadwright side,
which is implementing the reading side in parallel against that contract. The audit record must never
carry proposed text (earlier operator decision). The web UI never writes the leads' files outside this
decision flow.
