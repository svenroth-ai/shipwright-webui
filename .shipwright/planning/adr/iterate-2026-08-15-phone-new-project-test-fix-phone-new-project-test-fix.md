# ADR: Fix phone new-task E2E test assertion, not the component

## Context

`90-phone-responsive.spec.ts` 'phone + New drills project' asserted
`getByTestId("new-issue-project-select")` after the phone create-menu cascade
picks a project and opens New Task. That select never renders on this flow:
`useNewIssueFormDerived.ts` locks the modal to the already-picked project
(`scopedProject` from `initialProjectId`), and `SimpleFields.tsx`'s
`ProjectFieldFragment` renders the read-only `ProjectContextStrip` instead
whenever a project is scoped. The lock predates this test by two weeks in git
history, and the `onSelect` wiring that threads the picked project id into the
modal is untouched by `iterate-2026-08-13-mission-mobile-visual` (the change
that shipped alongside this test).

## Decision

Fix the test, not the component. Replaced the select-value assertion with
`project-context-strip` visibility + `project-context-name` text, matching the
test's own stated intent ("modal SCOPED to the chosen project") better than
the original mechanism — the test's own comment contradicted its own
assertion (scoped is exactly what makes the select disappear).

## Consequences

The drill-in test now passes and asserts the visible project name rather than
an internal id — a stronger behavioral check than the id-based assertion it
replaced. A second, textually-adjacent test (the touch-safe modal test)
independently times out (30s) on the same never-rendered testid, via an
unrelated font-size assertion loop. Confirmed NOT a cascade of this fix —
reproduces standalone, single test, single worker. Filed separately as
`trg-9435df9d` per the operator's explicit instruction, rather than folded
into this diff.

## Rationale

`ProjectContextStrip.tsx`'s own docstring states the contract: "Read-only
project chip rendered by NewIssueModal when `useProjectFilter` returns a
scoped project (not 'All projects')." Having explicitly picked a project one
step earlier in the cascade, handing the user a dropdown to pick it again
would contradict the flow's own design. Desktop behaves identically — the
phone cascade merely always routes through a project row, so it never reaches
the unscoped path where the select is reachable (the All-Projects "+ New").

## Rejected Alternative

Giving the strip a way to reveal an override select, so a user could change
project after drilling in without closing the modal. That is a genuine
feature (change project without leaving the modal), was weighed and declined
for now by the operator, and does not belong in a test-fix diff.
