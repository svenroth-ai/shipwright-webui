# Reminder CLI bridge (reminders W1)

## Architecture Review
External (glm + openai, run via codex driver): both approve option A (thin runner + routes calling reminder_cli.py). Internal architecture-internal-reviewer: approve. The plan reviews (external glm+openai: revise; internal opus-plan-reviewer: approve with changes) were all applied: JSON content-type required (415), http/https-only link addresses, argparse usage errors (exit 2) are a failure not a refusal, NUL and total-size validation, spawn error other than ENOENT/EACCES is a failure, thrown runner errors become a named 502, a missing contractVersion is unreadable.

## Decisions
- Every read and write goes through reminder_cli.py (`uv run --no-project --python ">=3.11"`, shared cli-child-spawn.ts). The WebUI never writes reminders.jsonl; there is no TypeScript fallback.
- Responses carry an explicit `state`; triageError and reminderCorruptLines yield `degraded` WITH the data, never "nothing due". sourceRoot/reminderStore are dropped at the contract boundary.
- The CLI's secret-refusal text is passed through unchanged (422), no retry.
- `command` is relayed as INERT display text. It must never feed the embedded-terminal auto-execute path (CLAUDE.md DO-NOT #19); a later "Start task" builds its launch via core/launcher.ts from (kind, id).
- Registered project paths are assumed to be main checkouts (the triage half of `due` reads from the checkout top of the path given).

## Follow-ups for later units
- W3 should add a short single-flight/TTL memo for `due` (one uv spawn per project per read today, concurrency 3).
- done/snooze apply to kind=reminder only; W3 must hide them on triage rows.
- Real data: no reminders exist in any registered project on this machine, so no stored `command` strings were observed.
