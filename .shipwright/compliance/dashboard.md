# Compliance Dashboard

Generated: 2026-05-23T21:20:26.219746+00:00
Profile: vite-hono
Scope: full_app

## Quality Indicators

| Metric | Value | Status | Why warn? |
|--------|-------|--------|-----------|
| Pipeline phases completed | n/a (adopted) | INFO |  |
| Work events (iterate) | 78 changes | INFO |  |
| All unit tests passing | 1066/1066 | PASS |  |
| Architecture decisions | 121 ADRs | INFO |  |
| Iterate tests passing | 59/78 iterations tested | WARN | 19 iterate(s) without tests — see test-evidence.md |
| Dependencies | 55 packages | INFO |  |
| Copyleft risk | 0 | PASS |  |
| Triage open | 0 open | PASS |  |

## Project Velocity

- Iterate: 78 changes (2026-05-01 → 2026-05-23)
- Last activity: 2026-05-23

## External LLM Review Evidence

| Split | Status | Provider | Findings | Self-review fallback | Reason |
|-------|--------|----------|----------|----------------------|--------|
| 01-adopted | missing | — | 0 | no | — |
| adr | missing | — | 0 | no | — |

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

