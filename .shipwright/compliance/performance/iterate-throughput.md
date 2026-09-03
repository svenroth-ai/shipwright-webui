# Iterate throughput

> Derived report — reproducible entirely from `shipwright_events.jsonl`. Not an agent startup input; regenerated at F5b. A missing applicable agent mark is shown as *unattributed* with a reason, never as zero duration; the two structurally-limited groups (`finalization`, `delivery`) are labeled separately — see the Coverage boundary note below.

> **Derived spans:** a fold-time-capturable group with no agent start/end mark, but at least one producer child that names it as parent, is reconstructed from that child's own envelope and shown labeled *derived* rather than left unattributed — real duration data, not a measured boundary; it does not count toward coverage.

> **Coverage boundary:** F5b folds this report's durable data BEFORE F6 commits and F11 delivers — `discovery_diagnosis` through `review` can close by then, but `finalization`'s own duration and the entire `delivery` group (incl. `ci_wait`/`delivery_wait`/`post_ci_remediation`) structurally cannot, in every run. Coverage below is measured against the four applicable groups when one entry path is recorded; a run that explicitly records both `discovery_diagnosis` and `planning` is measured against all five — see `iterate-timings.md` for why.

## Latest run: `iterate-2026-09-03-bootstrapper-tailscale-probe`

- **Timing source:** producer + agent spans (mixed) · **coverage:** 0/5 applicable fold-time groups (+1 derived), 2 spans total — **DEGRADED** (a fold-time-capturable phase is missing)
- **Wall clock (scope through F5b):** 11.0 min (measured)
- **Instrumented:** 0.0 s of wall clock (0.0%)
- **Unattributed:** 11.0 min (100.0%)
- **Invalidation-driven restarts:** 0

### Top-level phases (inclusive / exclusive / % of timing envelope)

| Phase | Inclusive | Exclusive | % of timing envelope |
|---|---:|---:|---:|
| discovery_diagnosis | *unattributed — no agent start/end marks recorded* | — | — |
| planning | *unattributed — no agent start/end marks recorded* | — | — |
| implementation | *unattributed — no agent start/end marks recorded* | — | — |
| verification | 0.0 s *(derived — reconstructed from child spans)* | 0.0 s | 0.0% |
| review | *unattributed — no agent start/end marks recorded* | — | — |
| finalization | *not reached before F5b fold (structural)* | — | — |
| delivery | *not reached before F5b fold (structural)* | — | — |

### Nested spans

| Span | Parent | Duration | Outcome | Detail |
|---|---|---:|---|---|
| pre_f0_validation | verification | 0.0 s | completed | stage=f0 |

## Rolling comparison (last 10 instrumented runs)

| Phase | Median exclusive | P90 exclusive | Samples |
|---|---:|---:|---:|
| discovery_diagnosis | — | — | 0 |
| planning | 46.2 s | 46.5 s | 2 |
| implementation | 16.4 min | 33.3 min | 7 |
| verification | 0.0 s | 0.0 s | 9 |
| review | 0.0 s | — | 1 |
| finalization | — | — | 0 |
| delivery | — | — | 0 |

## Run history

| Run | Wall | Instrumented | Group coverage | Restarts | Status |
|---|---:|---:|---:|---:|---|
| `iterate-2026-08-31-mission-feed-gaps` | 113.5 min | 27.9% | 1/5 | 0 | degraded |
| `iterate-2026-08-31-markdown-raw-html-passthrough` | 83.8 min | 14.1% | 0/4 | 0 | degraded |
| `iterate-2026-09-01-trusted-publish-workflow` | 34.8 min | 52.0% | 1/5 | 0 | degraded |
| `iterate-2026-09-01-pr-review-glm-model-webui` | 26.7 min | 0.0% | 0/5 | 0 | degraded |
| `iterate-2026-09-01-org-thread-view` | 48.1 min | 20.9% | 1/5 | 0 | degraded |
| `iterate-2026-09-01-lead-question-inbox` | 79.6 min | 20.6% | 1/5 | 0 | degraded |
| `iterate-2026-09-01-lead-board-surface` | 94.9 min | 46.7% | 1/4 | 0 | degraded |
| `iterate-2026-09-02-claim-chip-filter` | 21.6 min | 52.0% | 1/5 | 0 | degraded |
| `iterate-2026-09-03-org-thread-live-source` | 60.7 min | 18.1% | 1/5 | 0 | degraded |
| `iterate-2026-09-03-bootstrapper-tailscale-probe` | 11.0 min | 0.0% | 0/5 | 0 | degraded |
