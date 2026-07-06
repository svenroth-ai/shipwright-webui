/*
 * triage.ts — webui Triage Tab routes (FR-01.30, ADR-101).
 *
 * Five endpoints:
 *   GET  /api/triage/:projectId           — resolved view (status==triage filter applied client-side)
 *   GET  /api/triage/counts               — { counts: Record<projectId, number>, total }
 *   POST /api/triage/:projectId/promote   — cross-store transaction → 201 / 207 partial / 409 / 400 / 404
 *   POST /api/triage/:projectId/dismiss   — single-file write → 200
 *   POST /api/triage/:projectId/snooze    — single-file write → 200
 *
 * Lock-order convention (global): triage.jsonl FIRST, then sdk-sessions.json.
 * See conventions.md "Lock acquisition order".
 */

import { existsSync } from "node:fs";

import { Hono } from "hono";
import type { Context } from "hono";

import type { ExternalTask } from "../core/sdk-sessions-store.js";
import type { SdkSessionsStore } from "../core/sdk-sessions-store.js";
import type {
  TriagePriority,
  TriagePromoteResponse,
} from "../types/triage.js";

import { resolveTriagePath } from "../core/triage-paths.js";
import {
  enrichPendingDelivery,
  enrichWithCampaignRefs,
  type CampaignRef,
} from "../core/triage-enrich.js";
import { readAllItems, findItemById, filterTriage } from "../core/triage-store.js";
import { readBoardItems } from "../core/triage-board-read.js";
import {
  appendStatusEvent,
  TriageWriteError,
} from "../core/triage-write.js";

const TRIAGE_ID_RE = /^trg-[0-9a-fA-F]{8}$/;
const PRIORITY_VALUES: ReadonlySet<TriagePriority> = new Set([
  "P0",
  "P1",
  "P2",
  "P3",
]);
const COMPLEXITY_VALUES: ReadonlySet<string> = new Set([
  "small",
  "medium",
  "large",
]);
const MAX_TAG_LEN = 100;
const MAX_TAGS = 32;
const MAX_DOMAIN_LEN = 200;
const MAX_REASON_LEN = 500;
/**
 * Hard cap on the promoted task's description. Verbatim mirror of the
 * identically-named `DESCRIPTION_MAX_LENGTH` in `external/routes.ts` (the
 * cap the launch + edit routes enforce via `normalizeDescription`) — the
 * matching name keeps the two greppable together if they ever need to be
 * reconciled. A triage `detail` has no producer-side length bound, so it
 * is capped here before it becomes a task description, otherwise a
 * pathological item could mint an over-long, hard-to-edit task.
 */
const DESCRIPTION_MAX_LENGTH = 20_000;
/**
 * Action assigned to a promoted triage task. The launch route only
 * injects a task's description into the `claude` command via the
 * `actionId` → `substitutePlaceholders` branch; a task with no actionId
 * falls to the legacy path and the brief never reaches the run. A triage
 * item is by nature a change to a finished project, so `new-iterate` —
 * which launches `/shipwright-iterate <description>` — is the natural
 * landing action (a finding that turns out to need no change just ends
 * the iterate early). `new-iterate` is a bundled action, always present
 * in the resolved catalog; the launch route still validates it
 * (`unknown_action_id`) against the project's `.shipwright-webui/actions.json`. A
 * custom catalog that removes `new-iterate` therefore yields a loud
 * 400 on launch — by design. Do NOT add a degrade-to-legacy fallback
 * here: the legacy launch path has no description placeholder, so a
 * fallback would silently re-drop the brief — exactly the bug this
 * constant fixes.
 */
const PROMOTED_TASK_ACTION_ID = "new-iterate";

export interface TriageProjectMeta {
  id: string;
  path: string;
  synthesized?: boolean;
}

export interface TriageRoutesDeps {
  /** All non-synthesized registered projects, used by /counts. */
  getAllProjects: () => TriageProjectMeta[];
  /** Per-id project lookup. Synthesized rows treated as 404 by callers. */
  getProjectById: (id: string) => TriageProjectMeta | undefined;
  /** sdk-sessions store (find/create/persist). */
  store: SdkSessionsStore;
  /**
   * Cross-process file lock for the triage.jsonl path. MUST use a
   * collision-safe lockfile path (`.weblock`) so it never clashes with
   * the Python `_FileLock` regular-file sidecar at `<file>.lock` — see
   * core/triage-lock.ts (`createTriageLock`) and ADR-106. In tests this
   * is an in-process mutex.
   */
  lock: (path: string) => Promise<() => Promise<void>>;
  /** Failure injection for tests — when set, replaces appendStatusEvent. */
  appendStatusEventOverride?: typeof appendStatusEvent;
  /** Pinnable now-provider for tests. */
  now?: () => string;
  /**
   * FR-01.33 — injected campaign correlation (server-side enrichment). Returns
   * each campaign in the project as `{expandsTriage, slug, status}`. Wired in
   * index.ts from the campaign store so THIS module imports no campaign code
   * (preserves the campaigns-no-triage-coupling import boundary). Optional:
   * when absent, items are returned without campaign annotations.
   */
  listCampaignRefs?: (projectId: string) => CampaignRef[];
}

export function createTriageRoutes(deps: TriageRoutesDeps): Hono {
  const app = new Hono();
  const append = deps.appendStatusEventOverride ?? appendStatusEvent;

  // ----------------------------------------------------------------------
  // GET /api/triage/counts — aggregate (status==triage) per project + total
  //
  // MUST be registered BEFORE the parametric `:projectId` route below,
  // otherwise Hono matches "counts" as projectId="counts" → 404.
  // ----------------------------------------------------------------------
  app.get("/api/triage/counts", async (c) => {
    const projects = deps.getAllProjects().filter((p) => !p.synthesized);
    const settled = await Promise.allSettled(
      projects.map(async (p) => {
        const pathRes = resolveTriagePath({
          path: p.path,
          synthesized: p.synthesized,
        });
        if (!pathRes.ok) return { id: p.id, count: 0 };
        try {
          const items = readAllItems(pathRes.absolute);
          return { id: p.id, count: filterTriage(items).length };
        } catch (err) {
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "triage counts: per-project read failed",
              projectId: p.id,
              error: String(err).slice(0, 200),
            }),
          );
          return { id: p.id, count: 0 };
        }
      }),
    );
    const counts: Record<string, number> = {};
    let total = 0;
    for (const r of settled) {
      if (r.status === "fulfilled") {
        counts[r.value.id] = r.value.count;
        total += r.value.count;
      }
    }
    return c.json({ counts, total });
  });

  // ----------------------------------------------------------------------
  // GET /api/triage/:projectId — list items (caller filters status if needed)
  // ----------------------------------------------------------------------
  app.get("/api/triage/:projectId", (c) => {
    const projectId = c.req.param("projectId");
    const project = deps.getProjectById(projectId);
    if (!project || project.synthesized) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    const pathRes = resolveTriagePath({
      path: project.path,
      synthesized: project.synthesized,
    });
    if (!pathRes.ok) {
      // synthesized / missing path → 404; path traversal → 403
      if (pathRes.error.reason === "path_traversal") {
        return c.json({ error: "path_traversal_rejected", projectId }, 403);
      }
      return c.json({ error: "project_path_invalid", projectId }, 404);
    }
    // Delivered-origin union read (root-cause fix for the "ghost" bug) +
    // `origin` drift metadata for the staleness banner (additive; older clients
    // ignore it). Read errors + git failures degrade inside readBoardItems. See
    // core/triage-board-read.ts.
    const board = readBoardItems(pathRes.absolute, projectId);
    const items = board.items;
    enrichWithCampaignRefs(items, projectId, deps.listCampaignRefs);
    enrichPendingDelivery(items, pathRes.absolute);
    return c.json({ items, origin: board.origin });
  });

  // ----------------------------------------------------------------------
  // POST /api/triage/:projectId/promote — cross-store transaction
  // ----------------------------------------------------------------------
  app.post("/api/triage/:projectId/promote", async (c) => {
    const projectId = c.req.param("projectId");
    const project = deps.getProjectById(projectId);
    if (!project || project.synthesized) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = parsePromoteBody(body);
    if (!parsed.ok) return c.json(parsed.error, 400);

    const pathRes = resolveTriagePath({
      path: project.path,
      synthesized: project.synthesized,
    });
    if (!pathRes.ok) {
      if (pathRes.error.reason === "path_traversal") {
        return c.json({ error: "path_traversal_rejected", projectId }, 403);
      }
      return c.json({ error: "project_path_invalid", projectId }, 404);
    }

    // RC3 (ADR-106, spec AC4): a missing triage.jsonl means the item
    // cannot exist — answer 404 BEFORE touching the lock. proper-lockfile
    // would ENOENT on a missing target anyway, and there is nothing to
    // contend on.
    if (!existsSync(pathRes.absolute)) {
      return c.json(
        { error: "triage_item_not_found", triageId: parsed.value.triageId },
        404,
      );
    }

    // Lock #1 (FIRST per global lock-order convention): triage.jsonl.
    // Genuine contention (`ELOCKED` — another webui tab, or the Python
    // `_FileLock` producer) degrades to a clean 503, never an opaque 500.
    let releaseTriage: () => Promise<void>;
    try {
      releaseTriage = await deps.lock(pathRes.absolute);
    } catch (err) {
      if (isElockedError(err)) return lockUnavailable(c);
      throw err;
    }
    try {
      const items = readAllItems(pathRes.absolute);
      const item = findItemById(items, parsed.value.triageId);
      if (!item) {
        return c.json({ error: "triage_item_not_found", triageId: parsed.value.triageId }, 404);
      }

      // Status pre-check (held under triage lock; serializes same-id
      // concurrent promotes via the triage path lock).
      if (item.status !== "triage") {
        // Already promoted/dismissed/snoozed by some actor. Allow if we
        // own the back-ref (idempotent recovery from prior partial-promote);
        // otherwise reject with 409.
        const preExisting = deps.store.findByPromotedFromTriageId(
          parsed.value.triageId,
        );
        if (!preExisting) {
          return c.json(
            {
              error: "triage_item_not_in_triage_state",
              actualStatus: item.status,
            },
            409,
          );
        }
      }

      let taskId: string;
      let recovered: boolean;

      // RC2 fix (ADR-106): create-or-recover with NO route-held
      // sdk-sessions lock. `store.persist()` takes its own
      // proper-lockfile lock internally; a second route-level lock on
      // the same sdk-sessions.json was the non-reentrant self-deadlock
      // (proper-lockfile is not reentrant → inner lock `ELOCKED` → 500).
      // Same-id concurrent promotes are already serialized by the
      // triage.jsonl lock held above; the back-ref lookup below stays
      // as the idempotent create-vs-recover decision.
      const existing = deps.store.findByPromotedFromTriageId(
        parsed.value.triageId,
      );
      if (existing) {
        // Idempotent recovery — reuse the prior task, then proceed to
        // the status flip (idempotent: last-status-wins). Re-persist
        // defensively: a prior attempt may have created the task in
        // memory but failed its persist() (e.g. ELOCKED → 503), leaving
        // it off-disk. persist() is idempotent, so a re-run on an
        // already-persisted task is a harmless full rewrite (external
        // code review, ADR-106).
        taskId = existing.taskId;
        recovered = true;
        await deps.store.persist();
      } else {
        // Fresh promote: create task, persist.
        const defaultTags = [
          `source:${item.source}`,
          `severity:${item.severity}`,
          `triage:${parsed.value.triageId}`,
        ];
        const allTags = mergeTags(defaultTags, parsed.value.tags);
        // Carry the triage item's `detail` text into the task as its
        // description (the "brief" / initial prompt), and assign
        // PROMOTED_TASK_ACTION_ID so the launch route's substitution
        // branch actually injects that brief into the run. Without the
        // actionId the launch falls to the legacy path and the brief is
        // silently dropped; without the description there is nothing to
        // inject. Both are required for the triage→backlog→in-progress
        // chain to carry the brief end to end.
        const description = deriveDescription(item.detail);
        const created: ExternalTask = deps.store.create({
          title: item.title,
          cwd: project.path,
          projectId,
          actionId: PROMOTED_TASK_ACTION_ID,
          domain: parsed.value.domain,
          priority: parsed.value.priority,
          complexityHint: parsed.value.complexityHint,
          tags: allTags,
          promotedFromTriageId: parsed.value.triageId,
          ...(description !== undefined ? { description } : {}),
        });
        await deps.store.persist();
        taskId = created.taskId;
        recovered = false;
      }

      // Step 7: append status flip to triage.jsonl.
      try {
        append({
          jsonlPath: pathRes.absolute,
          triageId: parsed.value.triageId,
          newStatus: "promoted",
          by: "webui",
          reason: "webuiPromote",
          promotedTaskId: `EXT:${taskId}`,
          now: deps.now,
        });
      } catch (err) {
        // ENOENT or any other write failure → 207 partial. The
        // ExternalTask has already been minted with the back-ref so a
        // retry will hit the idempotent path.
        if (err instanceof TriageWriteError) {
          return c.json(
            {
              error: "promote_partial",
              taskId,
              triageId: parsed.value.triageId,
              code: err.code,
              message: "ExternalTask created; triage status flip failed — retry to complete",
            },
            207,
          );
        }
        throw err;
      }

      const fullTask = deps.store.get(taskId);
      const response: TriagePromoteResponse = {
        task: {
          taskId,
          promotedFromTriageId: fullTask?.promotedFromTriageId,
        },
        triageId: parsed.value.triageId,
        newStatus: "promoted",
        recovered,
      };
      return c.json(response, 201);
    } catch (err) {
      // `store.persist()` ELOCKED — same contention class as the
      // triage lock → clean 503, not an opaque 500.
      if (isElockedError(err)) return lockUnavailable(c);
      throw err;
    } finally {
      await releaseQuietly(releaseTriage);
    }
  });

  // ----------------------------------------------------------------------
  // POST /api/triage/:projectId/dismiss — single-file write
  // ----------------------------------------------------------------------
  app.post("/api/triage/:projectId/dismiss", async (c) => {
    return statusFlipRoute(c, "dismissed");
  });

  // ----------------------------------------------------------------------
  // POST /api/triage/:projectId/snooze — single-file write
  // ----------------------------------------------------------------------
  app.post("/api/triage/:projectId/snooze", async (c) => {
    return statusFlipRoute(c, "snoozed");
  });

  async function statusFlipRoute(
    c: Context,
    newStatus: "dismissed" | "snoozed",
  ) {
    const projectId = c.req.param("projectId") ?? "";
    const project = deps.getProjectById(projectId);
    if (!project || project.synthesized) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = parseDismissSnoozeBody(body);
    if (!parsed.ok) return c.json(parsed.error, 400);

    const pathRes = resolveTriagePath({
      path: project.path,
      synthesized: project.synthesized,
    });
    if (!pathRes.ok) {
      if (pathRes.error.reason === "path_traversal") {
        return c.json({ error: "path_traversal_rejected", projectId }, 403);
      }
      return c.json({ error: "project_path_invalid", projectId }, 404);
    }

    // RC3 (ADR-106, spec AC4): missing triage.jsonl → 404 before the
    // lock (nothing to contend on; proper-lockfile would ENOENT).
    if (!existsSync(pathRes.absolute)) {
      return c.json(
        { error: "triage_item_not_found", triageId: parsed.value.triageId },
        404,
      );
    }

    // Genuine lock contention (`ELOCKED`) degrades to a clean 503.
    let release: () => Promise<void>;
    try {
      release = await deps.lock(pathRes.absolute);
    } catch (err) {
      if (isElockedError(err)) return lockUnavailable(c);
      throw err;
    }
    try {
      const items = readAllItems(pathRes.absolute);
      const item = findItemById(items, parsed.value.triageId);
      if (!item) {
        return c.json({ error: "triage_item_not_found", triageId: parsed.value.triageId }, 404);
      }

      // Orphan-promote guard (Gemini MED #2): if a back-ref task exists,
      // a prior promote completed step 5 but failed step 7. Block
      // dismiss/snooze until the operator finishes (or rolls back) the
      // promote.
      const existing = deps.store.findByPromotedFromTriageId(
        parsed.value.triageId,
      );
      if (existing) {
        return c.json(
          {
            error: "promote_in_progress",
            taskId: existing.taskId,
            message:
              "A previous Promote attempt left a task; complete the promote (retry) or delete the task first.",
          },
          409,
        );
      }

      if (item.status !== "triage") {
        return c.json(
          {
            error: "triage_item_not_in_triage_state",
            actualStatus: item.status,
          },
          409,
        );
      }
      try {
        append({
          jsonlPath: pathRes.absolute,
          triageId: parsed.value.triageId,
          newStatus,
          by: "webui",
          reason: parsed.value.reason,
          promotedTaskId: null,
          now: deps.now,
        });
      } catch (err) {
        if (err instanceof TriageWriteError) {
          return c.json(
            { error: err.code, message: err.message },
            500,
          );
        }
        throw err;
      }
      return c.json({ triageId: parsed.value.triageId, newStatus });
    } finally {
      await releaseQuietly(release);
    }
  }

  return app;
}

// ----------------------------------------------------------------------
// Body validators (kept inline so they're easy to audit)
// ----------------------------------------------------------------------

interface PromoteBody {
  triageId: string;
  priority: TriagePriority;
  domain: string;
  complexityHint?: "small" | "medium" | "large";
  tags: string[];
}

interface DismissSnoozeBody {
  triageId: string;
  reason: string | null;
}

type Validated<T> = { ok: true; value: T } | { ok: false; error: { error: string; field?: string } };

function parsePromoteBody(body: unknown): Validated<PromoteBody> {
  if (!isPlainObject(body)) return { ok: false, error: { error: "body_not_object" } };
  const triageId = body.triageId;
  if (typeof triageId !== "string" || !TRIAGE_ID_RE.test(triageId)) {
    return { ok: false, error: { error: "invalid_triageId", field: "triageId" } };
  }
  const priority = body.priority;
  if (typeof priority !== "string" || !PRIORITY_VALUES.has(priority as TriagePriority)) {
    return { ok: false, error: { error: "invalid_priority", field: "priority" } };
  }
  const domainRaw = body.domain;
  if (typeof domainRaw !== "string") {
    return { ok: false, error: { error: "invalid_domain", field: "domain" } };
  }
  const domain = domainRaw.trim();
  if (!domain) return { ok: false, error: { error: "domain_empty", field: "domain" } };
  if (domain.length > MAX_DOMAIN_LEN) {
    return { ok: false, error: { error: "domain_too_long", field: "domain" } };
  }
  let complexityHint: "small" | "medium" | "large" | undefined;
  if (body.complexityHint !== undefined) {
    if (
      typeof body.complexityHint !== "string" ||
      !COMPLEXITY_VALUES.has(body.complexityHint)
    ) {
      return {
        ok: false,
        error: { error: "invalid_complexityHint", field: "complexityHint" },
      };
    }
    complexityHint = body.complexityHint as "small" | "medium" | "large";
  }
  const tagsRaw = body.tags;
  if (!Array.isArray(tagsRaw)) {
    return { ok: false, error: { error: "invalid_tags", field: "tags" } };
  }
  const tagsValidated: string[] = [];
  const seen = new Set<string>();
  for (const t of tagsRaw) {
    if (typeof t !== "string") {
      return { ok: false, error: { error: "invalid_tag_type", field: "tags" } };
    }
    if (containsControlChar(t)) {
      return { ok: false, error: { error: "tag_control_char", field: "tags" } };
    }
    const trimmed = t.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_TAG_LEN) {
      return { ok: false, error: { error: "tag_too_long", field: "tags" } };
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      tagsValidated.push(trimmed);
    }
  }
  if (tagsValidated.length > MAX_TAGS) {
    return { ok: false, error: { error: "tags_too_many", field: "tags" } };
  }
  return {
    ok: true,
    value: { triageId, priority: priority as TriagePriority, domain, complexityHint, tags: tagsValidated },
  };
}

function parseDismissSnoozeBody(body: unknown): Validated<DismissSnoozeBody> {
  if (!isPlainObject(body)) return { ok: false, error: { error: "body_not_object" } };
  const triageId = body.triageId;
  if (typeof triageId !== "string" || !TRIAGE_ID_RE.test(triageId)) {
    return { ok: false, error: { error: "invalid_triageId", field: "triageId" } };
  }
  let reason: string | null = null;
  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== "string") {
      return { ok: false, error: { error: "invalid_reason", field: "reason" } };
    }
    if (containsControlChar(body.reason)) {
      return { ok: false, error: { error: "reason_control_char", field: "reason" } };
    }
    const trimmed = body.reason.trim();
    if (trimmed.length > MAX_REASON_LEN) {
      return { ok: false, error: { error: "reason_too_long", field: "reason" } };
    }
    reason = trimmed || null;
  }
  return { ok: true, value: { triageId, reason } };
}

// enrichWithCampaignRefs (FR-01.33) moved verbatim to core/triage-enrich.ts
// (anti-ratchet extraction, iterate-2026-06-10-triage-pending-delivery-badge).

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function containsControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function mergeTags(defaults: string[], userTags: string[]): string[] {
  const seen = new Set<string>(defaults);
  const out = [...defaults];
  for (const t of userTags) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Derive the promoted task's description from a triage item's `detail`.
 * `detail` is typed `string` but resolved from raw JSONL, so it is
 * defensively re-checked. Whitespace-only → `undefined` (no description
 * field minted); over-length → trimmed and capped at DESCRIPTION_MAX_LENGTH.
 *
 * Interior newlines are deliberately PRESERVED — a triage `detail` is
 * often multi-paragraph and reads better that way in the task UI. The
 * launch path flattens the description to a single line at substitution
 * time (`actions-substitute.ts flattenDescription`); do NOT add a
 * newline / control-char rejection here — that would re-break the
 * multi-line findings the launch path is built to accept.
 */
function deriveDescription(detail: unknown): string | undefined {
  if (typeof detail !== "string") return undefined;
  const trimmed = detail.trim();
  if (!trimmed) return undefined;
  return trimmed.length > DESCRIPTION_MAX_LENGTH
    ? trimmed.slice(0, DESCRIPTION_MAX_LENGTH)
    : trimmed;
}

// ----------------------------------------------------------------------
// Lock-failure classification (ADR-106, RC3)
// ----------------------------------------------------------------------

/**
 * `proper-lockfile` signals genuine contention with `code: "ELOCKED"`
 * (the lock is held — by another webui tab, or by the Python `_FileLock`
 * producer if the `.weblock`/`.lock` paths ever realign). Any other error
 * (EACCES, ENOENT, EPERM, …) is a real filesystem fault, not contention.
 */
function isElockedError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "ELOCKED"
  );
}

/**
 * 503 response for genuine lock contention. Generic, retry-oriented
 * wording — never leaks the raw error or a filesystem path (spec AC4).
 */
function lockUnavailable(c: Context) {
  return c.json(
    {
      error: "lock_unavailable",
      message: "Triage storage is busy — please retry in a moment.",
    },
    503,
  );
}

/**
 * Release a proper-lockfile lock in a `finally` WITHOUT clobbering the
 * route's already-determined response. A `finally` that throws overrides
 * the preceding `return`/`throw`; a failed unlock (lock dir removed
 * externally, perms changed) must not turn a successful 201/200 — or a
 * deliberate 503 — into an opaque 500. The failure is logged and
 * swallowed (external code review, ADR-106).
 */
async function releaseQuietly(release: () => Promise<void>): Promise<void> {
  try {
    await release();
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "triage route: lock release failed (ignored)",
        error: String(err).slice(0, 200),
      }),
    );
  }
}

