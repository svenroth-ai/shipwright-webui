/*
 * core/mission-context/resolver.ts — orchestration (CONTRACT §5 / §5.2).
 *
 * Stateless read (Architecture rule 4) with ONE deliberate exception: the
 * durable `task.missionContext` association is written ONCE, on the first valid
 * LIVE resolve, as an idempotent compare-and-set — not a cache, not a per-GET
 * side-effect. Without it the pruned-pointer window is a guaranteed data loss
 * (`prune_stale_run_pointers` removes the pointer when the worktree goes away).
 * See association.ts.
 *
 * `task.runId` is deliberately NOT touched — it means a PIPELINE run
 * (`run-xxxxxxxx`) and overloading it with an iterate id would corrupt the
 * pipeline join (external-review GPT #4).
 *
 * Caching is keyed `{projectRoot, sessionUuid, runId}` and validated by a
 * source-mtime `rev` (see resolver-parts.ts) — a byte-offset cache would
 * violate rule 4; an mtime-keyed read-through cache merely avoids re-reads.
 */

import { existsSync } from "node:fs";

import {
  cache,
  CACHE_CAP,
  computeSourceRev,
  docFingerprint,
  emptyContext,
  readBounded,
  unavailableArtifacts,
} from "./resolver-parts.js";
export { _clearResolverCache } from "./resolver-parts.js";
import { loadFoldMap, specPath } from "./fold-map.js";
import { checkSquashMerged, extractPrMarker, type MergeCheckDeps } from "./merge-check.js";
import { mintDocId } from "./doc-ids.js";
import { readIteratePointer } from "./pointer.js";
import { detectScenario, type ScenarioInputs } from "./scenario.js";
import {
  buildCommitArtifact,
  buildRequirementArtifact,
  buildSpecArtifact,
} from "./artifacts.js";
import {
  eventsPath,
  findWorkCompleted,
  iterateDocPath,
  readIterateDoc,
  specCandidates,
  specHintCandidate,
} from "./iterate-record.js";
import {
  chooseRoot,
  isRegisteredWorktree,
  readAllowedRoots,
  resolveFirstDoc,
  MAX_DOC_BYTES,
  type GitRunner,
} from "./worktree-roots.js";
import {
  MISSION_CONTEXT_SCHEMA_VERSION,
  type ArtifactDescriptor,
  type MissionContext,
  type MissionContextAssociation,
} from "./types.js";

export interface ResolveRequest {
  taskId: string;
  sessionUuid: string;
  projectId: string;
  projectRoot: string;
  /** Server-read transcript (bounded tail) — never client-supplied (§5.1). */
  transcript: string;
  /** Task facts the server owns (from its own store, not the client). */
  phaseTaskId: string | null;
  taskRunId: string | null;
  campaignSlug: string | null;
  hasCampaignRecord: boolean;
  /** True when the session is actively working — gates the association write. */
  live: boolean;
  actions: ScenarioInputs["actions"];
  hasValidRunConfig: boolean;
  /**
   * The task's persisted association. Read from the server's own store; it is
   * how a FINALIZED iterate still resolves after its pointer was pruned.
   */
  association?: MissionContextAssociation | null;
}

export interface ResolveDeps {
  git?: GitRunner;
  merge?: MergeCheckDeps;
}

/**
 * Resolve the Mission context. Pure read — the caller performs the association
 * write, because persistence needs the store's lock and this module stays
 * side-effect-free (making the "one write" auditable in exactly one place).
 */
export function resolveMissionContext(
  req: ResolveRequest,
  deps: ResolveDeps = {},
): { context: MissionContext; associateRunId: string | null } {
  const { projectRoot, sessionUuid } = req;

  const pointer = readIteratePointer(projectRoot, sessionUuid);
  const decision = detectScenario({
    pointer,
    association: req.association ?? null,
    actions: req.actions,
    hasValidRunConfig: req.hasValidRunConfig,
    phaseTaskId: req.phaseTaskId,
    taskRunId: req.taskRunId,
    campaignSlug: req.campaignSlug,
    hasCampaignRecord: req.hasCampaignRecord,
  });

  const baseRevPaths = [specPath(projectRoot), eventsPath(projectRoot)];

  // A pointer that EXISTS for this session but failed validation is an
  // integrity signal, not an absence: AC5 requires typed `unavailable` (and no
  // association), never a fall-through to "No run data yet" (openai HIGH).
  if (decision.pointerInvalidReason) {
    return {
      context: {
        ...emptyContext(
          decision.scenario,
          decision.missionTabVisible,
          computeSourceRev(baseRevPaths, [decision.pointerInvalidReason]),
        ),
        artifacts: unavailableArtifacts(
          "This session's run record could not be verified, so its artifacts are unavailable.",
        ),
      },
      associateRunId: null,
    };
  }

  // Scenarios 1/3/4/5 keep today's behavior verbatim — Slice 1 is ADDITIVE for
  // scenario 2 only. No artifacts are emitted here, so the existing rail and
  // campaign progress render exactly as before (no-regression AC).
  if (decision.scenario !== "iterate" || !decision.runId) {
    const rev = computeSourceRev(baseRevPaths, [decision.scenario]);
    return {
      context: emptyContext(decision.scenario, decision.missionTabVisible, rev),
      associateRunId: null,
    };
  }

  const runId = decision.runId;
  const slug = pointer.status === "ok" ? pointer.pointer.slug : null;
  const worktreePath = pointer.status === "ok" ? pointer.pointer.worktreePath : null;

  const roots = readAllowedRoots(projectRoot, deps.git);

  // A pointer naming a worktree git does not know describes a tree we cannot
  // vouch for. AC5: typed `unavailable` + NO persistence, never a quiet fall
  // back to the project root (external code review, openai HIGH).
  if (worktreePath && !isRegisteredWorktree(roots, worktreePath)) {
    return {
      context: {
        ...emptyContext(
          "iterate",
          true,
          computeSourceRev(baseRevPaths, [runId, "unregistered_worktree"]),
        ),
        runId,
        artifacts: unavailableArtifacts(
          "This run's working copy is not a registered worktree of this project.",
        ),
      },
      associateRunId: null,
    };
  }

  const chosen = chooseRoot(roots, worktreePath);

  // --- Records (read first: the spec hint below comes from the agent-doc) ---
  const iterateDoc = readIterateDoc(projectRoot, runId);

  // --- Spec -----------------------------------------------------------------
  // Known layout first; the framework-recorded (validated) hint is the
  // fallback that covers campaign sub-iterate specs — see specHintCandidate.
  const hint = specHintCandidate(iterateDoc?.specHint);
  const candidates = hint ? [...specCandidates(runId, slug), hint] : specCandidates(runId, slug);
  const doc = resolveFirstDoc(chosen.root, candidates);

  // The rev covers EVERY source used — including the iterate document and the
  // agent-doc, so editing either invalidates the cache (openai MEDIUM).
  const rev = computeSourceRev(
    [...baseRevPaths, iterateDocPath(projectRoot, runId), ...(doc.ok ? [doc.absolute] : [])],
    [runId, chosen.root, req.taskId],
  );
  const cacheKey = `${projectRoot}::${sessionUuid}::${runId}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.rev === rev) {
    return { context: hit.context, associateRunId: req.live ? runId : null };
  }

  let documentId: string | null = null, title: string | null = null, specText: string | null = null;
  if (doc.ok) {
    const matched = candidates.find((parts) =>
      doc.absolute.replace(/\\/g, "/").endsWith(parts.join("/")),
    );
    const rel = (matched ?? candidates[0]).join("/");
    title = rel.slice(rel.lastIndexOf("/") + 1);
    documentId = mintDocId({
      t: req.taskId,
      s: sessionUuid,
      p: projectRoot,
      r: runId,
      root: chosen.root,
      rel,
      rev,
      f: docFingerprint(doc.absolute),
    });
    specText = readBounded(doc.absolute);
  }

  // --- Records --------------------------------------------------------------
  const events = findWorkCompleted(projectRoot, runId);
  const foldMap = loadFoldMap(projectRoot);
  const run = events.status === "found" ? events.run : null;

  // --- Commit + merge -------------------------------------------------------
  const marker = extractPrMarker(req.transcript);
  // Only check merge once the run has actually completed — a per-poll git call
  // for a still-running iterate would be pure waste (§5.3 "never per-poll").
  const merge =
    run && marker
      ? checkSquashMerged(projectRoot, marker.number, { git: deps.git, ...deps.merge })
      : "unknown";

  const artifacts: ArtifactDescriptor[] = [
    buildSpecArtifact({
      documentId,
      title,
      denied: !doc.ok && doc.reason === "denied",
      fromWorktree: chosen.isWorktree,
      intent: run?.intent ?? null,
    }),
    buildRequirementArtifact({ foldMap, doc: iterateDoc, events, specText }),
    buildCommitArtifact({
      events,
      prNumber: marker?.number ?? null,
      prUrl: marker?.url ?? null,
      merge,
    }),
  ];

  const requirement = artifacts[1];
  const servesFrId =
    requirement.kind === "requirement" && requirement.detail?.rows.length
      ? requirement.detail.rows[0].displayFrId
      : null;

  const context: MissionContext = {
    schemaVersion: MISSION_CONTEXT_SCHEMA_VERSION,
    scenario: "iterate",
    missionTabVisible: true,
    runId,
    artifacts,
    tests: run?.tests ?? null,
    servesFrId,
    sourceRev: rev,
  };

  if (cache.size >= CACHE_CAP) cache.clear();
  cache.set(cacheKey, { rev, context });

  // The association is offered ONLY for a live resolve — a post-hoc read must
  // not stamp a run onto a task that was never observed running (§5).
  return { context, associateRunId: req.live ? runId : null };
}

/**
 * Re-resolve a document for the detail endpoint. Exported for the route + tests.
 *
 * `expectFingerprint` implements AC3's "changed → stale": the descriptor
 * promised a specific revision of this document, so if the file has since been
 * rewritten we report `stale` rather than quietly serving different content
 * under an id the client believes points at what it was shown.
 */
export function readDocumentBody(
  root: string,
  relParts: string[],
  expectFingerprint?: string,
):
  | { ok: true; body: string }
  | { ok: false; reason: "denied" | "not_found" | "too_large" | "changed" } {
  const r = resolveFirstDoc(root, [relParts]);
  if (!r.ok) return { ok: false, reason: r.reason === "denied" ? "denied" : "not_found" };
  if (r.sizeBytes > MAX_DOC_BYTES) return { ok: false, reason: "too_large" };
  if (!existsSync(r.absolute)) return { ok: false, reason: "not_found" };
  if (expectFingerprint && docFingerprint(r.absolute) !== expectFingerprint) {
    return { ok: false, reason: "changed" };
  }
  const body = readBounded(r.absolute);
  if (body == null) return { ok: false, reason: "not_found" };
  return { ok: true, body };
}
