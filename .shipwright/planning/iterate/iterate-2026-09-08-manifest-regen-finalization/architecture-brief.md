# Architecture brief: should this exist at all?

A CI job ("Traceability manifest (gate)") has hard-failed `main` seven times
in three weeks because a derived compliance artifact goes stale on nearly
every PR that adds a test. Proposal: keep the check, but make its own
failure non-blocking (`continue-on-error`) and have a follow-up step
auto-open a small PR with the fix, using only the existing `GITHUB_TOKEN`
(no new credential, no auto-merge, no ruleset change).

Question: should this exist at all, versus simpler alternatives —
(1) just delete the gate entirely and rely on periodic `/shipwright-compliance`
runs, (2) leave it hard-failing but reduce how often it fires (e.g. only
check `spec_hash`/orphans, not `untagged_tests`), or (3) something else?
