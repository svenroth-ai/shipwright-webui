# Mini-Plan: compliance-grade-webui

Run ID: iterate-2026-06-30-compliance-grade-webui · Type: feature · Complexity: medium

## Chosen approach — "parse markdown, render the slice"

WebUI is a read-only observer of `.shipwright/compliance/dashboard.md`. The
server parses the two stable lines (grade + verdict blockquote) + the
`Generated:` timestamp for the pill, and returns the **raw markdown slices** of
the Control-Verdict and CI-Security sections for the modal — rendered by the
already-present `react-markdown` + `remark-gfm` stack (`DocumentMarkdown`). No
re-modeling of the table; no new markdown dependency.

### Files (all < 300 LOC)

**Server**
1. `server/src/core/compliance-reader.ts` — `readCompliance(projectPath, deps?)`
   → discriminated union `{status:"ok", grade, score, verdict, generatedAt,
   controlVerdictMarkdown, ciSecurityMarkdown}` | `{status:"missing"}` |
   `{status:"invalid", reason}`. DI for `readFile` (test seam), mirrors
   `run-config-reader.ts` shape. Section slicing by `^## ` header text-contains
   ("Control Verdict" / "CI Security"), grade regex on the `### Control Grade`
   line, verdict from the `> **…**` blockquote.
2. `server/src/core/compliance-reader.test.ts` — fixture = verbatim copy of the
   real dashboard.md + missing + malformed cases.
3. `server/src/external/compliance/routes.ts` — `createComplianceRouter({getProjectById, readCompliance?})`
   exposing `GET /api/external/projects/:projectId/compliance` (mirrors
   `run-config/routes.ts`: 404 unknown project, 400 path-less).
4. `server/src/external/compliance-route.test.ts` — route-level (ok / missing /
   404 / 400).
5. Wire into `server/src/external/routes.ts` (one `app.route("/", createComplianceRouter(...))`).

**Client**
6. `client/src/lib/complianceApi.ts` — `ComplianceResult` type (mirror of the
   server shape) + `getProjectCompliance(projectId)` fetch wrapper.
7. `client/src/hooks/useProjectCompliance.ts` — TanStack query, 30 s poll,
   `enabled: Boolean(projectId)`, mirrors `useTriage`.
8. `client/src/components/compliance/ComplianceGradeBadge.tsx` — colored pill +
   tooltip (verdict + Generated date); owns its own `useProjectCompliance`;
   renders null on missing/invalid/loading; click opens the modal.
9. `client/src/components/compliance/ComplianceDetailModal.tsx` — Radix Dialog
   (TriageDetailModal pattern); body = `<DocumentMarkdown text={controlVerdict
   + "\n\n" + ciSecurity} />`; header = grade + generated date.
10. `*.test.tsx` for badge (color map + null) + modal (renders table).

**Render sites**
11. `ProjectsPage.tsx` — new "Grade" column (`projects-cell-<id>-grade`).
12. `TaskBoardPage.tsx` — pill in `task-board-header` next to
    `ProjectFilterDropdown`, gated on a single `activeProjectId`.

**Docs / guards**
13. `client/src/test/doc-sync.test.ts` — add tokens `compliance-reader`,
    `complianceApi`, `useProjectCompliance`, `ComplianceGradeBadge`,
    `ComplianceDetailModal`; add matching entries to `component_inventory.md`
    (+ a one-liner in `architecture.md` for the new read-surface + route).
14. `spec.md` (01-adopted) — append FR-01.43 row + ACs.
15. E2E `client/e2e/<n>-compliance-grade.spec.ts`.

## Alternative considered — producer emits `dashboard.json`
Have `shipwright-compliance` write a machine-readable `dashboard.json` so the
webui reads JSON instead of parsing markdown. **Rejected for this iterate:** it
is a cross-repo change to the shipwright monorepo, ships on a different cadence,
and the webui would *still* need a markdown fallback for projects on older
producer versions. Parsing the stable, machine-generated markdown is
self-contained and lands now; a future producer JSON can slot in behind the
same `readCompliance` seam without touching the client.

## Risk / guards
- `touches_public_api` (new route) → mandatory code review.
- Read-only: zero writes under `.shipwright/` (CLAUDE.md rule 12 spirit).
- ADR-080 type isolation: `ComplianceResult` mirrored verbatim server↔client,
  each header naming its canonical origin; no cross-package import.
- Graceful absence everywhere → never a crash / 500 for a project without a
  dashboard.
