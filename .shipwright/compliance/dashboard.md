# Compliance Dashboard

Generated: 2026-05-30T08:05:50.314619+00:00
Profile: vite-hono
Scope: full_app

## Quality Indicators

| Metric | Value | Status | Why warn? |
|--------|-------|--------|-----------|
| Pipeline phases completed | n/a (adopted) | INFO |  |
| Work events (iterate) | 93 changes | INFO |  |
| All unit tests passing | 1331/1331 | PASS |  |
| Architecture decisions | 124 ADRs | INFO |  |
| Iterate tests passing | 66/93 iterations tested | WARN | 27 iterate(s) without tests — see test-evidence.md |
| Dependencies | 55 packages | INFO |  |
| Copyleft risk | 0 | PASS |  |
| Triage open | 0 open | PASS |  |
| Bloat over-limit | 78 | WARN | 78 file(s) past limit AND not ADR-justified — see shipwright_bloat_baseline.json |
| Bloat in allowlist | 81 entries | INFO |  |
| Bloat ratchet delta | +0 lines | PASS |  |

## Project Velocity

- Iterate: 93 changes (2026-05-01 → 2026-05-30)
- Last activity: 2026-05-30

## External LLM Review Evidence

| Split | Status | Provider | Findings | Self-review fallback | Reason |
|-------|--------|----------|----------|----------------------|--------|
| 01-adopted | missing | — | 0 | no | — |
| adr | missing | — | 0 | no | — |
| campaigns | missing | — | 0 | no | — |

## Compliance Artifacts

| Document | Path | Description |
|----------|------|-------------|
| Event Log | [shipwright_events.jsonl](../../shipwright_events.jsonl) | Unified append-only event log |
| Traceability Matrix | [traceability-matrix.md](./traceability-matrix.md) | Requirements → Work Events → Tests |
| Test Evidence | [test-evidence.md](./test-evidence.md) | Test progression timeline |
| Commit Change Log | [change-history.md](./change-history.md) | Conventional Commits by type |
| Decision Log | [decision_log.md](../agent_docs/decision_log.md) | Architecture decisions (ADRs) |
| SBOM | [sbom.md](./sbom.md) | Open-source dependencies + licenses |
| Changelog | [CHANGELOG.md](../../CHANGELOG.md) | Release notes |

