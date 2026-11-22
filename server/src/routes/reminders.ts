/*
 * reminders.ts — webui reminder routes (campaign reminders-webui, W1).
 *
 *   GET  /api/reminders/due                  — `due` across all registered projects
 *   GET  /api/reminders/:projectId/due       — `due` for one project
 *   POST /api/reminders/:projectId/done      — { id }
 *   POST /api/reminders/:projectId/snooze    — { id, until: YYYY-MM-DD }
 *   POST /api/reminders/:projectId/add       — { title, due, why, decided?, open?, command?, links? }
 *
 * Every route calls `reminder_cli.py` through `core/reminder-cli-runner.ts` and
 * nothing else: the WebUI never writes `reminders.jsonl` (CLAUDE.md DO-NOT #12
 * spirit; the Python lock is the only one that coordinates the file).
 *
 * Every answer carries an explicit `state`. A CLI that is missing, an answer we
 * cannot read, an unknown `contractVersion`, a failed triage read
 * (`triageError`) and damaged store lines (`reminderCorruptLines`) are each a
 * named state with their data intact — none of them ever looks like "nothing
 * due". `sourceRoot` / `reminderStore` (local paths) are dropped from every
 * response. All text fields are untrusted: the client must escape them.
 */

import { Hono } from "hono";
import type { Context } from "hono";

import {
  runReminderDue,
  runReminderWrite,
  type ReminderDueResult,
  type ReminderWriteResult,
} from "../core/reminder-cli-runner.js";
import { resolveMainCheckout } from "../core/reminder-main-root.js";
import { parseAddBody, parseReminderId, parseSnoozeBody } from "../core/reminder-validation.js";

export interface ReminderProjectMeta {
  id: string;
  path: string;
  name?: string;
  synthesized?: boolean;
}

export interface ReminderRoutesDeps {
  /** The project registry (`ProjectManager`); synthesized rows are skipped here. */
  projects: {
    getAll: () => ReminderProjectMeta[];
    getById: (id: string) => ReminderProjectMeta | undefined;
  };
  /** Test seams; default to the real CLI bridge. */
  runReminderDue?: typeof runReminderDue;
  runReminderWrite?: typeof runReminderWrite;
}

/** Spawn at most this many `uv run` children at once for the all-projects read. */
const ALL_PROJECTS_CONCURRENCY = 3;

type DueBody = Record<string, unknown> & { state: string };

/** HTTP status + body for one `due` result. Pure; shared by both read routes. */
function dueResponse(result: ReminderDueResult): { status: 200 | 502 | 503; body: DueBody } {
  switch (result.kind) {
    case "ok": {
      const { triageError, reminderCorruptLines } = result.view;
      const degraded = triageError !== null || reminderCorruptLines > 0;
      return { status: 200, body: { state: degraded ? "degraded" : "ok", ...result.view } };
    }
    case "engine-unavailable":
      return { status: 503, body: { state: "engine-unavailable", reason: result.reason, repairCommand: result.repairCommand } };
    case "store-busy":
      return { status: 503, body: { state: "store-busy", reason: result.message } };
    case "unsupported-version": {
      const v = result.contractVersion;
      return { status: 502, body: { state: "unsupported-version", contractVersion: typeof v === "number" || typeof v === "string" ? String(v) : null } };
    }
    case "unreadable":
      return { status: 502, body: { state: "unreadable", reason: result.reason } };
    case "failed":
      return { status: 502, body: { state: "failed", reason: result.reason } };
  }
}

function writeResponse(result: ReminderWriteResult, id: string): { status: 200 | 201 | 404 | 422 | 502 | 503; body: Record<string, unknown> } {
  switch (result.kind) {
    case "ok":
      return result.operation === "add"
        ? { status: 201, body: { ok: true, reminder: result.reminder } }
        : { status: 200, body: { ok: true, id, operation: result.operation, output: result.output } };
    case "refused":
      // The CLI's plain refusal (e.g. a secret in a field), unchanged. No retry.
      return { status: 422, body: { error: "refused", message: result.message } };
    case "not-found":
      return { status: 404, body: { error: "not_found", message: result.message } };
    case "engine-unavailable":
      return { status: 503, body: { error: "engine_unavailable", reason: result.reason, repairCommand: result.repairCommand } };
    case "store-busy":
      return { status: 503, body: { error: "store_busy", message: result.message } };
    case "unreadable":
      return { status: 502, body: { error: "unreadable", reason: result.reason } };
    case "failed":
      return { status: 502, body: { error: "failed", reason: result.reason } };
  }
}

export function createReminderRoutes(deps: ReminderRoutesDeps): Hono {
  const app = new Hono();
  const readDue = deps.runReminderDue ?? runReminderDue;
  const write = deps.runReminderWrite ?? runReminderWrite;

  app.get("/api/reminders/due", async (c) => {
    const projects = deps.projects.getAll().filter((p) => !p.synthesized);
    // Two registrations of one repo (main tree + a linked worktree) share ONE store:
    // read it once, under the first project; the other gets an explicit shared-root state.
    const firstByRoot = new Map<string, string>();
    const sharedWith = projects.map((p) => {
      const root = resolveMainCheckout(p.path);
      const first = firstByRoot.get(root);
      if (first === undefined) firstByRoot.set(root, p.id);
      return first;
    });
    const entries: Record<string, unknown>[] = Array.from({ length: projects.length });
    let next = 0;
    // `next` is only mutated synchronously (never across an await), so workers cannot share an index.
    const worker = async (): Promise<void> => {
      for (let i = next++; i < projects.length; i = next++) {
        const p = projects[i];
        const shared = sharedWith[i];
        if (shared !== undefined) {
          entries[i] = { projectId: p.id, state: "shared-root", sharedWithProjectId: shared };
          continue;
        }
        let body: DueBody;
        try {
          body = dueResponse(await readDue(p.path)).body;
        } catch {
          body = { state: "failed", reason: "The reminder check failed unexpectedly." };
        }
        entries[i] = { projectId: p.id, ...body };
      }
    };
    await Promise.all(Array.from({ length: Math.min(ALL_PROJECTS_CONCURRENCY, projects.length) }, worker));
    return c.json({ projects: entries });
  });

  app.get("/api/reminders/:projectId/due", async (c) => {
    const project = deps.projects.getById(c.req.param("projectId"));
    if (!project || project.synthesized) return c.json({ error: "project_not_found" }, 404);
    try {
      const { status, body } = dueResponse(await readDue(project.path));
      return c.json({ projectId: project.id, ...body }, status);
    } catch {
      return c.json({ projectId: project.id, state: "failed", reason: "The reminder check failed unexpectedly." }, 502);
    }
  });

  async function post(
    c: Context,
    build: (body: unknown) => { ok: true; input: Parameters<typeof runReminderWrite>[1]; id: string } | { ok: false; error: string },
  ): Promise<Response> {
    const project = deps.projects.getById(c.req.param("projectId") ?? "");
    if (!project || project.synthesized) return c.json({ error: "project_not_found" }, 404);
    // A JSON content-type is REQUIRED: a cross-site "simple" POST (text/plain) would
    // otherwise run past CORS (same guard as adopt-scan.ts).
    if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return c.json({ error: "unsupported_media_type" }, 415);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const built = build(raw);
    if (!built.ok) return c.json({ error: "invalid_body", message: built.error }, 400);
    try {
      const { status, body } = writeResponse(await write(project.path, built.input), built.id);
      return c.json(body, status);
    } catch {
      return c.json({ error: "failed", reason: "The reminder engine failed unexpectedly." }, 502);
    }
  }

  app.post("/api/reminders/:projectId/done", (c) =>
    post(c, (b) => {
      const id = parseReminderId(b);
      return id.ok ? { ok: true, id: id.value, input: { operation: "done", id: id.value } } : { ok: false, error: id.error };
    }),
  );

  app.post("/api/reminders/:projectId/snooze", (c) =>
    post(c, (b) => {
      const p = parseSnoozeBody(b);
      return p.ok
        ? { ok: true, id: p.value.id, input: { operation: "snooze", id: p.value.id, until: p.value.until } }
        : { ok: false, error: p.error };
    }),
  );

  app.post("/api/reminders/:projectId/add", (c) =>
    post(c, (b) => {
      const p = parseAddBody(b);
      return p.ok ? { ok: true, id: "", input: { operation: "add", ...p.value } } : { ok: false, error: p.error };
    }),
  );

  return app;
}
