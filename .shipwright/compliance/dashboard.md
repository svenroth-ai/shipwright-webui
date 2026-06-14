# Compliance Dashboard

Generated: 2026-06-14T21:46:02.492816+00:00
Profile: vite-hono
Scope: full_app

## Quality Indicators

| Metric | Value | Status | Why warn? |
|--------|-------|--------|-----------|
| Pipeline phases completed | n/a (adopted) | INFO |  |
| Work events (iterate) | 155 changes | INFO |  |
| All unit tests passing | 1668/1668 | PASS |  |
| Architecture decisions | 168 ADRs | INFO |  |
| Iterate tests passing | 79/155 iterations tested | WARN | 76 iterate(s) without tests — see test-evidence.md |
| Dependencies | 65 packages | INFO |  |
| Copyleft risk | 0 | PASS |  |
| Triage open | 2 open | WARN | 2 actionable item(s) — see ../agent_docs/triage_inbox.md |
| Bloat over-limit | 80 | WARN | 80 file(s) past limit AND not ADR-justified — see shipwright_bloat_baseline.json |
| Bloat in allowlist | 85 entries | INFO |  |
| Bloat ratchet delta | -322 lines | PASS |  |

## Project Velocity

- Iterate: 155 changes (2026-05-01 → 2026-06-14)
- Last activity: 2026-06-14

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

