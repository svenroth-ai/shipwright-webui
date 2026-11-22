# Mini-plan W1: reminder CLI bridge (server only)

Goal: GET due (per project, all projects), POST done / snooze / add, all through reminder_cli.py.

Files (all new, plus a 3-line mount in server/src/index.ts, which is at its bloat ceiling of 958):
- core/reminder-contract.ts: pinned v1 shape, parseDueAnswer -> ok | unsupported-version | unreadable; drops sourceRoot/reminderStore.
- core/reminder-cli-runner.ts: uv run --no-project --python ">=3.11"; argv in --flag=value form, positionals after `--`; exit-code mapping (2 refused passes message through, 3 not-found, 4 store-busy, -1 / missing script / missing uv engine-unavailable, timeout failed).
- core/reminder-validation.ts: id/day/length/link-label checks mirroring CLI caps.
- routes/reminders.ts: GET /api/reminders/due, GET /api/reminders/:projectId/due, POST :projectId/{done,snooze,add}; every response has an explicit `state`; all-projects read runs with concurrency 3.
Tests: pinned-shape + one per error state + argv pinning + route tests + real-CLI integration (skipped when CLI/uv absent) + static no-write guard.
Rejected: native TS read of the store (second parser of the contract, bypasses the CLI's triage merge).
Risks: argv injection (mitigated: no shell, `--`), untrusted text (passed through verbatim, client must escape), done/snooze CLI output is text not JSON (relayed as `output`).
