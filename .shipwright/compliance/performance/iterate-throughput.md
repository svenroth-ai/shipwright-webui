# Iterate throughput

> Derived report — reproducible entirely from `shipwright_events.jsonl`. Not an agent startup input; regenerated at F5b. A missing applicable agent mark is shown as *unattributed* with a reason, never as zero duration; the two structurally-limited groups (`finalization`, `delivery`) are labeled separately — see the Coverage boundary note below.

> **Derived spans:** a fold-time-capturable group with no agent start/end mark, but at least one producer child that names it as parent, is reconstructed from that child's own envelope and shown labeled *derived* rather than left unattributed — real duration data, not a measured boundary; it does not count toward coverage.

> **Coverage boundary:** F5b folds this report's durable data BEFORE F6 commits and F11 delivers — `discovery_diagnosis` through `review` can close by then, but `finalization`'s own duration and the entire `delivery` group (incl. `ci_wait`/`delivery_wait`/`post_ci_remediation`) structurally cannot, in every run. Coverage below is measured against the four applicable groups when one entry path is recorded; a run that explicitly records both `discovery_diagnosis` and `planning` is measured against all five — see `iterate-timings.md` for why.

## Latest run: `iterate-2026-08-11-mis-1-mission-artifacts`

- **Timing source:** producer + agent spans (mixed) · **coverage:** 0/4 applicable fold-time groups (+2 derived), 11 spans total — **DEGRADED** (a fold-time-capturable phase is missing)
- **Wall clock (scope through F5b):** — (missing_scope_mark)
- **Instrumented:** 89.3 min of wall clock (unavailable)
- **Unattributed:** 62.1 min (41.0%)
- **Invalidation-driven restarts:** 0

### Top-level phases (inclusive / exclusive / % of timing envelope)

| Phase | Inclusive | Exclusive | % of timing envelope |
|---|---:|---:|---:|
| discovery_diagnosis | *not applicable — planning is the recorded entry path* | — | — |
| planning | 5.1 min *(derived — reconstructed from child spans)* | 1.8 min | 1.2% |
| implementation | *unattributed — no agent start/end marks recorded* | — | — |
| verification | *unattributed — no agent start/end marks recorded* | — | — |
| review | 84.1 min *(derived — reconstructed from child spans)* | 74.9 min | 49.5% |
| finalization | *not reached before F5b fold (structural)* | — | — |
| delivery | *not reached before F5b fold (structural)* | — | — |

### Nested spans

| Span | Parent | Duration | Outcome | Detail |
|---|---|---:|---|---|
| external_review | planning | 0.0 s | completed | provider=none |
| external_review | planning | 0.0 s | completed | provider=openrouter |
| external_review | planning | 1.6 min | completed | provider=openrouter |
| external_review | planning | 1.7 min | completed | provider=openrouter |
| external_review | review | 2.9 min | completed | provider=openrouter |
| external_review | review | 2.8 min | completed | provider=openrouter |
| external_review | review | 2.2 min | completed | provider=openrouter |
| external_review | review | 3.6 min | completed | provider=openrouter |
| external_review | review | 2.5 min | completed | provider=openrouter |

## Rolling comparison (last 10 instrumented runs)

| Phase | Median exclusive | P90 exclusive | Samples |
|---|---:|---:|---:|
| discovery_diagnosis | — | — | 0 |
| planning | 3.0 min | 17.3 min | 6 |
| implementation | 39.2 min | 72.2 min | 2 |
| verification | 0.0 s | 24.0 min | 7 |
| review | 1.5 min | 74.9 min | 7 |
| finalization | — | — | 0 |
| delivery | — | — | 0 |

## Run history

| Run | Wall | Instrumented | Group coverage | Restarts | Status |
|---|---:|---:|---:|---:|---|
| `iterate-2026-08-08-tests-total-skip-contract` | — | unavailable | 0/4 | 0 | degraded |
| `iterate-2026-08-08-codex-operating-contract` | 87.8 min | 21.9% | 3/4 | 0 | degraded |
| `iterate-2026-08-08-triage-amend-reader` | — | unavailable | 0/5 | 0 | degraded |
| `iterate-2026-08-09-triage-filter-styling` | — | unavailable | 0/4 | 0 | degraded |
| `changelog-v0.24.0-20260808-1500` | — | — | — | — | pre-instrumentation |
| `codeql-v4-ci-maintenance-20260808` | — | — | — | — | pre-instrumentation |
| `iterate-2026-08-10-model-tier-defaults` | 110.1 min | 12.6% | 0/5 | 0 | degraded |
| `iterate-2026-08-10-reconcile-compliance-findings` | 133.5 min | 0.0% | 0/5 | 0 | degraded |
| `iterate-2026-08-10-model-tier-start-overrides` | — | unavailable | 0/5 | 0 | degraded |
| `iterate-2026-08-11-mis-1-mission-artifacts` | — | unavailable | 0/4 | 0 | degraded |
