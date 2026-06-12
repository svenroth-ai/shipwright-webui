/*
 * campaign-store.ts — read-only reader for Shipwright iterate campaigns under
 * `<project>/.shipwright/planning/iterate/campaigns/<slug>/`.
 *
 * Producer/consumer boundary (see iterate spec "Affected Boundaries"):
 *   - `campaign.md`  — `campaign_init.py init_campaign` (parsed by
 *      `campaign-parse.ts`: frontmatter + `## Intent` + `## Sub-Iterates` table).
 *   - `status.json`  — `campaign_init.py` + `campaign_progress.py
 *      cmd_update_status`: `{ branch_strategy, sub_iterates:[{id, slug,
 *      status, commit, branch, …}] }`.
 *
 * Resolution contract:
 *   - `status.json` is authoritative for per-step status / commit / branch.
 *   - `campaign.md` table provides ordering + titles (status.json has no title).
 *   - status.json absent → status derived from the campaign.md table column.
 *   - Every campaign dir is parsed under its own try/catch: a malformed or
 *     half-written file (the 3 s poll WILL race a Python write) is tolerated —
 *     a bad `status.json` falls back to the table; a dir with nothing parseable
 *     is skipped (warn-logged). One bad campaign never hides the others.
 *
 * No cache: a single active project polled at 3 s reads a handful of tiny files.
 */

import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { isWithin } from "./campaign-paths.js";
import {
  parseFrontmatter,
  parseIntent,
  parseSubIteratesTable,
  parseSpecFrontmatter,
} from "./campaign-parse.js";
import { readStatusJson, pickLifecycle } from "./campaign-status-json.js";
import type {
  CampaignLifecycleStatus,
  StatusSubIterate,
} from "./campaign-status-json.js";

export type CampaignStepStatus =
  | "pending"
  | "in_progress"
  | "complete"
  | "failed"
  | "escalated";

// CampaignLifecycleStatus + status.json reading live in campaign-status-json.ts
// (the JSON-side input-reader, sibling of campaign-parse.ts). Re-exported so
// consumers importing the Campaign shape from here keep one import site.
export type { CampaignLifecycleStatus };

export interface CampaignStep {
  id: string;
  slug: string;
  title: string;
  status: CampaignStepStatus;
  /** Project-root-relative, POSIX-separated path to the sub-iterate spec.
   *  Null when the file is missing, escapes the root, or holds shell-hostile
   *  chars (so the copy-launch command is never malformed). */
  specPath: string | null;
  commit: string | null;
  branch: string | null;
  /** Forward-compat plan-first/risk marker read from the sub-iterate spec's
   *  optional frontmatter (`plan_first`/`risk`). False for every campaign that
   *  exists today (the producer writes no frontmatter); the autonomous-launch
   *  guardrail surfaces it the day a producer emits one. See
   *  `campaign-parse.ts parseSpecFrontmatter`. */
  planFirst: boolean;
}

export interface Campaign {
  slug: string;
  intent: string;
  branchStrategy: string | null;
  expandsTriage: string | null;
  /** Producer-owned lifecycle status; null when the producer hasn't written
   *  one yet (legacy → consumers fall back to done/total). */
  status: CampaignLifecycleStatus | null;
  steps: CampaignStep[];
  done: number;
  total: number;
  /** First step whose status is not complete (the step the campaign is blocked
   *  on, incl. a failed/escalated step that needs a re-run). Null when all
   *  complete. */
  nextPending: { id: string; specPath: string | null } | null;
  /**
   * True when an autonomous run is currently attached to this campaign — a live
   * `loop_state.json` `in_progress` unit, OR a `status.json` step `in_progress`.
   * Populated by `routes/campaigns.ts` (this reader leaves it undefined). The
   * launch CTAs disable/relabel on it to prevent spawning a SECOND orchestrator
   * on the same campaign. Optional for deploy-skew safety. See `core/campaign-loop-state.ts`.
   */
  attachedRun?: boolean;
  /** Reconstructed purely from tracked events.jsonl when the campaign dir is absent (a clone): completed subs only, total==done, specPath null. Set by `core/campaign-events.ts`. */
  derivedFromEvents?: boolean;
  /** True when an operator manually dismissed this campaign from the board (a webui-owned quittance, NOT a producer status). Set by `routes/campaigns.ts` from `core/dismissed-campaigns-store.ts`; optional for deploy-skew. */
  dismissed?: boolean;
}

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "in_progress",
  "complete",
  "failed",
  "escalated",
]);

/**
 * True when a derived spec path holds a double-quote or any C0 control char.
 * Such a path would break out of the double-quoted launch command, so we
 * null it out rather than hand the operator a malformed string. Spaces and
 * hyphens are fine — slugs are full of hyphens and the command quotes the path.
 */
function hasUnsafeChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x22) return true; // C0 control or '"'
  }
  return false;
}

/**
 * Derive a step's `{ specPath, planFirst }` from its sub-iterate spec file in
 * ONE existence + symlink-containment guard (external review HIGH #6/#7):
 *   - specPath: project-root-relative POSIX path, or null when the file is
 *     missing / escapes the root / holds shell-hostile chars.
 *   - planFirst: the forward-compat plan-first/risk frontmatter marker (false
 *     for every campaign today — the producer writes none).
 * Tolerant: any miss / escape / torn read → `{ specPath:null, planFirst:false }`.
 */
function deriveSpecMeta(
  projectRoot: string,
  campaignDir: string,
  id: string,
  slug: string,
): { specPath: string | null; planFirst: boolean } {
  const miss = { specPath: null, planFirst: false };
  if (!slug) return miss; // can't form the `<id>-<slug>.md` filename
  const specFile = path.join(campaignDir, "sub-iterates", `${id}-${slug}.md`);
  if (!existsSync(specFile)) return miss;
  let planFirst = false;
  try {
    if (!isWithin(projectRoot, realpathSync(specFile))) return miss;
    planFirst = parseSpecFrontmatter(readFileSync(specFile, "utf-8")).planFirst;
  } catch {
    return miss;
  }
  const rel = path.relative(projectRoot, specFile);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return { specPath: null, planFirst };
  const posix = rel.split(path.sep).join("/");
  if (hasUnsafeChar(posix)) return { specPath: null, planFirst };
  return { specPath: posix, planFirst };
}

interface StepBase {
  id: string;
  slug: string;
  title: string;
  tableStatus: string;
}

/** Build a single Campaign from its dir, or null when nothing parseable. */
function buildCampaign(
  campaignDir: string,
  slug: string,
  projectRoot: string,
): Campaign | null {
  const mdPath = path.join(campaignDir, "campaign.md");
  let md = "";
  if (existsSync(mdPath)) {
    try {
      md = readFileSync(mdPath, "utf-8");
    } catch {
      md = "";
    }
  }
  const status = readStatusJson(campaignDir);

  // Neither source present → not a campaign (empty/garbage dir) → skip.
  if (!md && !status) return null;

  const fm = parseFrontmatter(md);
  const tableRows = parseSubIteratesTable(md);

  const statusById = new Map<string, StatusSubIterate>();
  const statusSubs: StatusSubIterate[] = Array.isArray(status?.sub_iterates)
    ? (status!.sub_iterates as StatusSubIterate[])
    : [];
  for (const si of statusSubs) {
    if (si && typeof si.id === "string") statusById.set(si.id, si);
  }

  // Membership + order: the campaign.md table when present, else status.json.
  const bases: StepBase[] =
    tableRows.length > 0
      ? tableRows.map((r) => ({
          id: r.id,
          slug: r.slug,
          title: r.title,
          tableStatus: r.status,
        }))
      : statusSubs
          .filter((si) => si && typeof si.id === "string")
          .map((si) => ({
            id: si.id as string,
            slug: typeof si.slug === "string" ? si.slug : "",
            title: typeof si.slug === "string" ? si.slug : (si.id as string),
            tableStatus: "",
          }));

  const steps: CampaignStep[] = bases.map((b) => {
    const sj = statusById.get(b.id);
    const stepSlug =
      b.slug || (sj && typeof sj.slug === "string" ? sj.slug : "");
    // status.json wins; else the table column; else pending.
    const resolvedStatus =
      sj && typeof sj.status === "string" && VALID_STATUSES.has(sj.status)
        ? (sj.status as CampaignStepStatus)
        : VALID_STATUSES.has(b.tableStatus)
          ? (b.tableStatus as CampaignStepStatus)
          : "pending";
    const specMeta = deriveSpecMeta(projectRoot, campaignDir, b.id, stepSlug);
    return {
      id: b.id,
      slug: stepSlug,
      title: b.title || stepSlug || b.id,
      status: resolvedStatus,
      specPath: specMeta.specPath,
      planFirst: specMeta.planFirst,
      commit: sj && typeof sj.commit === "string" ? sj.commit : null,
      branch: sj && typeof sj.branch === "string" ? sj.branch : null,
    };
  });

  const done = steps.filter((s) => s.status === "complete").length;
  const nextStep = steps.find((s) => s.status !== "complete") ?? null;

  const branchStrategy =
    fm.branch_strategy ||
    (typeof status?.branch_strategy === "string"
      ? (status.branch_strategy as string)
      : "") ||
    null;
  const expandsTriage = fm.expandsTriage || fm.expands_triage || null;

  return {
    slug,
    intent: parseIntent(md),
    branchStrategy,
    expandsTriage,
    status: pickLifecycle(status, fm),
    steps,
    done,
    total: steps.length,
    nextPending: nextStep
      ? { id: nextStep.id, specPath: nextStep.specPath }
      : null,
  };
}

/**
 * Read every campaign under `campaignsDir`. Returns [] when the dir is
 * missing/unreadable. `projectRoot` (realpath-resolved) is used to derive
 * project-root-relative spec paths. Sorted by slug descending (date-prefixed
 * slugs → newest first; assumes a sortable prefix).
 */
export function readCampaigns(
  campaignsDir: string,
  projectRoot: string,
): Campaign[] {
  if (!existsSync(campaignsDir)) return [];
  let names: string[];
  try {
    names = readdirSync(campaignsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const campaigns: Campaign[] = [];
  for (const slug of names) {
    try {
      const c = buildCampaign(path.join(campaignsDir, slug), slug, projectRoot);
      if (c) campaigns.push(c);
    } catch (err) {
      // Per-campaign isolation (external review HIGH #2): one bad dir must
      // never hide the rest or 500 the route.
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "campaign read failed",
          slug,
          error: String(err).slice(0, 200),
        }),
      );
    }
  }
  campaigns.sort((a, b) => (a.slug < b.slug ? 1 : a.slug > b.slug ? -1 : 0));
  return campaigns;
}
