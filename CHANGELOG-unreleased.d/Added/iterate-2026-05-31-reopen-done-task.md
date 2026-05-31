### Re-open a done task

Done tasks now carry a "Re-open" item in the TaskCard ⋯-menu — the counterpart
of "Move to Backlog" for the terminal `done` state. Selecting it calls
`POST /api/external/tasks/:id/reopen`, flipping the task back to draft (the
Backlog column) while preserving its session, so the card then offers Resume to
continue the completed run.

Run-ID: iterate-2026-05-31-reopen-done-task
