# Iterate Spec: compliance-grade-webui

- **Run ID:** iterate-2026-06-30-compliance-grade-webui
- **Type:** feature
- **Complexity:** medium
- **Status:** draft

## Goal
Surface the per-project compliance **Control Grade** (letter + score) and
one-line verdict in the WebUI, with a click-through detail modal that renders
the dashboard's Control-Verdict table + CI-Security block. WebUI stays a
read-only observer of `.shipwright/compliance/dashboard.md` (no JSON exists for
the grade/verdict — they live only in that markdown).

## Acceptance Criteria
- [ ] (A) Given a project whose `<path>/.shipwright/compliance/dashboard.md`
  contains `### Control Grade: **A** (99/100) …`, when the client requests
  `GET /api/external/projects/:id/compliance`, then the response is
  `{status:"ok", grade:"A", score:99, verdict:"<blockquote one-liner>",
  generatedAt:"<iso>", controlVerdictMarkdown:"…", ciSecurityMarkdown:"…"}`.
- [ ] (B) Given a project with **no** dashboard.md, when the same endpoint is
  hit, then it returns `{status:"missing"}` (HTTP 200) and the client renders
  **no** badge (graceful absence).
- [ ] (C) Given a dashboard.md whose grade line is unparseable, then the
  endpoint returns `{status:"invalid", reason}` and the client renders no badge.
- [ ] (D) Given an unknown OR synthesized projectId, the endpoint returns 404
  `{error:"project_not_found"}` (production `getProjectById` returns undefined
  for synthesized rows); a resolvable project with an empty `path` returns 400
  `project_path_unavailable` (defensive branch).
- [ ] (E) `controlVerdictMarkdown` is the slice from the `## … Control Verdict`
  heading up to (excluding) the next `## ` heading; `ciSecurityMarkdown` is the
  `## … CI Security` section. Neither includes the trailing "Compliance
  Artifacts" links table (dead in-browser).
- [ ] (F) The `<ComplianceGradeBadge>` renders a colored pill (A→green, B→amber,
  C-and-below→red) with the verdict + "Generated: <date>" in its tooltip.
- [ ] (G) Clicking the badge opens `<ComplianceDetailModal>` (Radix Dialog)
  whose body renders `controlVerdictMarkdown` + `ciSecurityMarkdown` as GFM
  (dimension table visible); header shows grade + generated date.
- [ ] (H) ProjectsPage shows a new "Grade" column rendering the badge per row;
  TaskBoardPage header renders the badge for the single selected project (hidden
  when "All projects" is active).

## Spec Impact
- **Classification:** add
- **ADD** (new FR appended): FR-01.43 — Compliance Grade surface (badge +
  detail modal), read-only observer of `dashboard.md`.
- **MODIFY:** none
- **REMOVE:** none
- **NONE justification:** n/a

## Out of Scope
- Re-modeling the Dimension/Signal/Anchor table as structured server data
  (we ship the raw markdown slice and render it with the existing
  react-markdown + remark-gfm stack).
- Dumping the whole `dashboard.md` (Quality Indicators / Velocity / Artifacts
  links section) — sliced to the two sections only.
- A single global Sidebar badge (a grade is per-project; can't aggregate).
- A full dedicated Compliance page.
- Asking the `shipwright-compliance` producer to emit `dashboard.json`
  (cross-repo monorepo change).
- Any write into `.shipwright/` (read-only observer).

## Design Notes
{Filled during Design Check (Tier 2).} Badge = small pill mirroring the
`StateBadge`/triage badge visual language; modal mirrors `TriageDetailModal`
(Radix `Dialog.Root/Portal/Overlay/Content`). Body reuses `DocumentMarkdown`
(GFM tables already styled via `.markdown-body`).

## Affected Boundaries

| Producer (writes) | Consumer (reads) | Format |
|---|---|---|
| shipwright-compliance plugin → `.shipwright/compliance/dashboard.md` | `server/src/core/compliance-reader.ts parseDashboard()` | Markdown (GFM) |
| `compliance-reader.ts` (typed result) | `external/compliance/routes.ts` → client `complianceApi.ts` | JSON over HTTP |

The producer is OUT of this repo; we are a read-only consumer of a markdown
artifact. The parse is the boundary — covered by a fixture round-trip test
using a verbatim copy of the real dashboard.md.

## Confidence Calibration
- **Boundaries touched:** markdown parse of dashboard.md → typed result → HTTP.
- **Empirical probes run:**
  - parser run against a verbatim copy of the live `dashboard.md` →
    grade A / score 99 / verdict / generatedAt + correct section slices
    (Artifacts excluded). PASSED.
  - missing-file, grade-absent, empty, no-sections, fenced-`##`, and
    leading-whitespace inputs → graceful `missing`/`invalid`/`ok` (no throw).
    PASSED.
  - full chain seeded E2E (temp project + dashboard → route → reader →
    Projects badge → modal table) against an isolated stack. PASSED (1/1).
- **Test Completeness Ledger:**

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | parseDashboard extracts grade/score/verdict/generatedAt from real fixture | tested | compliance-reader.test.ts |
  | 2 | parseDashboard slices Control-Verdict + CI-Security sections, excludes Artifacts | tested | compliance-reader.test.ts |
  | 3 | missing dashboard → {status:"missing"} | tested | compliance-reader.test.ts |
  | 4 | unparseable grade → {status:"invalid"} | tested | compliance-reader.test.ts |
  | 5 | GET route ok payload for project w/ dashboard | tested | compliance-route.test.ts |
  | 6 | GET route 404 unknown / 400 path-less project | tested | compliance-route.test.ts |
  | 7 | badge color maps A→green/B→amber/≤C→red | tested | ComplianceGradeBadge.test.tsx |
  | 8 | badge renders nothing on missing/invalid | tested | ComplianceGradeBadge.test.tsx |
  | 9 | click badge → modal renders dimension table markdown | tested | ComplianceDetailModal.test.tsx |
  | 10 | ProjectsPage Grade column + TaskBoard header pill present | tested | E2E (compliance-grade spec) |
  | 11 | exact pixel fidelity of rendered table | untestable | requires-manual-visual-judgment |

- **Confidence-pattern check:** asymptote — no "are you confident?" loop; the
  external review's HIGH (column-0-only `Generated:` regex) was driven to a fix
  + a probe (indented-input test), not asserted away. Breadth — every ledger
  row is `tested`/`untestable`; `untested_testable: 0`.

## Verification (medium+)
- **Surface:** web
- **Runner command:** isolated-stack Playwright spec
  (`client/e2e/<n>-compliance-grade.spec.ts`) against a temp-USERPROFILE Hono +
  Vite, seeded with a project whose path holds a fixture dashboard.md.
- **Evidence path:** `.shipwright/runs/iterate-2026-06-30-compliance-grade-webui/`
- **Justification (only if surface=none):** n/a — web surface exists.
