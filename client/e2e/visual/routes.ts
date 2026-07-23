/*
 * Visual-regression route manifest. iterate-2026-07-10-harness-hardening (A00).
 *
 * ── THE HAND-OFF RULE (read this before you touch a screen) ─────────────────
 * Every later UI sub-iterate that CHANGES a screen must update that screen's
 * baseline **deliberately** and **name the changed routes in its PR body**.
 *
 * A blanket `--update-snapshots` with no route list is a REVIEW FAILURE. The
 * whole point of this gate is that a repaint cannot silently destroy a screen
 * while tsc, lint and vitest all stay green — and a reflex `-u` hands that
 * property straight back.
 *
 * ── WHY A MANIFEST AND NOT JUST THE SPEC FILES ──────────────────────────────
 * Half the surfaces this campaign will gate do not exist yet (the wizard, the
 * Ship's Log, First Contact, the design gate — A08/A14/A15/A16 build them). A
 * bare directory of specs cannot express "this screen is COMING and must be
 * baselined when it lands"; it can only express what someone remembered to add.
 * So each route is explicitly `baselined` or `pending`, `pending` carries the
 * sub-iterate that owes it, and `00-manifest-guard.spec.ts` FAILS if a route is
 * neither. `pending` is therefore visible debt, not a hole.
 */

export type BaselineStatus = "baselined" | "pending";

export interface VisualRoute {
  /** Stable id — also the baseline filename (`<id>.png`). Never rename casually. */
  id: string;
  /** Router path (client/src/router.tsx), or a description for a sub-surface. */
  path: string;
  /** What a human should see here. */
  description: string;
  status: BaselineStatus;
  /** REQUIRED when status is "pending": the sub-iterate that will build + baseline it. */
  owner?: string;
}

export const VISUAL_ROUTES: VisualRoute[] = [
  // ── Baselined now: every route that exists today (client/src/router.tsx) ──
  {
    id: "board",
    path: "/",
    description: "TaskBoard — the Kanban columns, seeded with one task per column",
    status: "baselined",
  },
  {
    id: "task-detail-mission",
    path: "/tasks/:taskId (Mission tab, DONE state)",
    description:
      "TaskDetail, Mission tab (done) — A13's three equal-height glass cards on the photo (scrim removed): 'The Record' rail (A11) · the Operation card (A12) · the Artifact card. Restyled top row (Board › Project both-clickable breadcrumb) + the segmented Mission | Files & Terminal switch with the glass 'Open Ship's Log' button. A seeded task joins to no run, so the verdict is the honest 'No run data yet', never a false ALL CLEAR. The artifact-open + rail-collapsed states + the 1440 no-clip + equal-height are covered functionally (layout-measured) in flows/A13-mission-shell.spec.ts.",
    status: "baselined",
  },
  {
    id: "task-detail-mission-live",
    path: "/tasks/:taskId (Mission tab, LIVE state)",
    description:
      "TaskDetail, Mission tab (mid-run) — the Record rail shows a `now` frontier and the Operation card renders its live layout (A12, AC6), inside A13's three-card shell + restyled top row / tab row. Baseline generated in the pinned CI container.",
    status: "baselined",
  },
  {
    id: "task-detail-terminal",
    path: "/tasks/:taskId (Files & Terminal tab)",
    description:
      "TaskDetail, Files & Terminal — the tab row changes (A13's segmented switch + Ship's Log button); the pty surface itself is MASKED (not deterministic).",
    status: "baselined",
  },
  {
    id: "projects",
    path: "/projects",
    description: "Projects list with one seeded project",
    status: "baselined",
  },
  { id: "inbox", path: "/inbox", description: "Inbox — empty state", status: "baselined" },
  {
    id: "inbox-populated",
    path: "/inbox (populated — mid-run questions on the neutral sub-panel)",
    description:
      "Inbox with pending mid-run questions (A19, FR-01.63): the repainted card anatomy (amber strip · context pill · time-ago · glossed eyebrow · question · rationale · read-only Options: line) on the §5.2 SOLID neutral sub-panel, each card carrying the 'Answer in the terminal' navigation CTA + the honesty line (the WebUI does not answer for you). Captured by e2e/visual/09-inbox-populated.spec.ts. Baseline rendered in the pinned CI container (A00 bootstrap path).",
    status: "baselined",
  },
  { id: "triage", path: "/triage", description: "Triage list", status: "baselined" },
  { id: "settings", path: "/settings", description: "Settings", status: "baselined" },
  {
    id: "diagnostics",
    path: "/diagnostics",
    description: "Diagnostics — CLI compat banner + environment",
    status: "baselined",
  },

  // ── Pending: surfaces this campaign BUILDS. They do not exist yet; the owning
  //    sub-iterate must flip these to "baselined" in the same PR that ships them.
  // A08 (FR-01.51) — the Intent Wizard's three entry screens. Baselined by the
  // A08 PR (PNGs bootstrapped by the CI visual gate, then committed). The
  // not-ready readiness gate is unit-tested, not screenshotted (it depends on
  // the runner's toolchain); the picker shot pins readiness READY.
  {
    id: "wizard",
    path: "/wizard",
    description: "Intent wizard — the three-door picker (readiness pinned ready)",
    status: "baselined",
  },
  {
    id: "wizard-adopt",
    path: "/wizard/adopt",
    description: "Intent wizard — adopt door, step 1 (repo pick)",
    status: "baselined",
  },
  {
    id: "wizard-grade",
    path: "/wizard/grade",
    description:
      "Intent wizard — grade door: the REAL Control-Grade result card, rendered from a deterministic /api/wizard/grade fixture (A09b)",
    status: "baselined",
  },
  {
    id: "design-gate",
    path: "/tasks/:taskId (Mission tab, DESIGNGATE state)",
    description:
      "Design gate AS the Mission view (A14, FR-01.58) — A13's three-card shell in `designgate` mode: the Record rail with the Design node `now`, the gallery of pending screens (real hosted-preview iframes + FR id + name) in the middle `.mc-op` card, and the Approve / Request-changes decision bar with the 'Waiting on you' badge at its foot. The header CTA is suppressed so Approve is the sole primary (AC4). Baseline generated by the CI visual gate; the gate signal + manifest + screens are intercepted for determinism.",
    status: "baselined",
  },
  {
    id: "ships-log",
    path: "/projects/:projectId/log",
    description:
      "Ship's Log project home (A16, FR-01.60) — the Captain's Drawer grade strip (ring + inline sub-scores + 'Why an A?'), the scoped-iterate promptbox + graduation card, and the logbook sheet (one entry per run). Seeded with a graded project + a run so the drawer + a logbook row render; captured by e2e/visual/07-ships-log.spec.ts.",
    status: "baselined",
  },
  {
    id: "first-contact",
    path: "/first-contact",
    description:
      "First Contact hero (iterate-2026-07-23) — the lighthouse plate + 'Welcome to the Command Center / Say what you want.' promise + the three reused doors + readiness gate. The fresh-install first screen; captured by e2e/visual/11-first-contact.spec.ts with readiness pinned READY. Baseline rendered in the pinned CI container.",
    status: "baselined",
  },
  // A17 (FR-01.61) — the launch state machine now HAS pixels. The A17 runner is
  // on Windows (its locally-rendered PNGs never match the Linux gate), so these
  // are `pending` until the orchestrator's pinned-container `visual-baselines.yml`
  // run generates + commits the PNGs and flips them to `baselined`. Captured by
  // e2e/visual/08-launch-states.spec.ts.
  {
    id: "board-launch-failed",
    path: "/ (draft campaign card + a launch_failed task card)",
    description:
      "Board with a DRAFT campaign card (lifecycle badge + Start-Campaign CTA) and a launch_failed task card mounting the persistent LaunchFailureNotice — the two states that were invisible on the board before A17.",
    status: "baselined",
  },
  {
    id: "task-detail-launch-failed",
    path: "/tasks/:taskId (jsonl_missing header notice)",
    description:
      "Task-detail header with the launch-failure notice mounted for a jsonl_missing task: the same words as the board surfaces (AC4), the watched JSONL path, and Resume recovery.",
    status: "baselined",
  },
  // A21 (FR-01.65) — the command palette OPEN state, floating GLASS on the
  // signature backdrop (AC2/AC8). Captured by e2e/visual/10-command-palette.spec.ts
  // (Ctrl+K on the board). The A21 runner is on Windows, so the PNG is generated
  // + committed by the orchestrator's pinned-container run — DO NOT commit a
  // Windows-local PNG (it would never match the Linux gate).
  {
    id: "palette-open",
    path: "/ (command palette open, Ctrl+K)",
    description:
      "The glass command palette open over the board — the A03 glass recipe (--glass-light + --glass-filter + --glass-light-line + --sh-photo) with the backdrop visible through it, the search input, and the grouped Open / Jump / Launch / Filter commands. Proves the palette is glass, not a flat opaque modal (AC2).",
    status: "baselined",
  },
];

/** Routes with a committed baseline PNG — the ones the visual specs assert on. */
export const BASELINED_ROUTES = VISUAL_ROUTES.filter((r) => r.status === "baselined");

/** Routes a later sub-iterate still owes a baseline for. Visible debt. */
export const PENDING_ROUTES = VISUAL_ROUTES.filter((r) => r.status === "pending");
