# Compliance Dashboard

Generated: 2026-09-01T07:41:52.552221+00:00
Source-State: run=iterate-2026-09-01-trusted-publish-workflow base=23fbba76ee94 release=v0.26.0
Consistency-audit: last full run 2026-08-31 (1 day earlier) — PASS; latest 2026-08-31 partial (groups B)
Profile: vite-hono
Scope: full_app

## ✅ Control Verdict

> **Under full control. Primarily capped by requirement traceability.**

### Control Grade: **A** (97/100) — Under full control.

| | Dimension | Signal | Anchor |
|---|-----------|--------|--------|
| ✅ | Requirement traceability | 28/31 FRs covered; 419/443 changes traced (FR-linked or classified no-FR) | requirement-to-work traceability (ISO/IEC/IEEE 29148) |
| ✅ | Test health | latest full suite 7376/7379 (2026-08-31) | automated tests pass (OpenSSF Scorecard) |
| ✅ | Change traceability | 443/443 changes linked to a commit, ADR or test run | change provenance (SLSA) |
| ✅ | Change reconciliation | 1/27 behavior-touched FRs not re-verified | re-verify changed requirements (ISO/IEC/IEEE 12207) |
| ✅ | Security | 0 open high/critical | no open high/critical vulns (NIST SSDF) |
| ✅ | Size / maintainability discipline | ratchet delta -242 lines (net growth) | no unchecked code-size growth (ISO/IEC 25010) |
| ✅ | Dependency hygiene | 0 unresolved / 73 licenses; 0 copyleft | dependency license & risk (OWASP) |

> 📊 **Test-Health · diff-coverage (Control-Grade input · target ≥80%):** not measured this session — per-PR signal; see the CI "Diff coverage" artifact.

Verified from: `shipwright_events.jsonl (443 events, 2026-05-01 → 2026-09-01)`

_Grade = importance-weighted average over the measurable dimensions (n/a excluded from the denominator), modeled on OpenSSF Scorecard. Age is neutral; only unreconciled change and net growth are control failures. Each Anchor names the open standard the dimension follows — see the guide's Control-Grade dimensions table._

## 🛡️ CI Security (fail-closed gate)

Latest scan: **2026-08-31** · source `security.yml#33392883312` · critical-gate **✅ PASS**

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 5 |
| Low | 1 |

Prompt-injection findings: **0**

**Accepted risks** (`shipwright_accepted_risks.yaml` register):

| ID | Target | Expires | Status | Recorded under |
|----|--------|---------|--------|----------------|
| ar-2026-07-28-hono-node-server-serve-static-windows | trivy-ignore | 2026-10-28 | active | iterate-2026-07-28-security-accepted-risk-register |
| ar-2026-07-28-react-router-rsc-csrf | trivy-ignore | 2027-01-28 | active | iterate-2026-07-28-security-accepted-risk-register |
| ar-2026-07-18-gh-owned-action-mutable-tags | trivy-ignore | 2027-07-18 | active | iterate-2026-07-18-unpin-actions-no-dependabot |

**Inline suppressions** (`# nosemgrep`, anti-ratchet baseline):

| Rule | Sites | Baseline | Recorded under |
|------|-------|----------|----------------|
| `generic.unicode.security.bidi.contains-bidirectional-characters` | 1 | ❌ none | — |
| `javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp` | 3 | ❌ none | — |
| `javascript.lang.security.audit.spawn-shell-true.spawn-shell-true` | 3 | ❌ none | — |
| `python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected` | 1 | ❌ none | — |

_Inline suppressions are deliberately **not** tracked in the accepted-risk register: an offline reconciler would have to mirror the scanner's own suppression semantics and would drift, and a re-review date does not fit a permanent false positive at a fixed source site. The control is the anti-ratchet above — the count cannot grow without a recorded decision. This is visibility, **not** per-site review: unlike a register entry, no site here carries an owner or a re-review date._

_Ingested from CI `findings.json` (public-safe: severity counts + gate verdict only — no finding detail). The local `.shipwright/securityreports/` is intentionally **not** used (stale/FP-laden). Open high/critical feed the Control Grade's Security dimension._

## Quality Indicators

| Metric | Value | Status | Why warn? |
|--------|-------|--------|-----------|
| Pipeline phases completed | n/a (adopted) | INFO |  |
| Work events (iterate) | 373 changes | INFO |  |
| Recent changes traced to an FR | 22/30 (73%) | INFO | feature vs. maintenance mix — informational, does not affect the Control Grade |
| All unit tests passing | 7376/7379 | WARN | 3/7379 not green in last full suite — see test-evidence.md; +1 change(s) since last full suite |
| Architecture decisions | 294 ADRs | INFO |  |
| Iterate tests passing | 170/251 testable changes tested | WARN | 81 testable change(s) without tests — see test-evidence.md |
| Dependencies | 73 packages | INFO |  |
| Copyleft risk | 0 | PASS |  |
| Triage open | 7 open | WARN | 7 actionable item(s) — see ../agent_docs/triage_inbox.md |
| Bloat over-limit (grandfathered) | 92 | INFO |  |
| Bloat in allowlist | 107 entries | INFO |  |
| Bloat ratchet delta | -242 lines | PASS |  |

## Project Velocity

- Iterate: 373 changes (2026-05-01 → 2026-09-01)
- Last activity: 2026-09-01

## External LLM Review Evidence

| Split | Status | Provider | Findings | Self-review fallback | Reason |
|-------|--------|----------|----------|----------------------|--------|
| 01-adopted | missing | — | 0 | no | — |
| adr | missing | — | 0 | no | — |
| campaigns | missing | — | 0 | no | — |

## 🔎 Consistency Audit

**Last full run 2026-08-31 (1 day earlier): PASS** · 53 checks — 41 pass, 0 fail, 12 skip.

Since then the only run was a partial one (2026-08-31 (1 day earlier), groups B: PASS), which does not re-check the rest of the project.

_On demand by design: the audit has no schedule and no CI trigger, so it never runs on its own, so this date is how far back the last cross-check reaches — anything that drifted after it is unmeasured._

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

