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
    path: "/tasks/:taskId",
    description: "TaskDetail, Mission pane — header CTA, title, description",
    status: "baselined",
  },
  {
    id: "task-detail-terminal",
    path: "/tasks/:taskId (Terminal tab)",
    description: "TaskDetail, Files & Terminal — the pty surface is MASKED (not deterministic)",
    status: "baselined",
  },
  {
    id: "projects",
    path: "/projects",
    description: "Projects list with one seeded project",
    status: "baselined",
  },
  { id: "inbox", path: "/inbox", description: "Inbox — empty state", status: "baselined" },
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
    description: "Intent wizard — grade door, step 1 (repo pick)",
    status: "baselined",
  },
  {
    id: "design-gate",
    path: "/(design gate)",
    description: "Design-gate review surface (FR-01.45)",
    status: "pending",
    owner: "A16",
  },
  {
    id: "ships-log",
    path: "/(ship's log)",
    description: "Ship's Log",
    status: "pending",
    owner: "A15",
  },
  {
    id: "first-contact",
    path: "/(first contact)",
    description: "First-Contact / empty-machine onboarding",
    status: "pending",
    owner: "A14",
  },
];

/** Routes with a committed baseline PNG — the ones the visual specs assert on. */
export const BASELINED_ROUTES = VISUAL_ROUTES.filter((r) => r.status === "baselined");

/** Routes a later sub-iterate still owes a baseline for. Visible debt. */
export const PENDING_ROUTES = VISUAL_ROUTES.filter((r) => r.status === "pending");
