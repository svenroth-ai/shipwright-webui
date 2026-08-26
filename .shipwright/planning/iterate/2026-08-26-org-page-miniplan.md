# Mini-Plan: org-page

- **Run ID:** iterate-2026-08-26-org-page

> **Revised after Internal Plan Review (opus-plan-reviewer, HIGH) + External
> LLM Review (Branch A, both providers verdict `revise`).** See the iterate
> spec's Design Notes for the full fix rationale per finding; this file
> carries only the resulting work breakdown.

## Chosen Approach

**In-process proxy route on a new `server/src/routes/org.ts`**, built on top
of newly-**extracted pure cores** inside the existing `server/src/external/org/*.ts`
files (not their unexported handler closures, and not their already-exported
leaf-math functions alone — see spec Design Notes for why both of those were
wrong). The existing `/api/external/org/*` family keeps its exact wire
behavior, its host-allowlist + secret gates, and its own tests unmodified.

**Endpoints on the new surface** (host-allowlisted, no secret — see spec):

- `GET /api/org/org-chart` → wraps the extracted `org-chart` core; forwards
  `org_chart_missing` (404) verbatim (the nav-gating signal) and
  `org_chart_invalid`/other errors as a distinct "broken" shape.
- `GET /api/org/leads` → **one composite call**, not N+1: parses the chart
  once, returns `{ leadId, role, now, usage }[]` for the whole roster in one
  response (role sentence, Now-state per the 4-state model, usage payload).
- `PUT /api/org/leads/:leadId/charter` → the ONLY browser write this
  iterate; refuses (403) anything that would resolve to a non-`charter` kind.

**Work breakdown**

1. **Server, part A — extract pure cores (touches existing, tested files).**
   In `org-chart.ts`, `usage.ts`, `last-run.ts`, `beat-register.ts`,
   `file-read.ts`, `file-write.ts`: pull each handler's body into an
   exported function returning `{status, body}` (mirrors `file-write.ts`'s
   private `performWrite`, now exported). `registerXRoute` becomes a thin
   Hono wrapper calling the exported core. Re-run
   `__tests__/routes.test.ts` unmodified — must stay green, proving the
   extraction is behavior-preserving.
2. **Server, part B — canonical types.** `server/src/types/org.ts`:
   `OrgChartView`/`OrgChartLeadView`/`UsageResponse`/`LastRunResponse`/
   `BeatRegisterHealthResponse`/`BeatRegisterEntryView`, declared verbatim
   (not re-exported). Update `external/org/*.ts` to import from here instead
   of declaring inline. `npx tsc --noEmit` (server) must stay clean.
3. **Server, part C — the new router.** `server/src/routes/org.ts`: mounts
   `isAllowedOrgRouteHost` middleware (retained gate), declares its own
   `/api/org/*` paths, calls the part-A cores directly (no HTTP, no
   `registerXRoute` call). Route tests: happy path per endpoint, each error
   shape, the 404-vs-502 distinction, AC-9 (existing family still gated
   after mount), AC-10 (non-charter PUT refused 403).
4. **Client, part A — API layer.** `client/src/lib/orgApi.ts` (typed
   fetchers over `/api/org/*`) + `orgMarkdownFileApi.ts` (mirrors
   `markdownFileApi.ts`) + `org-schema-sync.test.ts` (purpose-built union-arm
   guard — see spec Design Notes; falsify locally before calling it done).
5. **Client, part B — hooks.** `useOrgChartPresence()` (4-state:
   loading/present/absent/broken) + `useOrgRoster()` (wraps `GET
   /api/org/leads`, `staleTime`/`refetchInterval` = `LEADS_USAGE_REFRESH_INTERVAL_MS`).
6. **Approval checkpoint (per the operator's explicit request — unchanged
   in spirit, tightened in what "done" means for it):** build the page
   shell + `.chartwrap` (PO node, connectors, lead cards, disabled ghost
   "add lead" card) + exactly ONE full `.rcard2` lead card (all five
   blocks), wired to real dev-stack data if `leadwright` is installed
   locally, otherwise to a fixture. **The fixture MUST be type-checked
   against the mirrored response types from step 4, and MUST show
   `parallel`/`projects` in their permanent "not measured" state and a
   budget label matching a non-7 `windowDays` value** — a fixture that shows
   invented numbers for those two figures does not satisfy this checkpoint,
   because it would let the operator approve a screenshot real data can
   never reproduce. Run the dev stack, screenshot, send to the operator.
   **Stop and wait for go-ahead before continuing.** If the operator says
   no: the run parks here — nothing past this point merges; re-enter
   planning against the operator's specific objection rather than pushing
   forward.
7. On go-ahead: remaining lead cards (loop over `useOrgRoster()`), the
   `.rost` shared-documents block (GET-only — org-chart.json, conventions.md,
   principal.md, decision_log.md; each tile handles a missing file with a
   visible "not found" row), disabled pause switch + reason tooltip, Docs
   block wiring (charter.md edit via the widened-with-optional-props
   `MarkdownEditorModal`; learnings.md via a read-only markdown viewer;
   audit.jsonl via a bounded/paginated log view), the not-measured contract
   across every block per the Stats source table.
8. Nav: `SidebarNavItem` insertion after Triage in `SidebarNav.tsx`, gated
   on `useOrgChartPresence() === "present" || "broken"`; `router.tsx` route
   + `handle.nav.order`; `CommandCenter.tsx`'s consumption of
   `getNavDestinations()`'s output filtered on the same hook (the pure
   `navDestinations.ts` module itself is untouched). Component test asserts
   both call sites read the same hook instance/signal.
9. Component tests: block-order assertion (not a snapshot), not-measured
   contract incl. always-unmeasured `parallel`/`projects`, usage-fills-
   budget-and-runs with a `windowDays: 30` fixture, disabled switch issues
   no request, 4-state nav-presence at both call sites, missing-shared-doc
   tile state. One E2E flow spec (see step 11 below).
10. **Registries to update in the same commit** (F0 catches these late
    otherwise):
    - `client/src/lib/navDestinations.test.ts` — exact palette label list.
    - `client/src/test/doc-sync.test.ts` `REQUIRED_TOKENS` — new production
      files (`orgApi.ts`, `orgMarkdownFileApi.ts`, `routes/org.ts`,
      `types/org.ts`, the page + card components).
    - `client/src/test/shell-scroll-invariant.test.ts` scroll-owner
      registry — Org is a new scrolling route.
    - CLAUDE.md DO-NOT #12's write-surface enumeration — amend to name the
      new scoped, `If-Match`-gated, kind-narrowed `charter.md` write (it
      currently lists only `sdk-sessions.json` + the two other stubs).
    - `.shipwright/agent_docs/architecture.md` — new route family, new
      page, new nav-conditional pattern (A21 exception, named explicitly),
      new type-mirror pair, the extracted-pure-core pattern in
      `external/org/*`.
11. E2E: seed `SHIPWRIGHT_LEADS_ROOT` (`config.ts:184`) with a committed
    fixture leads root for the "present" arm; unset/empty for the
    "missing" arm. Both arms asserted — falsify by breaking the fixture and
    confirming the present-chart test goes red before trusting it green.

## Alternative Considered (and rejected)

**HTTP-forwarding proxy** — server route makes a real HTTP call to its own
`/api/external/org/*` endpoints over loopback, attaching
`x-shipwright-leads-secret` server-side. Rejected: adds a self-referential
network hop and secret-plumbing for zero behavioral gain over the corrected
in-process approach (extracted pure cores, called directly) — both achieve
byte-identical responses and identical gate coverage, but the HTTP variant
adds latency and a secret-handling surface neither reviewer nor this plan
found any offsetting benefit for.

**A generic browser-authenticated path proxy** (i.e., widen the write
surface to any allowlisted org document, gated by session auth instead of
the secret) — considered after the reviews raised the write-authz concern,
rejected in favor of the narrower `charter.md`-only surface: the ACs only
need charter editing, and a generic writable proxy is exactly the shape
that reached `decision_log.md` unlocked in the original plan. Narrower is
strictly safer here and costs nothing the ACs need.

## Genuine Open Questions — resolved

1. **NOW block "waiting on you"** — resolved: dropped entirely (Running /
   Resting / Needs-attention / Not-measured only), confirmed by the
   operator and independently backed by `leadwright/spec/lead-model-spec.md`
   §4.4/FR-04.19 (the Inbox already owns this concept; a second "waiting"
   vocabulary is the named anti-pattern). See spec Design Notes.
2. **Stats "parallel"/"projects"** — resolved via the source table: neither
   has a data source this iterate (verified against `leadwright/lib/org-chart.ts`
   for `manages`' true meaning — Lead-of-Leads hierarchy, not a project
   list); both render permanently "not measured", stated as an accepted
   scope boundary rather than discovered mid-build.
