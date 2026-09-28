# ADR — E2E fixture-task cleanup (35-no-chat-panel.spec.ts + title-bar-full-bleed.spec.ts)

## Context

Running `e2e/flows/35-no-chat-panel.spec.ts` (a `@smoke` test) alone or as
part of the `@smoke` set deterministically left an unassigned fixture task
(`cwd C:/tmp/no-chat`) behind. `isolated-stack.mjs`'s
`removeUnassignedFixtureTasks` contamination guard caught it at teardown and
failed the run with exit 1, even though the spec's own assertion passed.

Fixing that leak (wrap assertions in `try/finally`, delete the task) surfaced
a second, previously-masked bug: `title-bar-full-bleed.spec.ts`'s `measure()`
assumes `.page-head` exists on every route, but `RootRoute.tsx` redirects `/`
to `/first-contact` (no `.page-head` at all) when the registry has zero
projects AND zero tasks. The leaked task from `35-no-chat-panel.spec.ts` was
accidentally keeping the registry non-empty for the rest of the `@smoke` run;
once that leak was fixed, `title-bar-full-bleed.spec.ts` could land on a
genuinely empty registry and its `.page-head` wait timed out. Confirmed twice
in CI (PR #488, runs `36387602179` and its rerun), both failing the same 3
assertions with the `/first-contact` First Contact hero visible in the
captured Playwright page snapshot.

## Decision

Wrap `35-no-chat-panel.spec.ts`'s assertions in `try/finally` and call the
shared `cleanupTask(request, taskId)` helper
(`client/e2e/helpers/task-fixture.ts`), matching the pattern other
fixture-creating specs already use (e.g.
`C5-embedded-terminal-split-smoke.spec.ts`). Separately, give
`title-bar-full-bleed.spec.ts` its own `beforeAll`/`afterAll` fixture task via
the same helpers, so its `.page-head` assertions no longer depend on another
spec's incidental/leaked state or on file run order.

## Consequences

Neither spec depends on ambient state from other specs any more; the
isolated-stack teardown no longer sees a leaked unassigned task; the full
local `@smoke` set (34 tests, same file order as CI) passes. No production
code changed in either fix.

## Rationale

`35-no-chat-panel.spec.ts` was the one outlier among fixture-creating E2E
specs that never deleted its task. `title-bar-full-bleed.spec.ts`'s
dependency on ambient registry state was a latent, pre-existing gap (present
since the First Contact hero shipped in #321, two days after this spec was
authored in #312) that only became visible once the masking leak was fixed —
the correct fix is to make the spec self-sufficient, not to reintroduce the
leak or special-case ordering.

## Rejected alternatives

- Reintroducing a deliberate leak in `35-no-chat-panel.spec.ts` to keep the
  registry non-empty for later specs — this is exactly the anti-pattern the
  user's bug report asked to remove, and it would leave any spec run in
  isolation (e.g. `--grep` scoped to just `title-bar-full-bleed.spec.ts`)
  still flaky against a genuinely empty registry.
- Special-casing Playwright's file run order so `title-bar-full-bleed.spec.ts`
  always runs after a task-creating spec — fragile, undocumented, and breaks
  the moment any spec file is added, renamed, or reordered.
