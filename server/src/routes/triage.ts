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

import { Hono } from "hono";
import type { Context } from "hono";

import type { ExternalTask } from "../core/sdk-sessions-store.js";
import type { SdkSessionsStore } from "../core/sdk-sessions-store.js";
import type { Project } from "../types/project.js";
import type {
  TriageItem,
  TriagePriority,
  TriagePromoteResponse,
} from "../types/triage.js";

import { resolveTriagePath } from "../core/triage-paths.js";
import { readAllItems, findItemById, filterTriage } from "../core/triage-store.js";
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
   * Lock helper — wrap a callback under a cross-process file lock for
   * the given target path. In production this is `proper-lockfile.lock`
   * with retries; in tests a no-op or in-process mutex.
   */
  lock: (path: string) => Promise<() => Promise<void>>;
  /**
   * Absolute path to sdk-sessions.json. Used by the promote route to
   * acquire the cross-process write lock on the store. Wired in
   * server/src/index.ts to `${config.registryDir}/sdk-sessions.json`.
   */
  sessionsLockPath: string;
  /** Failure injection for tests — when set, replaces appendStatusEvent. */
  appendStatusEventOverride?: typeof appendStatusEvent;
  /** Pinnable now-provider for tests. */
  now?: () => string;
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
    let items: TriageItem[];
    try {
      items = readAllItems(pathRes.absolute);
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "triage read failed",
          projectId,
          error: String(err).slice(0, 200),
        }),
      );
      items = [];
    }
    return c.json({ items });
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

    // Lock #1 (FIRST per global lock-order convention): triage.jsonl
    const releaseTriage = await deps.lock(pathRes.absolute);
    let releasedTriage = false;
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

      // Acquire sdk-sessions lock for the create-or-recover atomic block.
      // External-code-review fix: re-check findByPromotedFromTriageId
      // INSIDE the sessions lock (defense in depth — even if some future
      // caller bypasses the triage lock, the duplicate-create race is
      // closed at the sdk-sessions critical section).
      const releaseSessions = await deps.lock(deps.sessionsLockPath);
      try {
        const existingUnderLock = deps.store.findByPromotedFromTriageId(
          parsed.value.triageId,
        );
        if (existingUnderLock) {
          // Idempotent recovery — reuse the prior task. Skip step 6
          // (create), proceed to step 7 (status flip; idempotent
          // because last-status-wins).
          taskId = existingUnderLock.taskId;
          recovered = true;
        } else {
          // Fresh promote: create task, persist.
          const defaultTags = [
            `source:${item.source}`,
            `severity:${item.severity}`,
            `triage:${parsed.value.triageId}`,
          ];
          const allTags = mergeTags(defaultTags, parsed.value.tags);
          const created: ExternalTask = deps.store.create({
            title: item.title,
            cwd: project.path,
            projectId,
            domain: parsed.value.domain,
            priority: parsed.value.priority,
            complexityHint: parsed.value.complexityHint,
            tags: allTags,
            promotedFromTriageId: parsed.value.triageId,
          });
          await deps.store.persist();
          taskId = created.taskId;
          recovered = false;
        }
      } finally {
        await releaseSessions();
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
    } finally {
      if (!releasedTriage) {
        releasedTriage = true;
        await releaseTriage();
      }
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

    const release = await deps.lock(pathRes.absolute);
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
      await release();
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

