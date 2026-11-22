# Architecture Brief: server bridge to the Shipwright reminder CLI

## The problem
The Command Center should show what is due (reminders and expired parked triage entries) and let the operator mark done, snooze or add. The reminder data is owned by a Python CLI in the Shipwright plugin cache with its own file lock; the web server has no reminder code today.

## What already exists here
- `core/triage-cli-runner.ts` + `core/cli-child-spawn.ts`: spawn `uv run --no-project --python ">=3.11" triage_cli.py`, reaped, bounded, no TypeScript fallback.
- `routes/triage.ts`: per-project routes plus a counts route across all registered projects.
- The Shipwright CLI `reminder_cli.py` (verbs add/list/show/done/snooze/due) with a versioned JSON contract (`contractVersion` 1).

## What would newly, permanently exist
A small runner module, a contract parser and one route file in the server that call `reminder_cli.py` and relay its answers with explicit states (CLI missing, unreadable answer, unknown contract version, triage read error, damaged lines). Nothing is stored by the web server; the CLI keeps the data correct.

## Options on the table
- **A:** Runner + routes that shell out to the CLI for every read and write.
- **B:** Read `reminders.jsonl` natively in TypeScript, and only shell out for writes (as triage does).
- **C:** Do nothing in the server; have the browser or a later mail timer call the CLI some other way.

## Constraints that are not negotiable
The web server must never write `reminders.jsonl`. The `due` answer merges reminders and triage parks inside the CLI, and its contract is versioned across two repositories.
