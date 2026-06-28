# Compliance Dashboard

Generated: 2026-06-28T19:58:45.050449+00:00
Profile: vite-hono
Scope: full_app

## ✅ Control Verdict

> **Under full control. Primarily capped by requirement traceability.**

### Control Grade: **A** (98/100) — Under full control.

| | Dimension | Signal | Anchor |
|---|-----------|--------|--------|
| ✅ | Requirement traceability | 41/41 FRs covered; 223/247 changes traced (FR-linked or classified no-FR) | requirement-to-work traceability (DO-178C, IEC 62304) |
| ✅ | Test health | latest full suite 3464/3464 (2026-06-28) | automated tests pass (OpenSSF Scorecard) |
| ✅ | Change traceability | 247/247 changes linked to a commit, ADR or test run | change provenance (SLSA, OpenSSF Scorecard) |
| ✅ | Change reconciliation | 0/22 behavior-touched FRs not re-verified | re-verify changed requirements (DO-178C, ISO 26262) |
| n/a | Security | no trustworthy local scan (see CI security gate) | no open high/critical vulns (NIST SSDF, OWASP) |
| ✅ | Size / maintainability discipline | ratchet delta -541 lines (net growth) | size/maintainability discipline (ISO/IEC 25010) |
| ✅ | Dependency hygiene | 0 unresolved / 66 licenses; 0 copyleft | dependency license & risk (OWASP, OpenSSF Scorecard) |

Verified from: `shipwright_events.jsonl (247 events, 2026-05-01 → 2026-06-28)`

_Grade = importance-weighted average over the measurable dimensions (n/a excluded from the denominator), modeled on OpenSSF Scorecard. Age is neutral; only unreconciled change and net growth are control failures. Each Anchor names the open standard the dimension follows — see the guide's Control-Grade dimensions table._

## 🛡️ CI Security (fail-closed gate)

_CI security results not yet ingested. Run `refresh_ci_security.py` (auto-run by `update_compliance.py`) to pull the latest `security.yml` scan._

## Quality Indicators

| Metric | Value | Status | Why warn? |
|--------|-------|--------|-----------|
| Pipeline phases completed | n/a (adopted) | INFO |  |
| Work events (iterate) | 177 changes | INFO |  |
| Recent changes traced to an FR | 22/30 (73%) | PASS |  |
| All unit tests passing | 3464/3464 | PASS |  |
| Architecture decisions | 200 ADRs | INFO |  |
| Iterate tests passing | 89/177 iterations tested | WARN | 88 iterate(s) without tests — see test-evidence.md |
| Dependencies | 66 packages | INFO |  |
| Copyleft risk | 0 | PASS |  |
| Triage open | 2 open | WARN | 2 actionable item(s) — see ../agent_docs/triage_inbox.md |
| Bloat over-limit | 80 | WARN | 80 file(s) past limit AND not ADR-justified — see shipwright_bloat_baseline.json |
| Bloat in allowlist | 85 entries | INFO |  |
| Bloat ratchet delta | -541 lines | PASS |  |

## Project Velocity

- Iterate: 177 changes (2026-05-01 → 2026-06-28)
- Last activity: 2026-06-28

## External LLM Review Evidence

| Split | Status | Provider | Findings | Self-review fallback | Reason |
|-------|--------|----------|----------|----------------------|--------|
| 01-adopted | missing | — | 0 | no | — |
| adr | missing | — | 0 | no | — |
| campaigns | missing | — | 0 | no | — |

## 🔎 Consistency Audit

_Detective cross-artifact audit not run this session — run `/shipwright-compliance` to refresh._

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

