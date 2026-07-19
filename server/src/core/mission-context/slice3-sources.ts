/*
 * core/mission-context/slice3-sources.ts — path resolution + document minting
 * for the native pipeline and campaign artifacts (S3).
 *
 * Same discipline as the iterate path (§5.1c): every document path is built from
 * the KNOWN LAYOUT, never from a producer- or title-supplied sub-path, every
 * segment is re-checked against the strict slug grammar, and the read itself
 * goes through `resolveFirstDoc` → `pathGuard` + `realPathGuard`. An id is
 * minted ONLY for a document that actually resolved, which is what keeps AC3's
 * "no dead links" true by construction rather than by inspection.
 *
 * The campaign SLUG used for path building comes from the matched campaign
 * RECORD (a real directory name the server itself read), never from the task
 * title the user can edit.
 *
 * Cache note: unlike the iterate path these contexts are NOT cached. The iterate
 * cache exists because that path reads a 0.9 MB traceability manifest, a 0.6 MB
 * decision log and shells out to git; a pipeline or campaign resolve reads a
 * handful of small JSON/Markdown files. Not caching means run-config and
 * `status.json` — both of which change DURING a run — can never be served stale,
 * which is the failure mode this campaign has already had to fix once.
 */

import path from "node:path";

import { mintDocId } from "./doc-ids.js";
import { isSafeSlug } from "./pointer.js";
import { docFingerprint } from "./resolver-parts.js";
import { resolveFirstDoc } from "./worktree-roots.js";
import { SPEC_REL_PARTS } from "./fold-map.js";
import {
  buildCampaignBriefArtifact,
  buildCampaignProgressArtifact,
  buildRunbookArtifact,
  buildSubIterateArtifact,
  selectActiveStep,
  type CampaignFact,
  type ResolvedDoc,
} from "./campaign-artifacts.js";
import { buildPhaseArtifact, buildPipelineSpecArtifact, type PipelineFact } from "./pipeline-artifacts.js";
import { computeSourceRev, emptyContext } from "./resolver-parts.js";
import type { ArtifactDescriptor, MissionContext, MissionScenario } from "./types.js";

const CAMPAIGNS_BASE = [".shipwright", "planning", "iterate", "campaigns"];

interface MintCtx {
  taskId: string;
  sessionUuid: string;
  projectRoot: string;
  /** Binding value for the id — the pipeline runId or the campaign slug. */
  ref: string;
  rev: string;
}

/**
 * Resolve ONE known-layout document and mint its id.
 *
 * `denied` is kept SEPARATE from "not found": a guard refusal means the file is
 * there and we would not read it, which is an integrity signal the rail must
 * show, while a missing file is an ordinary absence that hides. Returning both
 * from one call also keeps this to a single filesystem resolve.
 */
function resolveDoc(
  ctx: MintCtx,
  constParts: string[],
  varParts: string[],
): { doc: ResolvedDoc | null; denied: boolean } {
  // ONLY the variable segments are grammar-checked. The constant layout prefix
  // is a literal in this file — and `.shipwright` would fail the check anyway,
  // since the id grammar forbids a leading dot precisely so that no
  // caller-supplied segment can ever be a dot-segment.
  if (varParts.length === 0 || !varParts.every((p) => isSafeSlug(p))) {
    return { doc: null, denied: false };
  }
  const relParts = [...constParts, ...varParts];

  const found = resolveFirstDoc(ctx.projectRoot, [relParts]);
  if (!found.ok) return { doc: null, denied: found.reason === "denied" };

  return {
    doc: {
      documentId: mintDocId({
        t: ctx.taskId,
        s: ctx.sessionUuid,
        p: ctx.projectRoot,
        r: ctx.ref,
        root: ctx.projectRoot,
        rel: relParts.join("/"),
        rev: ctx.rev,
        f: docFingerprint(path.join(ctx.projectRoot, ...relParts)),
      }),
      title: relParts[relParts.length - 1],
    },
    denied: false,
  };
}

// ---------------------------------------------------------------------------
// Pipeline (scenario 3)
// ---------------------------------------------------------------------------

/** Paths whose mtime a pipeline response depends on (absent ones included). */
export function pipelineRevPaths(projectRoot: string): string[] {
  return [
    path.join(projectRoot, "shipwright_run_config.json"),
    path.join(projectRoot, ...SPEC_REL_PARTS),
  ];
}

export function buildPipelineArtifacts(
  ctx: Omit<MintCtx, "ref">,
  fact: PipelineFact,
): ArtifactDescriptor[] {
  const ref = fact.status === "unavailable" ? "pipeline" : fact.runId;
  // The adopted spec is entirely constant layout — no variable segment at all.
  const spec = resolveDoc({ ...ctx, ref }, SPEC_REL_PARTS.slice(0, -1), SPEC_REL_PARTS.slice(-1));

  return [
    buildPhaseArtifact(fact),
    buildPipelineSpecArtifact({
      documentId: spec.doc?.documentId ?? null,
      title: spec.doc?.title ?? null,
      denied: spec.denied,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Campaign (scenario 5)
// ---------------------------------------------------------------------------

/** Paths whose mtime a campaign response depends on (absent ones included). */
export function campaignRevPaths(projectRoot: string, slug: string | null): string[] {
  if (!slug || !isSafeSlug(slug)) return [];
  const dir = path.join(projectRoot, ...CAMPAIGNS_BASE, slug);
  return [
    path.join(dir, "campaign.md"),
    path.join(dir, "RUNBOOK.md"),
    // status.json changes on EVERY unit transition. Registering it — present or
    // not — is what lets a live campaign's progress actually move.
    path.join(dir, "status.json"),
  ];
}

/**
 * Take a campaign-store `specPath` (project-root-relative, POSIX) and return the
 * segments BELOW the constant campaigns prefix, or null if it is unusable.
 *
 * The path must land at `campaigns/<thisSlug>/sub-iterates/<file>` EXACTLY.
 *
 * Pinning it to `thisSlug` is the load-bearing part (external code review,
 * openai MEDIUM). A prefix check that only required "somewhere under
 * `campaigns/`" would let one campaign's record point THIS campaign's "current
 * unit spec" at ANOTHER campaign's document — precisely the campaign-level /
 * unit-level confusion this slice exists to prevent, and it would look entirely
 * normal on screen. Requiring `sub-iterates` likewise stops a record from
 * dressing the RUNBOOK up as a unit's brief.
 *
 * The store already existence- and containment-checked the value; re-checking
 * here matters because a guard that only runs at the producer stops running the
 * day someone adds a second producer.
 */
function specPathParts(specPath: string | null, slug: string): string[] | null {
  if (typeof specPath !== "string" || specPath.length === 0) return null;

  const parts = specPath.replace(/\\/g, "/").split("/").filter((p) => p.length > 0);
  const expected = [...CAMPAIGNS_BASE, slug, "sub-iterates"];
  // Exactly one segment (the filename) may follow the fixed prefix.
  if (parts.length !== expected.length + 1) return null;
  for (let i = 0; i < expected.length; i++) {
    if (parts[i] !== expected[i]) return null;
  }

  const rest = parts.slice(CAMPAIGNS_BASE.length);
  return rest.every((p) => isSafeSlug(p)) ? rest : null;
}

export function buildCampaignArtifacts(
  ctx: Omit<MintCtx, "ref">,
  slug: string,
  fact: CampaignFact,
): ArtifactDescriptor[] {
  const mint: MintCtx = { ...ctx, ref: slug };
  const safeSlug = isSafeSlug(slug) ? slug : null;

  const brief = safeSlug ? resolveDoc(mint, CAMPAIGNS_BASE, [safeSlug, "campaign.md"]).doc : null;
  const runbook = safeSlug ? resolveDoc(mint, CAMPAIGNS_BASE, [safeSlug, "RUNBOOK.md"]).doc : null;

  const picked = fact.status === "ok" ? selectActiveStep(fact.campaign.steps) : null;
  // Pinned to `safeSlug`, not the raw slug: an unusable slug must not fall back
  // to matching whatever the record happens to name.
  const subParts = picked && safeSlug ? specPathParts(picked.step.specPath, safeSlug) : null;
  const subDoc = subParts ? resolveDoc(mint, CAMPAIGNS_BASE, subParts).doc : null;

  return [
    buildCampaignBriefArtifact(fact, brief),
    buildRunbookArtifact(fact, runbook),
    buildCampaignProgressArtifact(fact, picked?.step.id ?? null),
    buildSubIterateArtifact(fact, subDoc),
  ];
}

// ---------------------------------------------------------------------------
// The non-iterate branch of the resolver
// ---------------------------------------------------------------------------

export interface NonIterateInput {
  taskId: string;
  sessionUuid: string;
  projectRoot: string;
  scenario: MissionScenario;
  missionTabVisible: boolean;
  /** Sources every scenario shares (the adopted spec + the event log). */
  baseRevPaths: string[];
  pipeline: PipelineFact | null | undefined;
  campaign: CampaignFact | null | undefined;
  campaignSlug: string | null;
}

/**
 * Build the context for every scenario that is NOT a resolved iterate.
 *
 * `pipeline` and `campaign` are scenarios 3 and 5; `plain` and `custom_actions`
 * carry no artifact rail at all and return the empty context unchanged.
 *
 * An ABSENT fact (an older caller that never gathered one) is treated as
 * `unavailable` rather than skipped — the artifacts then render "currently
 * unavailable", which is the honest reading of "nobody told us", and keeps a
 * wiring mistake visible instead of silently producing an empty rail.
 */
export function buildNonIterateContext(input: NonIterateInput): MissionContext {
  const { scenario, projectRoot, missionTabVisible } = input;

  if (scenario === "pipeline") {
    const fact: PipelineFact = input.pipeline ?? { status: "unavailable" };
    const rev = computeSourceRev(
      [...input.baseRevPaths, ...pipelineRevPaths(projectRoot)],
      [scenario, fact.status, input.taskId],
    );
    return {
      ...emptyContext(scenario, missionTabVisible, rev),
      runId: fact.status === "unavailable" ? null : fact.runId,
      artifacts: buildPipelineArtifacts(
        { taskId: input.taskId, sessionUuid: input.sessionUuid, projectRoot, rev },
        fact,
      ),
    };
  }

  if (scenario === "campaign" && input.campaignSlug) {
    const fact: CampaignFact = input.campaign ?? { status: "unavailable" };
    const rev = computeSourceRev(
      [...input.baseRevPaths, ...campaignRevPaths(projectRoot, input.campaignSlug)],
      [scenario, fact.status, input.taskId],
    );
    return {
      ...emptyContext(scenario, missionTabVisible, rev),
      artifacts: buildCampaignArtifacts(
        { taskId: input.taskId, sessionUuid: input.sessionUuid, projectRoot, rev },
        input.campaignSlug,
        fact,
      ),
    };
  }

  // plain / pure / custom_actions — narration + stage only, no rail (§4.5).
  return emptyContext(
    scenario,
    missionTabVisible,
    computeSourceRev(input.baseRevPaths, [scenario]),
  );
}
