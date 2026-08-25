# Iterate throughput

> Derived report — reproducible entirely from `shipwright_events.jsonl`. Not an agent startup input; regenerated at F5b. A missing applicable agent mark is shown as *unattributed* with a reason, never as zero duration; the two structurally-limited groups (`finalization`, `delivery`) are labeled separately — see the Coverage boundary note below.

> **Derived spans:** a fold-time-capturable group with no agent start/end mark, but at least one producer child that names it as parent, is reconstructed from that child's own envelope and shown labeled *derived* rather than left unattributed — real duration data, not a measured boundary; it does not count toward coverage.

> **Coverage boundary:** F5b folds this report's durable data BEFORE F6 commits and F11 delivers — `discovery_diagnosis` through `review` can close by then, but `finalization`'s own duration and the entire `delivery` group (incl. `ci_wait`/`delivery_wait`/`post_ci_remediation`) structurally cannot, in every run. Coverage below is measured against the four applicable groups when one entry path is recorded; a run that explicitly records both `discovery_diagnosis` and `planning` is measured against all five — see `iterate-timings.md` for why.

## Latest run: `iterate-2026-08-25-mission-feed-progress-narration`

- **Timing source:** producer + agent spans (mixed) · **coverage:** 1/4 applicable fold-time groups (+2 derived), 12 spans total — **DEGRADED** (a fold-time-capturable phase is missing)
- **Wall clock (scope through F5b):** 373.8 min (measured)
- **Instrumented:** 315.2 min of wall clock (84.3%)
- **Unattributed:** 58.5 min (15.7%)
- **Invalidation-driven restarts:** 0

### Top-level phases (inclusive / exclusive / % of timing envelope)

| Phase | Inclusive | Exclusive | % of timing envelope |
|---|---:|---:|---:|
| discovery_diagnosis | *not applicable — planning is the recorded entry path* | — | — |
| planning | 288.9 min *(derived — reconstructed from child spans)* | 276.2 min | 80.0% |
| implementation | 21.4 min | 21.4 min | 6.2% |
| verification | 0.0 s *(derived — reconstructed from child spans)* | 0.0 s | 0.0% |
| review | *incomplete* (started, not closed) | — | — |
| finalization | *not reached before F5b fold (structural)* | — | — |
| delivery | *not reached before F5b fold (structural)* | — | — |

### Nested spans

| Span | Parent | Duration | Outcome | Detail |
|---|---|---:|---|---|
| pre_f0_validation | verification | 0.0 s | completed | stage=f0 |
| self_review | review | — | incomplete | — |
| external_review | planning | 5.1 min | completed | provider=openrouter |
| external_review | planning | 3.6 min | completed | provider=openrouter |
| external_review | planning | 1.7 min | completed | provider=openrouter |
| external_review | planning | 2.4 min | completed | provider=openrouter |
| external_review | review | 0.0 s | completed | provider=openrouter |
| external_review | review | 4.9 min | completed | provider=openrouter |

## Rolling comparison (last 10 instrumented runs)

| Phase | Median exclusive | P90 exclusive | Samples |
|---|---:|---:|---:|
| discovery_diagnosis | — | — | 0 |
| planning | 140.0 min | 276.2 min | 2 |
| implementation | 13.6 min | 23.7 min | 10 |
| verification | 0.0 s | 0.0 s | 6 |
| review | — | — | 0 |
| finalization | — | — | 0 |
| delivery | — | — | 0 |

## Run history

| Run | Wall | Instrumented | Group coverage | Restarts | Status |
|---|---:|---:|---:|---:|---|
| `iterate-2026-08-22-npx-bin-main-guard` | 21.4 min | 12.4% | 1/5 | 0 | degraded |
| `iterate-2026-08-22-npx-coldstart-robustness` | 23.7 min | 20.8% | 1/5 | 0 | degraded |
| `iterate-2026-08-22-bootstrapper-prereq-detection` | 28.7 min | 23.5% | 1/5 | 0 | degraded |
| `iterate-2026-08-22-readiness-gate-fixes` | 46.6 min | 51.2% | 1/5 | 0 | degraded |
| `iterate-2026-08-22-mission-feed-fixes` | 85.8 min | 36.0% | 1/4 | 0 | degraded |
| `iterate-2026-08-23-readiness-path-welcome-copy` | 24.1 min | 30.6% | 1/5 | 0 | degraded |
| `iterate-2026-08-24-wizard-new-door-back-button` | 52.0 min | 28.2% | 1/5 | 0 | degraded |
| `iterate-2026-08-24-bootstrapper-swap-prerelease` | 17.3 min | 78.2% | 1/5 | 0 | degraded |
| `iterate-2026-08-24-terminal-readonly-scroll-copy` | 48.5 min | 28.4% | 1/5 | 0 | degraded |
| `iterate-2026-08-25-mission-feed-progress-narration` | 373.8 min | 84.3% | 1/4 | 0 | degraded |
