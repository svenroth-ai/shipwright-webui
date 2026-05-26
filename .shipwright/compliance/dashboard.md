# Compliance Dashboard

Generated: 2026-05-26T22:29:33.024406+00:00
Profile: vite-hono
Scope: full_app

## Quality Indicators

| Metric | Value | Status | Why warn? |
|--------|-------|--------|-----------|
| Pipeline phases completed | n/a (adopted) | INFO |  |
| Work events (iterate) | 89 changes | INFO |  |
| All unit tests passing | 1274/1274 | PASS |  |
| Architecture decisions | 124 ADRs | INFO |  |
| Iterate tests passing | 65/89 iterations tested | WARN | 24 iterate(s) without tests — see test-evidence.md |
| Dependencies | 55 packages | INFO |  |
| Copyleft risk | 0 | PASS |  |
| Triage open | 0 open | PASS |  |
| Bloat over-limit | 78 | WARN | 78 file(s) past limit AND not ADR-justified — see shipwright_bloat_baseline.json |
| Bloat in allowlist | 79 entries | INFO |  |
| Bloat ratchet delta | +116 lines | WARN | grandfathered surface ratcheted up by 116 line(s) — Iron Law violation |

## Project Velocity

- Iterate: 89 changes (2026-05-01 → 2026-05-26)
- Last activity: 2026-05-26

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

