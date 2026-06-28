# Compliance Dashboard

Generated: 2026-06-28T07:25:36.473436+00:00
Profile: vite-hono
Scope: full_app

## ✅ Control Verdict

> **Under full control. Primarily capped by requirement traceability.**

### Control Grade: **A** (95/100) — Under full control.

| | Dimension | Signal | Anchor |
|---|-----------|--------|--------|
| ⚠️ | Requirement traceability | 41/41 FRs covered; 157/246 changes FR-tagged | DO-178C §11.9 / IEC 62304 / ALM RTM |
| ✅ | Test health | latest full suite 3464/3464 (2026-06-28) | coverage gating (SonarQube 'Sonar Way') |
| ✅ | Change traceability | 246/246 changes linked to a commit, ADR or test run | SLSA provenance / OpenSSF Code-Review |
| n/a | Change reconciliation | not measurable — needs per-change behavior-impact (BP-2) | ALM suspect-links + DO-178C/ISO 26262 re-verification |
| n/a | Security | no trustworthy local scan (see CI security gate) | NIST SSDF (SP 800-218) / OWASP / OpenSSF |
| ✅ | Size / maintainability discipline | ratchet delta -541 lines (net growth) | ISO 25010 maintainability / SonarQube |
| ✅ | Dependency hygiene | 0 unresolved / 66 licenses; 0 copyleft | OWASP A06:2021 / OpenSSF Scorecard |

Verified from: `shipwright_events.jsonl (246 events, 2026-05-01 → 2026-06-28)`

_Grade = importance-weighted average over the measurable dimensions (n/a excluded from the denominator), in Anlehnung an OpenSSF Scorecard. Age is neutral; only unreconciled change and net growth are control failures._

## Quality Indicators

| Metric | Value | Status | Why warn? |
|--------|-------|--------|-----------|
| Pipeline phases completed | n/a (adopted) | INFO |  |
| Work events (iterate) | 176 changes | INFO |  |
| All unit tests passing | 3464/3464 | PASS |  |
| Architecture decisions | 200 ADRs | INFO |  |
| Iterate tests passing | 88/176 iterations tested | WARN | 88 iterate(s) without tests — see test-evidence.md |
| Dependencies | 66 packages | INFO |  |
| Copyleft risk | 0 | PASS |  |
| Triage open | 2 open | WARN | 2 actionable item(s) — see ../agent_docs/triage_inbox.md |
| Bloat over-limit | 80 | WARN | 80 file(s) past limit AND not ADR-justified — see shipwright_bloat_baseline.json |
| Bloat in allowlist | 85 entries | INFO |  |
| Bloat ratchet delta | -541 lines | PASS |  |

## Project Velocity

- Iterate: 176 changes (2026-05-01 → 2026-06-28)
- Last activity: 2026-06-28

## External LLM Review Evidence

| Split | Status | Provider | Findings | Self-review fallback | Reason |
|-------|--------|----------|----------|----------------------|--------|
| 01-adopted | missing | — | 0 | no | — |
| adr | missing | — | 0 | no | — |
| campaigns | missing | — | 0 | no | — |

## 🔎 Consistency Audit

Detective audit (2026-05-22): **FAIL — drift found** · 51 checks — 38 pass, 4 fail, 9 skip.

_Inlined from `audit-report.json` (a gitignored transient — no external link, so this stays visible on the public repo)._

## Compliance Artifacts

| Document | Path | Description |
|----------|------|-------------|
| Event Log | [shipwright_events.jsonl](../../shipwright_events.jsonl) | Unified append-only event log |
| Traceability Matrix | [traceability-matrix.md](./traceability-matrix.md) | Requirements → Work Events → Tests |
| Test Evidence | [test-evidence.md](./test-evidence.md) | Test progression timeline |
| Commit Change Log | [change-history.md](./change-history.md) | Conventional Commits by type |
| Decision Log | [decision_log.md](../agent_docs/decision_log.md) | Architecture decisions (ADRs) |
| SBOM | [sbom.md](./sbom.md) | Open-source dependencies + licenses |
| Activity Dashboard | [build_dashboard.md](../agent_docs/build_dashboard.md) | Per-event change history + pipeline status |
| Changelog | [CHANGELOG.md](../../CHANGELOG.md) | Release notes |

