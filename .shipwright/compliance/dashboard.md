# Compliance Dashboard

Generated: 2026-07-08T08:42:03.071892+00:00
Profile: vite-hono
Scope: full_app

## ✅ Control Verdict

> **Under full control. Primarily capped by requirement traceability.**

### Control Grade: **A** (98/100) — Under full control.

| | Dimension | Signal | Anchor |
|---|-----------|--------|--------|
| ✅ | Requirement traceability | 43/43 FRs covered; 249/273 changes traced (FR-linked or classified no-FR) | requirement-to-work traceability (ISO/IEC/IEEE 29148) |
| ✅ | Test health | latest full suite 1882/1882 (2026-07-07) | automated tests pass (OpenSSF Scorecard) |
| ✅ | Change traceability | 273/273 changes linked to a commit, ADR or test run | change provenance (SLSA) |
| ✅ | Change reconciliation | 1/24 behavior-touched FRs not re-verified | re-verify changed requirements (ISO/IEC/IEEE 12207) |
| ✅ | Security | 0 open high/critical | no open high/critical vulns (NIST SSDF) |
| ✅ | Size / maintainability discipline | ratchet delta +0 lines (net growth) | no unchecked code-size growth (ISO/IEC 25010) |
| ✅ | Dependency hygiene | 0 unresolved / 67 licenses; 0 copyleft | dependency license & risk (OWASP) |

> 📊 **Test-Health · diff-coverage (Control-Grade input · target ≥80%):** not measured this session — per-PR signal; see the CI "Diff coverage" artifact.

Verified from: `shipwright_events.jsonl (273 events, 2026-05-01 → 2026-07-08)`

_Grade = importance-weighted average over the measurable dimensions (n/a excluded from the denominator), modeled on OpenSSF Scorecard. Age is neutral; only unreconciled change and net growth are control failures. Each Anchor names the open standard the dimension follows — see the guide's Control-Grade dimensions table._

## 🛡️ CI Security (fail-closed gate)

Latest scan: **2026-07-07** · source `security.yml#28854756284` · critical-gate **✅ PASS**

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 2 |

Prompt-injection findings: **0**

_Ingested from CI `findings.json` (public-safe: severity counts + gate verdict only — no finding detail). The local `.shipwright/securityreports/` is intentionally **not** used (stale/FP-laden). Open high/critical feed the Control Grade's Security dimension._

## Quality Indicators

| Metric | Value | Status | Why warn? |
|--------|-------|--------|-----------|
| Pipeline phases completed | n/a (adopted) | INFO |  |
| Work events (iterate) | 203 changes | INFO |  |
| Recent changes traced to an FR | 18/30 (60%) | INFO | feature vs. maintenance mix — informational, does not affect the Control Grade |
| All unit tests passing | 1882/1882 | PASS | +4 change(s) since last full suite |
| Architecture decisions | 228 ADRs | INFO |  |
| Iterate tests passing | 79/127 testable changes tested | WARN | 48 testable change(s) without tests — see test-evidence.md |
| Dependencies | 67 packages | INFO |  |
| Copyleft risk | 0 | PASS |  |
| Triage open | 2 open | WARN | 2 actionable item(s) — see ../agent_docs/triage_inbox.md |
| Bloat over-limit (grandfathered) | 82 | INFO |  |
| Bloat in allowlist | 87 entries | INFO |  |
| Bloat ratchet delta | +0 lines | PASS |  |

## Project Velocity

- Iterate: 203 changes (2026-05-01 → 2026-07-08)
- Last activity: 2026-07-08

## External LLM Review Evidence

| Split | Status | Provider | Findings | Self-review fallback | Reason |
|-------|--------|----------|----------|----------------------|--------|
| 01-adopted | missing | — | 0 | no | — |
| adr | missing | — | 0 | no | — |
| campaigns | missing | — | 0 | no | — |

## 🔎 Consistency Audit

Detective audit (2026-05-22): **PASS** · 21 checks — 14 pass, 0 fail, 7 skip.

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

