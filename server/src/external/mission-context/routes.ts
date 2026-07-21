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

/**
 * The larger bounded tail used ONLY while a task is still unidentified, so the
 * `Run-ID` footer recovery can reach it (run-id-recovery.ts).
 *
 * 1 MB is measured, not guessed: across this project's 65 real transcripts a
 * 512 KB tail recovers 42 sessions and MISSES 4 whose pointer proves the run
 * (the closest sits 526 KB from the end); 1 MB recovers 50 and misses none;
 * 2, 4 and 8 MB add nothing at all.
 *
 * It is a REACH-BACK, not a standing subscription. The window exists to see
 * history; anything written later is appended at the END, inside
 * `TRANSCRIPT_TAIL_BYTES`. So it is requested once per task and then only when
 * the transcript has actually changed — see `wideWindows`. The earlier
 * "unidentified ⇒ always wide" rule was permanent for a genuinely plain session,
 * and MEASURED on this machine that is the common case: 412 of 419 tasks, over
 * transcripts of which 78 % exceed 1 MB (internal code review of PR #309, PERF).
 *
 * WHAT THIS SAVES, stated precisely because the first draft of this comment
 * overstated it: ~425 KB per poll of UTF-8 DECODE, string allocation and
 * downstream scanning — NOT of I/O. `SessionWatcher.readChunk` reads the whole
 * file and then slices, so the tail budget bounds the SLICE, not the read. That
 * whole-file read is the larger cost and is deliberately untouched here (triage
 * `mission-context-whole-file-transcript-read`).
 *
 * The invariant is "a narrower window cannot lose a recovery", and it holds
 * UNLESS the transcript outruns the ordinary tail within one poll interval:
 * ~512 KB appended between two polls could carry a footer past the narrow window
 * before the next reach-back is earned. Such a session is in flight and so
 * pointer-identified in practice, which is why it never reaches this path — but
 * the invariant is CONDITIONAL, and claiming otherwise would be the same kind of
 * overstatement this run exists to correct.
 */
export const RECOVERY_TAIL_BYTES = 1024 * 1024;

/**
 * How many tasks' reach-back state is remembered. Cleared wholesale at the cap —
 * the same bounded-Map discipline as the resolver cache and the recovery memo,
 * and losing it costs one extra wide read per task, never a wrong answer.
 */
const WIDE_WINDOW_CAP = 512;

export interface MissionContextRouterDeps {
  store: SdkSessionsStore;
  getProjectById: (id: string) => ExternalRouteProjectView | undefined;
  /**
   * Server-side transcript read of the LAST `maxBytes` bytes. Returns empty
   * `text` when unavailable — never throws. `maxBytes` is omitted for the
   * ordinary poll and widened only while the task is still unidentified.
   *
   * `revision` identifies the bytes this read came from — file identity, size
   * and mtime, which `SessionWatcher.findByUuid` already yields on the very same
   * call, so it costs nothing. It exists purely to schedule the wide reach-back
   * (see `wideWindows`) and must be `""` whenever the read failed or the reader
   * cannot supply one: an empty revision is never recorded, so a fault can never
   * suppress a recovery. Deliberately metadata and not a content digest — the
   * cache would otherwise retain transcript text well past the read.
   */
  readTranscriptTail: (
    sessionUuid: string,
    maxBytes?: number,
  ) => Promise<{ text: string; revision: string }>;
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
  /** Test seam for the reach-back cap. Production leaves it at the constant. */
  wideWindowCap?: number;
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
  const wideWindowCap = deps.wideWindowCap ?? WIDE_WINDOW_CAP;

  /**
   * Per task: the transcript revision seen at the last read, and the one the
   * last WIDE reach-back scanned. Wide is worth repeating exactly when they
   * differ — i.e. the transcript moved since we last looked all the way back.
   *
   * The budget for poll n is therefore chosen from poll n-1's revision, which is
   * what keeps this to ONE read per poll rather than a probe-then-read round
   * trip; a footer that arrives is picked up one poll (10 s) later. Router-scoped
   * so it dies with the process — a restart simply reaches back once more.
   */
  const wideWindows = new Map<string, { seen: string; scanned: string }>();

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
    // A task that already knows its run needs only the ordinary tail. One that
    // does not gets the wider reach-back — on its first poll, and thereafter
    // only once the transcript has moved since the last reach-back.
    const window = wideWindows.get(task.taskId);
    const wide = !task.missionContext && (!window || window.seen !== window.scanned);
    const read = await readTranscriptTail(
      task.sessionUuid,
      wide ? RECOVERY_TAIL_BYTES : TRANSCRIPT_TAIL_BYTES,
    );
    const transcript = read.text;
    // A read that yielded no revision tells us nothing, so it records nothing —
    // otherwise a transient fault would mark the reach-back done and strand the
    // task unidentified (external plan review, openai MEDIUM). An already
    // identified task is not recorded either: it can never go wide, so an entry
    // for it would be pure cap pressure (internal code review, LOW).
    if (read.revision && !task.missionContext) {
      // Only a NEW key can push past the cap. Clearing on every write would, at
      // capacity, evict all 511 other tasks on each poll — every one of them
      // then paying a fresh 1 MB reach-back although its transcript never moved,
      // which is precisely the cost this schedule exists to remove (external
      // code review, openai MEDIUM).
      if (!wideWindows.has(task.taskId) && wideWindows.size >= wideWindowCap) wideWindows.clear();
      wideWindows.set(task.taskId, {
        seen: read.revision,
        scanned: wide ? read.revision : (window?.scanned ?? ""),
      });
    }

    const { context, associateRunId, associateSource } = await resolveMissionContext({
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
        source: associateSource,
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
          // …and the reach-back must be rolled back WITH it. The marker was
          // recorded before the resolve; leaving it would make every later poll
          // read only the ordinary tail while the task is unidentified again —
          // permanently unreachable for a footer beyond it, which is the very
          // data loss the rollback above exists to prevent, re-entered through
          // the read side (internal code review, MEDIUM).
          wideWindows.delete(task.taskId);
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
