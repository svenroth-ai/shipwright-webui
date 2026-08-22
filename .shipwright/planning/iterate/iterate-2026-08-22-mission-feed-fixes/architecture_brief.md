# Architecture Brief: mission-feed-fixes

## The problem
A prior merged change (`iterate-2026-08-20-mission-feed-content`) claimed
to give every Mission activity-feed card real transcript content and to
show a run's real delivery message, but review against real screenshots
found five defects: two card-classification regexes misfire on unrelated
commands, one card kind is bucketed wrong regardless of its actual
purpose, four card kinds still fall back to generic placeholder text in
the common case, and the "Delivered" card can show an unrelated older
run's message because of how the server infers which run a browser
session belongs to.

## What would newly, permanently exist
Nothing. This changes classification logic, fallback-text derivation, and
an identity-recovery heuristic inside machinery that already exists (the
`missionActivityFeed.ts` reducer and `run-id-recovery.ts`'s transcript
scan) — no new mechanism, service, credential, or schedule.
