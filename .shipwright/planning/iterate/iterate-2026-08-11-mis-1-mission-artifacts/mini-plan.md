# Mini-plan — MIS-1 Mission artifacts

1. Extend the server Mission DTO and its verbatim client mirror together. Parse the adopted requirements row for ID, title, description and area; preserve fold provenance; mint only an opaque, task-bound document id for its source document/anchor.
2. Use deterministic requirement precedence: a `work_completed` record is the only **Recorded** source; before that, an iterate spec with an explicit impact section is **Planned**; no usable spec/Scout evidence is **Discovering affected requirements**; explicit `spec_impact: none` from either authoritative source is always **No requirement changed**. A retained F5c summary can never make an item Recorded.
3. Read the immutable F5c snapshot fail-soft as enrichment only. The existing producer gate remains primary: pass → Passed, fail → Failed, unknown/all-skipped/malformed/partial → No reliable result or Needs attention. Missing/corrupt F5c never changes a gate to green; it states precisely that layers, behaviours or traceability could not be established.
4. Thread the resolved context into the middle Mission card. Iterate Mission uses `MissionContext.runId` and terminal artifacts; pipeline and other scenarios retain their existing task-run lookup. Add regression cases for both paths.
5. Use one normal-flow shared panel header for Requirement, Tests, Review, Decisions and Commit, and correct the two Decisions states from their existing `source` / `adrId` facts.
6. Add focused server/client tests for precedence, lifecycle, F5c degradation, source-link safety, centre identity, decisions and header markup; then run type checks, unit suites and an isolated Mission E2E flow.

## Resolved source and verdict rules

- Requirement lifecycle is ordered, never merged: readable `work_completed` wins and is **Recorded** (including its explicit `none`); without it, an explicit iterate-spec `none` is **No requirement changed**; then a usable impact section (FR id or impact prose) is **Planned**; otherwise it is **Discovering affected requirements**. The adopted requirements document supplies display metadata only, never lifecycle status. A recorded non-`none` event with no usable IDs remains recorded with an explicit missing-detail note.
- Requirement rows join by the event/spec FR id, fold to the adopted row, and preserve the original id. Missing or partial adopted rows retain the original id and show only established fields.
- Test headline classifier is exhaustive: event gate `fail` is **Failed**; gate `pass` plus valid, non-all-skipped counts is **Passed**; gate `pass` plus invalid/partial counts is **Needs attention**; gate `unknown` plus proven all-skipped is **Needs attention**; every other unknown/missing/malformed result is **No reliable result**. F5c is keyed by `MissionContext.runId`, validates its embedded run id, and can only add evidence or an explicit unavailable note.
- The source document continues through the existing signed task/session-bound document-id reader. The client receives neither a path nor a route it constructs; a link can only reopen the document payload that the server minted for this context.
- A terminal iterate without readable terminal artifacts retains its Mission run identity and shows unavailable/discovering evidence. It never falls back to `task.runId`; non-iterate contexts retain the current task-run join.
- A decision is **Published as ADR-NNN** only for `source: decision_log` with a valid ADR id. A drop is always **Recorded — ADR number assigned at release**.

## Alternative considered

Add new fields to the Shipwright `work_completed` event. Rejected: its existing event and F5c artifacts already contain the needed facts, and this change is explicitly WebUI-only.
