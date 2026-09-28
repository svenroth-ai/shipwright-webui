# Iterate throughput

> Derived report — reproducible entirely from `shipwright_events.jsonl`. Not an agent startup input; regenerated at F5b. A missing applicable agent mark is shown as *unattributed* with a reason, never as zero duration; the two structurally-limited groups (`finalization`, `delivery`) are labeled separately — see the Coverage boundary note below.

> **Derived spans:** a fold-time-capturable group with no agent start/end mark, but at least one producer child that names it as parent, is reconstructed from that child's own envelope and shown labeled *derived* rather than left unattributed — real duration data, not a measured boundary; it does not count toward coverage.

> **Coverage boundary:** F5b folds this report's durable data BEFORE F6 commits and F11 delivers — `discovery_diagnosis` through `review` can close by then, but `finalization`'s own duration and the entire `delivery` group (incl. `ci_wait`/`delivery_wait`/`post_ci_remediation`) structurally cannot, in every run. Coverage below is measured against the four applicable groups when one entry path is recorded; a run that explicitly records both `discovery_diagnosis` and `planning` is measured against all five — see `iterate-timings.md` for why.

## Latest run: `iterate-2026-09-28-codextender-auto-mode-server`

**Pre-instrumentation run** — no `iterate_timings` recorded (predates this measurement). Not zero duration; simply not measured.

## Rolling comparison (last 10 instrumented runs)

| Phase | Median exclusive | P90 exclusive | Samples |
|---|---:|---:|---:|
| discovery_diagnosis | — | — | 0 |
| planning | 9.0 s | 2.5 min | 3 |
| implementation | 15.0 min | 62.6 min | 7 |
| verification | 0.0 s | 0.0 s | 8 |
| review | 0.0 s | — | 1 |
| finalization | — | — | 0 |
| delivery | — | — | 0 |

## Run history

| Run | Wall | Instrumented | Group coverage | Restarts | Status |
|---|---:|---:|---:|---:|---|
| `iterate-2026-09-19-codex-launch-phase-empty` | 12.0 min | 0.0% | 0/5 | 0 | degraded |
| `iterate-2026-09-20-mission-feed-transcript-fidelity` | 153.8 min | 24.1% | 1/5 | 0 | degraded |
| `iterate-2026-09-23-codextender-webui-integration` | 231.7 min | 0.0% | 0/5 | 0 | degraded |
| `iterate-2026-09-24-codextender-review-model-disable` | 13.8 min | 26.8% | 1/5 | 0 | degraded |
| `iterate-2026-09-26-runtime-badge-and-leads-gate` | 39.9 min | 4.4% | 0/4 | 0 | degraded |
| `iterate-2026-09-26-mission-tab-subrunner` | 161.9 min | 39.1% | 1/4 | 0 | degraded |
| `iterate-2026-09-26-codex-model-field-removal` | 35.3 min | 38.0% | 1/5 | 0 | degraded |
| `iterate-2026-09-26-codextender-context-window` | 40.1 min | 69.0% | 1/5 | 0 | degraded |
| `iterate-2026-09-26-agents-md-codex-sync` | 7.0 min | 70.3% | 1/5 | 0 | degraded |
| `iterate-2026-09-28-codextender-auto-mode-server` | — | — | — | — | pre-instrumentation |
