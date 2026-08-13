/*
 * triage.ts — webui Triage Tab routes (FR-01.30, ADR-101).
 *
 * Six endpoints:
 *   GET  /api/triage/:projectId           — resolved view (status==triage filter applied client-side)
 *   GET  /api/triage/counts               — { counts: Record<projectId, number>, total }
 *   POST /api/triage/:projectId/promote   — cross-store transaction → 201 / 207 partial / 409 / 400 / 404
 *   POST /api/triage/:projectId/dismiss   — single-file write → 200
 *   POST /api/triage/:projectId/snooze    — single-file write → 200
 *   POST /api/triage/:projectId/amend     — single-file DELTA write (edit-in-place) → 200
 *
 * The Python CLI owns triage.jsonl locking and status compare-and-swap. This
 * route only uses the sdk-sessions store's independent lock while preparing a
 * promoted task; it never takes a TypeScript triage lock.
 */

import { Hono } from "hono";
import type { Context } from "hono";

import type { ExternalTask } from "../core/sdk-sessions-store.js";
import type { SdkSessionsStore } from "../core/sdk-sessions-store.js";
import type { TriagePromoteResponse } from "../types/triage.js";

import { resolveTriagePath } from "../core/triage-paths.js";
import {
  enrichPendingDelivery,
  enrichWithCampaignRefs,
  type CampaignRef,
} from "../core/triage-enrich.js";
import { readAllItems, findItemById, filterTriage } from "../core/triage-store.js";
import { readBoardItems } from "../core/triage-board-read.js";
import {
  parsePromoteBody,
  parseDismissSnoozeBody,
  parseAmendBody,
} from "../core/triage-validation.js";
import {
  runTriageCli,
  triageWriteAvailability,
  type TriageCliResult,
  type TriageWriteAvailability,
} from "../core/triage-cli-runner.js";
import { normalizeDescription } from "../external/_shared/helpers.js";

/** Never put an interpreter probe on the native board-read critical path. */
export const TRIAGE_WRITE_AVAILABILITY_TTL_MS = 15_000;

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
  /** Sole triage transition writer. Defaults to the installed Python CLI. */
  runTriageCli?: typeof runTriageCli;
  /** Availability probe for the visible no-fallback degraded state. */
  triageWriteAvailability?: typeof triageWriteAvailability;
  /** Test seam for the cached availability refresh interval. */
  triageWriteAvailabilityTtlMs?: number;
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
  const writeTriage = deps.runTriageCli ?? runTriageCli;
  const writeAvailability = deps.triageWriteAvailability ?? triageWriteAvailability;
  const availabilityTtlMs = deps.triageWriteAvailabilityTtlMs ?? TRIAGE_WRITE_AVAILABILITY_TTL_MS;
  let cachedAvailability: { at: number; value: TriageWriteAvailability } | null = null;
  let availabilityInFlight: Promise<void> | null = null;

  function currentWriteAvailability(): Promise<TriageWriteAvailability> {
    const now = Date.now();
    if (cachedAvailability && now - cachedAvailability.at <= availabilityTtlMs) {
      return Promise.resolve(cachedAvailability.value);
    }
    if (!availabilityInFlight) {
      availabilityInFlight = writeAvailability()
        .then((value) => { cachedAvailability = { at: Date.now(), value }; })
        .catch(() => {
          cachedAvailability = {
            at: Date.now(),
            value: {
              available: false,
              reason: "The triage write engine could not be checked.",
            },
          };
        })
        .finally(() => { availabilityInFlight = null; });
    }
    // A cold probe must not delay a native board read. Keep transitions safely
    // disabled until its verdict is available; subsequent polling picks it up.
    return Promise.resolve(cachedAvailability?.value ?? {
      available: false,
      checking: true,
      reason: "Checking whether the triage write engine is available.",
    });
  }

  // ----------------------------------------------------------------------
  // GET /api/triage/counts — aggregate (status==triage) per project + total,
  // plus a cross-project deferredTotal (status==snoozed) so the client can
  // tell "genuinely nothing to look at" apart from "nothing OPEN, but items
  // are parked" (iterate-2026-08-05-triage-deferred-envelope, code review).
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
        if (!pathRes.ok) return { id: p.id, count: 0, deferred: 0 };
        try {
          const items = readAllItems(pathRes.absolute);
          return {
            id: p.id,
            count: filterTriage(items).length,
            deferred: items.filter((it) => it.status === "snoozed").length,
          };
        } catch (err) {
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "triage counts: per-project read failed",
              projectId: p.id,
              error: String(err).slice(0, 200),
            }),
          );
          return { id: p.id, count: 0, deferred: 0 };
        }
      }),
    );
    const counts: Record<string, number> = {};
    let total = 0;
    let deferredTotal = 0;
    for (const r of settled) {
      if (r.status === "fulfilled") {
        counts[r.value.id] = r.value.count;
        total += r.value.count;
        deferredTotal += r.value.deferred;
      }
    }
    return c.json({ counts, total, deferredTotal });
  });

  // ----------------------------------------------------------------------
  // GET /api/triage/:projectId — list items (caller filters status if needed)
  // ----------------------------------------------------------------------
  app.get("/api/triage/:projectId", async (c) => {
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
    const [board, write] = await Promise.all([
      readBoardItems(pathRes.absolute, projectId),
      currentWriteAvailability(),
    ]);
    const items = board.items;
    enrichWithCampaignRefs(items, projectId, deps.listCampaignRefs);
    enrichPendingDelivery(items, pathRes.absolute);
    return c.json({ items, origin: { ...board.origin, write } });
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

    // Read natively to construct the local task, but leave the transition
    // itself to the Python CLI. This snapshot is deliberately NOT a TypeScript
    // CAS: the CLI repeats the precondition under its cross-process lock.
    const item = findItemById(readAllItems(pathRes.absolute), parsed.value.triageId);
    if (!item) {
      return c.json({ error: "triage_item_not_found", triageId: parsed.value.triageId }, 404);
    }
    try {
      let taskId: string;
      let recovered: boolean;
      let createdTaskId: string | undefined;

      // RC2 fix (ADR-106): create-or-recover with NO route-held
      // sdk-sessions lock. `store.persist()` takes its own
      // proper-lockfile lock internally; a second route-level lock on
      // the same sdk-sessions.json was the non-reentrant self-deadlock
      // (proper-lockfile is not reentrant → inner lock `ELOCKED` → 500).
      // The CLI serializes same-id promotes under its cross-process lock; the
      // back-ref lookup below stays as the idempotent create-vs-recover
      // decision.
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
        // Reuse the exact same normalizeDescription() create/edit already
        // enforce (create.ts / patch.ts) — not a hand-rolled trim+cap
        // check — so promote applies the identical rule (cap measured on
        // the RAW string, before trimming) and the operator sees one
        // consistent error regardless of entry point. A prior version
        // checked the cap post-trim here, which silently accepted a
        // padded-with-whitespace detail that create/edit would reject.
        const normalized = normalizeDescription(item.detail);
        if (!normalized.ok) {
          return c.json({ error: "invalid_description", detail: normalized.error }, 400);
        }
        const description = normalized.value;
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
        createdTaskId = taskId;
      }

      const cli = await writeTriage({
        projectRoot: project.path,
        operation: "promote",
        itemId: parsed.value.triageId,
        args: [`--task-ref=EXT:${taskId}`, "--reason=webuiPromote"],
      });
      let resolvedItem = cli.kind === "ok" ? cli.item : undefined;
      if (!resolvedItem && cli.kind === "precondition" && recovered) {
        // The original promotion may have committed before its stdout was
        // lost. A second `promote` correctly receives the CLI's stable
        // precondition exit, so reconcile through the CLI reader before
        // declaring the recoverable task stranded.
        const shown = await writeTriage({
          projectRoot: project.path,
          operation: "show",
          itemId: parsed.value.triageId,
          args: [],
        });
        if (
          shown.kind === "ok" &&
          shown.item.status === "promoted" &&
          shown.item.promotedTaskId === `EXT:${taskId}`
        ) {
          resolvedItem = shown.item;
        }
      }
      if (!resolvedItem) {
        // A newly minted task has no triage transition until the CLI says it
        // succeeded. Stable CLI refusals prove no transition committed, so a
        // Python-originated winning race cannot leave a WebUI orphan behind.
        // An unrecognised result is deliberately NOT rolled back: the CLI may
        // have committed before stdout was truncated, and its promoted event
        // references this task. Preserve that recoverable partial instead.
        if (createdTaskId && cli.kind !== "failed") {
          deps.store.delete(createdTaskId);
          await deps.store.persist();
        }
        if (cli.kind === "engine-unavailable") return engineUnavailable(c, cli);
        if (cli.kind === "failed") {
          return c.json({
            error: "promote_partial",
            taskId,
            triageId: parsed.value.triageId,
            code: "triage_cli_result_unknown",
            message: "ExternalTask created; triage transition result is unknown — retry to reconcile.",
          }, 207);
        }
        // `ok` always supplies a non-null object to `resolvedItem`; TypeScript
        // cannot retain that relationship through the reconciliation branch.
        return cliFailure(c, cli as Exclude<TriageCliResult, { kind: "ok" } | { kind: "engine-unavailable" }>, parsed.value.triageId);
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
        item: resolvedItem,
      };
      return c.json(response, 201);
    } catch (err) {
      // sdk-sessions persistence is still independently lock-protected.
      if (isElockedError(err)) return lockUnavailable(c);
      throw err;
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

  // ----------------------------------------------------------------------
  // POST /api/triage/:projectId/amend — single-file DELTA write, edit-in-
  // place (iterate-2026-08-08-triage-amend-reader AC7). `triageId` is in
  // the JSON body, matching /dismiss + /snooze — not a URL path param.
  // ----------------------------------------------------------------------
  app.post("/api/triage/:projectId/amend", async (c) => {
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
    const parsed = parseAmendBody(body);
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

    const cli = await writeTriage({
      projectRoot: project.path,
      operation: "amend",
      itemId: parsed.value.triageId,
      args: [
        ...(parsed.value.title !== undefined ? [`--title=${parsed.value.title}`] : []),
        ...(parsed.value.detail !== undefined ? [`--detail=${parsed.value.detail}`] : []),
        ...(parsed.value.severity !== undefined ? [`--severity=${parsed.value.severity}`] : []),
      ],
    });
    if (cli.kind === "ok") return c.json({ triageId: parsed.value.triageId, amended: true, item: cli.item });
    if (cli.kind === "engine-unavailable") return engineUnavailable(c, cli);
    return cliFailure(c, cli, parsed.value.triageId);
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
    const parsed = parseDismissSnoozeBody(body, newStatus);
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

    // Orphan-promote guard: this is task-store recovery, not a triage CAS.
    // The CLI owns both the unlocked status check and the locked transition.
    const existing = deps.store.findByPromotedFromTriageId(parsed.value.triageId);
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

    const cli = await writeTriage({
      projectRoot: project.path,
      operation: newStatus === "dismissed" ? "dismiss" : "snooze",
      itemId: parsed.value.triageId,
      args: [
        ...(parsed.value.reason ? [`--reason=${parsed.value.reason}`] : []),
        ...(newStatus === "snoozed" && parsed.value.revisitAt ? [`--revisit=${parsed.value.revisitAt}`] : []),
      ],
    });
    if (cli.kind === "ok") return c.json({ triageId: parsed.value.triageId, newStatus, item: cli.item });
    if (cli.kind === "engine-unavailable") return engineUnavailable(c, cli);
    return cliFailure(c, cli, parsed.value.triageId);
  }

  return app;
}

// Body validators (parsePromoteBody, parseDismissSnoozeBody + shared
// helpers) live in core/triage-validation.ts — extracted
// iterate-2026-08-05-triage-deferred-envelope to keep this already-
// baselined file from ratcheting.

// enrichWithCampaignRefs (FR-01.33) moved verbatim to core/triage-enrich.ts
// (anti-ratchet extraction, iterate-2026-06-10-triage-pending-delivery-badge).

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

/** sdk-sessions persistence remains lock-protected independently of triage. */
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

function engineUnavailable(c: Context, result: Extract<TriageCliResult, { kind: "engine-unavailable" }>) {
  return c.json(
    { error: "engine_unavailable", message: result.reason, repairCommand: result.repairCommand },
    503,
  );
}

function cliFailure(c: Context, result: Exclude<TriageCliResult, { kind: "ok" } | { kind: "engine-unavailable" }>, triageId: string) {
  switch (result.kind) {
    case "precondition":
      return c.json({ error: "triage_item_not_in_triage_state", triageId }, 409);
    case "not-found":
    case "store-uninitialised":
      return c.json({ error: "triage_item_not_found", triageId }, 404);
    case "lock-timeout":
      return lockUnavailable(c);
    case "failed":
      return c.json({ error: "triage_write_failed", message: result.reason }, 502);
  }
}

