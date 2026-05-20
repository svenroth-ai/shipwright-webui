# Skill Compliance Report

_Regenerated 2026-05-07T19:18:15+00:00 from last 10 run(s)._

| Phase | Run | Audited | Source | PASS | FAIL | WARN | SKIP |
|---|---|---|---|---:|---:|---:|---:|
| iterate | `unknown` | 2026-05-07T19:18:15+00:00 | iterate | 6 | 2 | 2 | 10 |
| project | `unknown` | 2026-05-07T19:18:13+00:00 | orchestrator | 6 | 3 | 2 | 2 |
| plan | `unknown` | 2026-05-07T19:18:13+00:00 | orchestrator | 3 | 2 | 1 | 1 |
| deploy | `unknown` | 2026-05-07T19:18:13+00:00 | orchestrator | 1 | 2 | 1 | 2 |
| compliance | `unknown` | 2026-05-07T19:18:13+00:00 | orchestrator | 1 | 1 | 2 | 3 |
| security | `unknown` | 2026-05-07T19:18:13+00:00 | orchestrator | 0 | 2 | 2 | 3 |
| changelog | `unknown` | 2026-05-07T19:18:13+00:00 | orchestrator | 3 | 0 | 1 | 3 |
| build | `unknown` | 2026-05-07T19:18:13+00:00 | orchestrator | 3 | 2 | 1 | 6 |
| test | `unknown` | 2026-05-07T19:18:13+00:00 | orchestrator | 1 | 1 | 1 | 4 |
| adopt | `unknown` | 2026-05-07T19:18:13+00:00 | orchestrator | 8 | 1 | 2 | 1 |

## iterate — unknown (2026-05-07T19:18:15+00:00)

### canon
- **C1** — FAIL: no phase_completed event for phase=iterate
- **C2** — PASS: 'iterate' found in build_dashboard.md
- **C3** — WARN: stale: mtime age 21466s > 600s
- **C4** — PASS: 5 ADR(s) referencing 'iterate'
- **C5** — FAIL: [Unreleased]/Added sub-section missing

### workflow
- **W2** — SKIP: complexity=small — external review not required
- **W3** — PASS: work_completed@2026-05-07T13:21:38.107709+00:00, test-evidence.md age 21466s

### infrastructure
- **I1** — SKIP: no phase_completed event for phase=iterate — freshness not verifiable yet
- **I2** — SKIP: no phase_started event for phase=iterate — freshness not verifiable yet
- **I3** — SKIP: no phase_started event for phase=iterate — freshness not verifiable yet
- **I4** — SKIP _(tier-2)_: no dependency manifest (pyproject.toml/package.json/requirements.txt) — SBOM not applicable

### traceability
- **T1** — SKIP: no FRs found under .shipwright/planning/*/spec.md — nothing to map
- **T2** — SKIP _(tier-2)_: no spec FRs found — no baseline to detect orphans

### quality
- **Q1** — PASS _(tier-2)_: ADR-074: Context=940, Decision=837, Consequences=930

### spec
- **S2** — SKIP: complexity=small — iterate spec not required below medium
- **S3** — SKIP _(tier-2)_: complexity=small — mini-plan not required below medium
- **S4** — SKIP _(tier-2)_: no recent spec history — nothing to compare
- **S5** — WARN _(tier-2)_: 29 missing both: .shipwright/planning/01-adopted/spec.md::FR-01.01, .shipwright/planning/01-adopted/spec.md::FR-01.02, .shipwright/planning/01-adopted/spec.md::FR-01.03 (+26)
- **S9** — PASS _(tier-2)_: README.md touched in last 10 commit(s)
- **S10** — PASS _(tier-2)_: new top-level dir(s) ['CHANGELOG-unreleased.d', 'docs'] present but CLAUDE.md was touched recently

## project — unknown (2026-05-07T19:18:13+00:00)

### canon
- **C1** — FAIL: no phase_completed event for phase=project
- **C2** — PASS: 'project' found in build_dashboard.md
- **C3** — WARN: stale: mtime age 21466s > 600s
- **C4** — PASS: 7 ADR(s) referencing 'project'
- **C5** — FAIL: [Unreleased]/Added sub-section missing

### traceability
- **T1** — SKIP: no FRs found under .shipwright/planning/*/spec.md — nothing to map
- **T2** — SKIP _(tier-2)_: no spec FRs found — no baseline to detect orphans

### quality
- **Q1** — PASS _(tier-2)_: ADR-074: Context=940, Decision=837, Consequences=930

### spec
- **S1** — FAIL: .shipwright/agent_docs/spec.md missing
- **S5** — WARN _(tier-2)_: 29 missing both: .shipwright/planning/01-adopted/spec.md::FR-01.01, .shipwright/planning/01-adopted/spec.md::FR-01.02, .shipwright/planning/01-adopted/spec.md::FR-01.03 (+26)
- **S6** — PASS: CLAUDE.md present (24771 chars)
- **S7** — PASS _(tier-2)_: Structure block present (92 line(s))
- **S8** — PASS: README.md present (4110 chars)

## plan — unknown (2026-05-07T19:18:13+00:00)

### canon
- **C1** — FAIL: no phase_completed event for phase=plan
- **C2** — PASS: 'plan' found in build_dashboard.md
- **C3** — WARN: stale: mtime age 21466s > 600s
- **C4** — PASS: 2 ADR(s) referencing 'plan'
- **C5** — SKIP: not applicable for phase=plan

### workflow
- **W5** — FAIL: no external_review_state.json under .shipwright/planning/

### quality
- **Q1** — PASS _(tier-2)_: ADR-074: Context=940, Decision=837, Consequences=930

## deploy — unknown (2026-05-07T19:18:13+00:00)

### canon
- **C1** — FAIL: no phase_completed event for phase=deploy
- **C2** — PASS: 'deploy' found in build_dashboard.md
- **C3** — WARN: stale: mtime age 21466s > 600s
- **C4** — SKIP: not applicable for phase=deploy
- **C5** — FAIL: [Unreleased]/Changed sub-section missing

### workflow
- **W7** — SKIP: no smoke test evidence in deploy_config / test_results / events.jsonl

## compliance — unknown (2026-05-07T19:18:13+00:00)

### canon
- **C1** — FAIL: no phase_completed event for phase=compliance
- **C2** — PASS: 'compliance' found in build_dashboard.md
- **C3** — WARN: stale: mtime age 21466s > 600s
- **C4** — SKIP: not applicable for phase=compliance
- **C5** — SKIP: not applicable for phase=compliance

### workflow
- **Cmp1** — WARN _(tier-2)_: 1 completed phase(s) not mentioned: ['plan']
- **Cmp2** — SKIP: .shipwright/compliance/traceability-matrix.md missing or no coverage row

## security — unknown (2026-05-07T19:18:13+00:00)

### canon
- **C1** — FAIL: no phase_completed event for phase=security
- **C2** — WARN: no mention of 'security' in build_dashboard.md
- **C3** — WARN: stale: mtime age 21466s > 600s
- **C4** — SKIP: not applicable for phase=security
- **C5** — SKIP: not applicable for phase=security

### workflow
- **Sec1** — FAIL: .shipwright/compliance/security-scan-report.md missing
- **Sec2** — SKIP: security-scan-report.md missing — Sec1 covers this

## changelog — unknown (2026-05-07T19:18:13+00:00)

### canon
- **C1** — PASS: found event @ ?
- **C2** — PASS: 'changelog' found in build_dashboard.md
- **C3** — WARN: stale: mtime age 21466s > 600s
- **C4** — SKIP: not applicable for phase=changelog
- **C5** — SKIP: not applicable for phase=changelog

### workflow
- **W6** — PASS: v0.8.1 present in git

### infrastructure
- **I3** — SKIP: no phase_started event for phase=changelog — freshness not verifiable yet

## build — unknown (2026-05-07T19:18:13+00:00)

### canon
- **C1** — FAIL: no phase_completed event for phase=build
- **C2** — PASS: 'build' found in build_dashboard.md
- **C3** — WARN: stale: mtime age 21466s > 600s
- **C4** — PASS: 1 ADR(s) referencing 'build'
- **C5** — FAIL: [Unreleased]/Added sub-section missing

### workflow
- **W1** — SKIP _(tier-2)_: no build work_completed events — TDD order unverifiable

### infrastructure
- **I1** — SKIP: no phase_completed event for phase=build — freshness not verifiable yet
- **I2** — SKIP: no phase_started event for phase=build — freshness not verifiable yet
- **I3** — SKIP: no phase_started event for phase=build — freshness not verifiable yet
- **I4** — SKIP _(tier-2)_: no dependency manifest (pyproject.toml/package.json/requirements.txt) — SBOM not applicable

### quality
- **Q1** — PASS _(tier-2)_: ADR-074: Context=940, Decision=837, Consequences=930
- **Q2** — SKIP: no plan snapshot and no .shipwright/planning/ tree — plan phase has not produced sections yet

## test — unknown (2026-05-07T19:18:13+00:00)

### canon
- **C1** — FAIL: no phase_completed event for phase=test
- **C2** — PASS: 'test' found in build_dashboard.md
- **C3** — WARN: stale: mtime age 21466s > 600s
- **C4** — SKIP: not applicable for phase=test
- **C5** — SKIP: not applicable for phase=test

### workflow
- **W4** — SKIP: coverage.total missing or non-numeric — coverage unverifiable

### infrastructure
- **I2** — SKIP: no phase_started event for phase=test — freshness not verifiable yet

## adopt — unknown (2026-05-07T19:18:13+00:00)

### canon
- **C1** — FAIL: no phase_completed event for phase=adopt
- **C2** — WARN: no mention of 'adopt' in build_dashboard.md
- **C3** — WARN: stale: mtime age 21466s > 600s
- **C4** — PASS: 1 ADR(s) referencing 'adopt'
- **C5** — SKIP: not applicable for phase=adopt

### workflow
- **A1** — PASS: 5 required configs present and valid
- **A2** — PASS: FR found in .shipwright/planning/01-adopted/spec.md
- **A3** — PASS: adoption ADR found
- **A4** — PASS _(tier-2)_: 2 retroactive ADR(s) with substantive Context
- **A5** — PASS _(tier-2)_: review skipped (documented reason present)
- **A7** — PASS: exactly 1 'adopted' event
- **A8** — PASS _(tier-2)_: adopted-baseline.spec.ts present
