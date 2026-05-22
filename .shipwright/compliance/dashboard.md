# Compliance Dashboard

Generated: 2026-05-22T12:48:42.323451+00:00
Profile: vite-hono
Scope: full_app

## Quality Indicators

| Metric | Value | Status | Why warn? |
|--------|-------|--------|-----------|
| Pipeline phases completed | n/a (adopted) | INFO |  |
| Work events (iterate) | 61 changes | INFO |  |
| All unit tests passing | 2198/2198 | PASS |  |
| Architecture decisions | 113 ADRs | INFO |  |
| Iterate tests passing | 58/61 iterations tested | WARN | 3 iterate(s) without tests — see test-evidence.md |
| Dependencies | 55 packages | INFO |  |
| Copyleft risk | 0 | PASS |  |
| Triage open | 3 open | WARN | 3 actionable item(s) — see ../agent_docs/triage_inbox.md |

## Project Velocity

- Iterate: 61 changes (2026-05-01 → 2026-05-22)
- Last activity: 2026-05-22

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

