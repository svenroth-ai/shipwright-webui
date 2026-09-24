# Iterate throughput

> Derived report — reproducible entirely from `shipwright_events.jsonl`. Not an agent startup input; regenerated at F5b. A missing applicable agent mark is shown as *unattributed* with a reason, never as zero duration; the two structurally-limited groups (`finalization`, `delivery`) are labeled separately — see the Coverage boundary note below.

> **Derived spans:** a fold-time-capturable group with no agent start/end mark, but at least one producer child that names it as parent, is reconstructed from that child's own envelope and shown labeled *derived* rather than left unattributed — real duration data, not a measured boundary; it does not count toward coverage.

> **Coverage boundary:** F5b folds this report's durable data BEFORE F6 commits and F11 delivers — `discovery_diagnosis` through `review` can close by then, but `finalization`'s own duration and the entire `delivery` group (incl. `ci_wait`/`delivery_wait`/`post_ci_remediation`) structurally cannot, in every run. Coverage below is measured against the four applicable groups when one entry path is recorded; a run that explicitly records both `discovery_diagnosis` and `planning` is measured against all five — see `iterate-timings.md` for why.

## Latest run: `iterate-2026-09-19-fix-wizard-plan-card-white-text`

- **Timing source:** producer + agent spans (mixed) · **coverage:** 1/4 applicable fold-time groups (+1 derived), 8 spans total — **DEGRADED** (a fold-time-capturable phase is missing)
- **Wall clock (scope through F5b):** 36.9 min (measured)
- **Instrumented:** 16.5 min of wall clock (44.6%)
- **Unattributed:** 20.4 min (55.3%)
- **Invalidation-driven restarts:** 0

### Top-level phases (inclusive / exclusive / % of timing envelope)

| Phase | Inclusive | Exclusive | % of timing envelope |
|---|---:|---:|---:|
| discovery_diagnosis | *not applicable — planning is the recorded entry path* | — | — |
| planning | 1.9 min *(derived — reconstructed from child spans)* | 1.4 min | 9.1% |
| implementation | 15.7 min | 15.7 min | 100.0% |
| verification | *unattributed — no agent start/end marks recorded* | — | — |
| review | *incomplete* (started, not closed) | — | — |
| finalization | *not reached before F5b fold (structural)* | — | — |
| delivery | *not reached before F5b fold (structural)* | — | — |

### Nested spans

| Span | Parent | Duration | Outcome | Detail |
|---|---|---:|---|---|
| self_review | review | — | incomplete | — |
| external_review | planning | 22.7 s | completed | provider=codex |
| external_review | planning | 7.4 s | completed | provider=codex |
| external_review | review | 11.2 s | completed | provider=codex |
| external_review | review | 34.0 s | completed | provider=codex |

## Rolling comparison (last 10 instrumented runs)

| Phase | Median exclusive | P90 exclusive | Samples |
|---|---:|---:|---:|
| discovery_diagnosis | — | — | 0 |
| planning | 1.7 min | 1.9 min | 2 |
| implementation | 13.3 min | 385.0 min | 6 |
| verification | 0.0 s | 0.0 s | 6 |
| review | 96.4 min | 192.8 min | 2 |
| finalization | — | — | 0 |
| delivery | — | — | 0 |

## Run history

| Run | Wall | Instrumented | Group coverage | Restarts | Status |
|---|---:|---:|---:|---:|---|
| `compliance-b7-1a0cbc58-20260911` | — | — | — | — | pre-instrumentation |
| `iterate-2026-09-11-compliance-b7-g2-i5` | 12.0 min | 19.6% | 1/5 | 0 | degraded |
| `iterate-2026-09-11-req3-03-ac-parse-adjacency` | 6.3 min | 0.0% | 0/5 | 0 | degraded |
| `iterate-2026-09-11-list-error-state-run-mode-sentinel` | 45.8 min | 23.6% | 1/5 | 0 | degraded |
| `iterate-2026-09-11-triage-compose-local-wins` | 36.9 min | 0.0% | 0/5 | 0 | degraded |
| `iterate-2026-09-12-mobile-triage-form-layout` | 463.7 min | 83.9% | 1/4 | 0 | degraded |
| `iterate-2026-09-16-codex-light-webui` | 193.6 min | 62.0% | 1/5 | 0 | degraded |
| `iterate-2026-09-16-codex-probe-win32-shim` | 36.2 min | 2.0% | 0/5 | 0 | degraded |
| `iterate-2026-09-16-mission-feed-render-fidelity` | 744.0 min | 45.7% | 0/5 | 0 | degraded |
| `iterate-2026-09-19-fix-wizard-plan-card-white-text` | 36.9 min | 44.6% | 1/4 | 0 | degraded |
