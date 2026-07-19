/*
 * external/mission-context/facts-slice3.ts — the pipeline + campaign scenario
 * inputs, gathered SERVER-side from authoritative sources only (S3).
 *
 * Same trust rule as `facts.ts`: nothing here comes from the request. The client
 * sends a task id; the run-config, the phase-task table and the campaign records
 * are all read by the server from its own project view.
 *
 * The one rule these two functions exist to enforce: an I/O or parse failure
 * MUST surface as `unavailable`, never as an empty result. "We could not read
 * the run-config" and "this run has no phases" are different facts, and the
 * whole 5-state artifact model is downstream of keeping them apart.
 */

import { readCampaigns } from "../../core/campaign-store.js";
import { readStatusJson } from "../../core/campaign-status-json.js";
import { resolveCampaignsDir } from "../../core/campaign-paths.js";
import type { RunConfigReadResult } from "../../core/run-config-reader.js";
import type {
  CampaignFact,
  CampaignStepFacts,
} from "../../core/mission-context/campaign-artifacts.js";
import type { PipelineFact } from "../../core/mission-context/pipeline-artifacts.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Non-negative integer or null. A count we cannot read NEVER becomes zero. */
function count(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null;
}

/**
 * Resolve a phase task by EXACT id (CONTRACT §10 Slice 3, "without conflating
 * phase tasks"). A run holds many tasks and, once splits exist, many for the
 * same phase — so the id is the only safe key.
 */
export function buildPipelineFact(
  runConfig: RunConfigReadResult,
  phaseTaskId: string | null,
): PipelineFact {
  if (!phaseTaskId) return { status: "unavailable" };

  // `missing` / `v1_legacy` / `invalid` all mean the same thing HERE: this task
  // claims a pipeline linkage and we cannot verify it. None of them is evidence
  // that the phase does not exist.
  if (runConfig.status !== "ok") return { status: "unavailable" };

  const runId = runConfig.config.runId;
  const task = runConfig.config.phase_tasks.find((t) => t.phaseTaskId === phaseTaskId);
  if (!task) return { status: "task_not_found", runId };

  return {
    status: "ok",
    runId,
    task: {
      phaseTaskId: task.phaseTaskId,
      phase: task.phase,
      splitId: str(task.splitId),
      status: task.status,
      slashCommand: str(task.slashCommand),
      title: str(task.title),
      description: str(task.description),
      startedAt: str(task.startedAt),
      completedAt: str(task.completedAt),
      executionCount: count(task.executionCount),
      errors: Array.isArray(task.errors) ? task.errors.filter((e): e is string => typeof e === "string") : [],
      // Display-only strings. The producer records these with no documented
      // root, so they are never turned into links (see pipeline-artifacts.ts).
      outputs: Array.isArray(task.result?.artifacts)
        ? task.result.artifacts.filter((a): a is string => typeof a === "string")
        : [],
    },
  };
}

/**
 * Read the campaign record for `slug`, enriched with the per-unit test counts
 * that `campaign-store` does not surface.
 *
 * Two reads of one tiny file rather than widening `CampaignStep`, which the
 * campaigns board also consumes and which sits at its size ceiling. `status.json`
 * is the campaign's OWN authoritative per-unit record — it carries commit,
 * branch and test counts — so no cross-directory search for a `runs/<loop_id>/`
 * result file is needed or wanted (see the ADR).
 */
export function getCampaignFact(
  project: ExternalRouteProjectView,
  slug: string | null,
): CampaignFact {
  if (!slug) return { status: "unavailable" };

  try {
    const dir = resolveCampaignsDir({ path: project.path, synthesized: project.synthesized });
    if (!dir.ok) return { status: "unavailable" };

    const record = readCampaigns(dir.absolute, dir.projectRoot).find((c) => c.slug === slug);
    if (!record) return { status: "unavailable" };

    // Per-unit extras straight from status.json, keyed by id.
    const raw = readStatusJson(`${dir.absolute}/${record.slug}`);
    const extras = new Map<string, Record<string, unknown>>();
    if (Array.isArray(raw?.sub_iterates)) {
      for (const si of raw.sub_iterates as unknown[]) {
        if (si && typeof si === "object" && !Array.isArray(si)) {
          const o = si as Record<string, unknown>;
          const id = str(o.id);
          if (id) extras.set(id, o);
        }
      }
    }

    const steps: CampaignStepFacts[] = record.steps.map((s) => {
      const e = extras.get(s.id);
      return {
        id: s.id,
        title: s.title,
        status: s.status,
        specPath: s.specPath,
        commit: s.commit,
        branch: s.branch,
        testsPassed: count(e?.tests_passed),
        testsTotal: count(e?.tests_total),
      };
    });

    return {
      status: "ok",
      campaign: {
        slug: record.slug,
        intent: str(record.intent),
        lifecycle: record.status,
        branchStrategy: record.branchStrategy,
        done: record.done,
        total: record.total,
        steps,
      },
    };
  } catch {
    // An unreadable store is NOT an empty campaign.
    return { status: "unavailable" };
  }
}
