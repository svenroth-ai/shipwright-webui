/*
 * external/mission-context/routes.ts — the Mission-context surface
 * (campaign 2026-07-18-mission-artifacts, Slice 1).
 *
 *   GET /api/external/tasks/:taskId/mission-context
 *   GET /api/external/tasks/:taskId/mission-context/documents/:documentId
 *
 * INPUT TRUST BOUNDARY (CONTRACT §5.1, Review-2 GPT #4/#5). The client sends a
 * taskId and nothing else that matters. Everything the resolver acts on — the
 * session uuid, the owning project, the project root, the transcript — is read
 * from the server's OWN authoritative store. A caller therefore cannot pair
 * project A with project B's session, nor feed a forged transcript to spoof a
 * `pr-link` marker: mismatches return a generic 404, not a diagnostic.
 *
 * The detail endpoint takes an OPAQUE signed id — the client never builds a
 * `/file?path=` for a Mission artifact (§5.2). Ownership is RE-verified at read
 * time (not just at mint time) and the path is re-guarded, so a document that
 * moved or vanished returns a typed `stale`/`unavailable` rather than some
 * unrelated file.
 */

import { Hono } from "hono";

import { parseDocId } from "../../core/mission-context/doc-ids.js";
import {
  revertMissionContext,
  setMissionContextOnce,
} from "../../core/mission-context/association.js";
import {
  resolveMissionContext,
  readDocumentBody,
  type ResolveDeps,
  type ResolveRequest,
} from "../../core/mission-context/resolver.js";
import type { MissionContextAssociation } from "../../core/mission-context/types.js";
import { readAllowedRoots } from "../../core/mission-context/worktree-roots.js";
import { samePath } from "../../core/mission-context/pointer.js";
import { SdkSessionsStore, type ExternalTask } from "../../core/sdk-sessions-store.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

/** Bounded tail of the transcript — enough for a `pr-link`, never the whole file. */
export const TRANSCRIPT_TAIL_BYTES = 512 * 1024;

export interface MissionContextRouterDeps {
  store: SdkSessionsStore;
  getProjectById: (id: string) => ExternalRouteProjectView | undefined;
  /** Server-side transcript read. Returns "" when unavailable — never throws. */
  readTranscriptTail: (sessionUuid: string) => Promise<string>;
  /** Scenario inputs the resolver cannot derive itself. */
  getScenarioFacts: (
    project: ExternalRouteProjectView,
    task: ExternalTask,
  ) => Promise<{
    actions: ResolveRequest["actions"];
    runConfigStatus: ResolveRequest["runConfigStatus"];
    campaignSlug: string | null;
    hasCampaignRecord: boolean;
    /** S3 — optional so a pre-S3 test double still satisfies the contract. */
    pipeline?: ResolveRequest["pipeline"];
    campaign?: ResolveRequest["campaign"];
  }>;
  now?: () => Date;
  /**
   * Injected git / merge-check doubles. Production leaves this undefined (real
   * git); tests use it to drive the merge state deterministically.
   */
  resolveDeps?: ResolveDeps;
}

export function createMissionContextRouter(deps: MissionContextRouterDeps): Hono {
  const app = new Hono();
  const { store, getProjectById, readTranscriptTail, getScenarioFacts } = deps;
  const now = deps.now ?? (() => new Date());

  /**
   * Resolve task + project together, enforcing the binding. Returns null on any
   * failure so the caller emits ONE generic 404 — an endpoint that explained
   * which half was wrong would be an enumeration oracle.
   */
  const bind = (
    taskId: string,
  ): { task: ExternalTask; project: ExternalRouteProjectView } | null => {
    const task = store.get(taskId);
    if (!task) return null;
    const project = getProjectById(task.projectId);
    if (!project?.path) return null;
    return { task, project };
  };

  app.get("/api/external/tasks/:taskId/mission-context", async (c) => {
    const bound = bind(c.req.param("taskId"));
    if (!bound) return c.json({ error: "not_found" }, 404);
    const { task, project } = bound;

    const facts = await getScenarioFacts(project, task);
    const transcript = await readTranscriptTail(task.sessionUuid);

    const { context, associateRunId } = await resolveMissionContext({
      taskId: task.taskId,
      sessionUuid: task.sessionUuid,
      projectId: task.projectId,
      projectRoot: project.path,
      transcript,
      phaseTaskId: task.phaseTaskId ?? null,
      taskRunId: task.runId ?? null,
      // Server-held, server-written — this is what keeps a FINALIZED iterate
      // resolvable after its `iterate_active` pointer was pruned.
      association: task.missionContext ?? null,
      ...facts,
    }, deps.resolveDeps);

    // THE one guarded association write (CONTRACT §5). Idempotent: the store
    // no-ops when an association already exists, so repeated polls perform
    // exactly zero writes after the first. Never a per-GET side-effect.
    if (associateRunId && !task.missionContext) {
      const association: MissionContextAssociation = {
        kind: "iterate",
        runId: associateRunId,
        observedAt: now().toISOString(),
        source: "iterate_active_pointer",
      };
      if (setMissionContextOnce(store, task.taskId, association)) {
        try {
          await store.persist();
        } catch {
          // A lock contention (ELOCKED) or I/O fault must not fail the READ —
          // but the in-memory field MUST be rolled back, or every later poll
          // would see it set, skip the write, and the association would never
          // reach disk (external code review, openai HIGH).
          revertMissionContext(store, task.taskId, association);
        }
      }
    }

    return c.json({ status: "ok", context });
  });

  app.get("/api/external/tasks/:taskId/mission-context/documents/:documentId", async (c) => {
    const bound = bind(c.req.param("taskId"));
    if (!bound) return c.json({ error: "not_found" }, 404);
    const { task, project } = bound;

    const payload = parseDocId(c.req.param("documentId"));
    if (!payload) {
      // An id we cannot verify is a DEAD HANDLE, and the overwhelmingly common
      // cause is benign: the signing key is per-process, so every id minted
      // before a server restart stops verifying. Reporting `stale` tells the
      // user the truthful, actionable thing ("reopen the tab") instead of an
      // alarming 404 for an artifact that is perfectly fine.
      //
      // This leaks nothing: a tampered id and a restart-expired id are
      // indistinguishable to the caller either way, and NO read happens in
      // either case. Genuine binding mismatches below stay 404.
      return c.json({ status: "stale", reason: "unverifiable_id" }, 200);
    }

    // RE-verify the binding at READ time — a signed id is not a licence to read
    // across a task, a session or a project (§5.2).
    if (
      payload.t !== task.taskId ||
      payload.s !== task.sessionUuid ||
      payload.p !== project.path
    ) {
      return c.json({ error: "not_found" }, 404);
    }

    // Re-validate the READ ROOT against git, now — not just at mint time. A
    // capability minted for a worktree that has since been removed (or whose
    // path was reused) must not still read below it (external code review,
    // openai MEDIUM).
    const roots = await readAllowedRoots(project.path);
    if (!roots.some((r) => samePath(r, payload.root))) {
      return c.json({ status: "stale", reason: "root_no_longer_registered" }, 200);
    }

    const result = readDocumentBody(payload.root, payload.rel.split("/"), payload.f);
    if (!result.ok) {
      // `stale` is the honest answer both for a document that existed at mint
      // time and does not now, and for one that has CHANGED since — NOT a 404
      // that reads as "never existed", and never a silently-different body.
      const status =
        result.reason === "not_found" || result.reason === "changed" ? "stale" : "unavailable";
      return c.json({ status, reason: result.reason }, 200);
    }

    return c.json({
      status: "ok",
      document: { title: payload.rel.slice(payload.rel.lastIndexOf("/") + 1), body: result.body },
    });
  });

  return app;
}
