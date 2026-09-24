# Iterate throughput

> Derived report — reproducible entirely from `shipwright_events.jsonl`. Not an agent startup input; regenerated at F5b. A missing applicable agent mark is shown as *unattributed* with a reason, never as zero duration; the two structurally-limited groups (`finalization`, `delivery`) are labeled separately — see the Coverage boundary note below.

> **Derived spans:** a fold-time-capturable group with no agent start/end mark, but at least one producer child that names it as parent, is reconstructed from that child's own envelope and shown labeled *derived* rather than left unattributed — real duration data, not a measured boundary; it does not count toward coverage.

> **Coverage boundary:** F5b folds this report's durable data BEFORE F6 commits and F11 delivers — `discovery_diagnosis` through `review` can close by then, but `finalization`'s own duration and the entire `delivery` group (incl. `ci_wait`/`delivery_wait`/`post_ci_remediation`) structurally cannot, in every run. Coverage below is measured against the four applicable groups when one entry path is recorded; a run that explicitly records both `discovery_diagnosis` and `planning` is measured against all five — see `iterate-timings.md` for why.

## Latest run: `iterate-2026-09-24-codextender-review-model-disable`

- **Timing source:** producer + agent spans (mixed) · **coverage:** 1/5 applicable fold-time groups (+1 derived), 5 spans total — **DEGRADED** (a fold-time-capturable phase is missing)
- **Wall clock (scope through F5b):** 13.8 min (measured)
- **Instrumented:** 3.7 min of wall clock (26.8%)
- **Unattributed:** 10.1 min (73.2%)
- **Invalidation-driven restarts:** 0

### Top-level phases (inclusive / exclusive / % of timing envelope)

| Phase | Inclusive | Exclusive | % of timing envelope |
|---|---:|---:|---:|
| discovery_diagnosis | *unattributed — no agent start/end marks recorded* | — | — |
| planning | *unattributed — no agent start/end marks recorded* | — | — |
| implementation | 3.7 min | 3.7 min | 93.3% |
| verification | 0.0 s *(derived — reconstructed from child spans)* | 0.0 s | 0.0% |
| review | *incomplete* (started, not closed) | — | — |
| finalization | *not reached before F5b fold (structural)* | — | — |
| delivery | *not reached before F5b fold (structural)* | — | — |

### Nested spans

| Span | Parent | Duration | Outcome | Detail |
|---|---|---:|---|---|
| pre_f0_validation | verification | 0.0 s | completed | stage=f0 |
| self_review | review | — | incomplete | — |

## Rolling comparison (last 10 instrumented runs)

| Phase | Median exclusive | P90 exclusive | Samples |
|---|---:|---:|---:|
| discovery_diagnosis | — | — | 0 |
| planning | 2.0 min | 2.5 min | 2 |
| implementation | 13.4 min | 29.5 min | 6 |
| verification | 0.0 s | 0.0 s | 6 |
| review | 96.4 min | 192.8 min | 2 |
| finalization | — | — | 0 |
| delivery | — | — | 0 |

## Run history

| Run | Wall | Instrumented | Group coverage | Restarts | Status |
|---|---:|---:|---:|---:|---|
| `iterate-2026-09-16-codex-probe-win32-shim` | 36.2 min | 2.0% | 0/5 | 0 | degraded |
| `iterate-2026-09-16-mission-feed-render-fidelity` | 744.0 min | 45.7% | 0/5 | 0 | degraded |
| `iterate-2026-09-19-fix-wizard-plan-card-white-text` | 36.9 min | 44.6% | 1/4 | 0 | degraded |
| `iterate-2026-09-19-codex-reviewer-fields` | 32.5 min | 26.5% | 1/5 | 0 | degraded |
| `iterate-2026-09-19-codex-launch-powershell-chunk` | 32.7 min | 37.2% | 1/5 | 0 | degraded |
| `iterate-2026-09-19-codex-model-catalog` | 60.5 min | 31.5% | 1/4 | 0 | degraded |
| `iterate-2026-09-19-codex-launch-phase-empty` | 12.0 min | 0.0% | 0/5 | 0 | degraded |
| `iterate-2026-09-20-mission-feed-transcript-fidelity` | 153.8 min | 24.1% | 1/5 | 0 | degraded |
| `iterate-2026-09-23-codextender-webui-integration` | 231.7 min | 0.0% | 0/5 | 0 | degraded |
| `iterate-2026-09-24-codextender-review-model-disable` | 13.8 min | 26.8% | 1/5 | 0 | degraded |
