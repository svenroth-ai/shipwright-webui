# Architecture Brief: v1-lead-fields-tag-filter

## The problem

A future external caller (a leadwright daemon, in a separate repo) needs to
write PO feedback onto a task, link a task to its lead-created parent at
creation time, and look tasks up by tag cheaply instead of scanning every
session's JSONL on disk. None of the three is currently reachable through
the External Task API.

## What would newly, permanently exist

Nothing new is added. This changes three existing endpoints on machinery
that already exists: `PATCH /api/external/tasks/:id` gains one more
patchable field (following the same pattern nine other fields already use),
`POST /api/external/tasks` accepts one more optional field on the same
soft-drop create path five other fields already use, and
`GET /api/external/tasks` gains one more query filter alongside the
existing `?projectId=`.
