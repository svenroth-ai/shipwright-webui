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
import { readStatusJsonRead, pickLifecycle } from "./campaign-status-json.js";
import type {
  CampaignLifecycleStatus,
  StatusSubIterate,
} from "./campaign-status-json.js";
import type {
  Campaign,
  CampaignProvenance,
  CampaignStep,
  CampaignStepStatus,
} from "./campaign-types.js";

// The shapes live in `campaign-types.ts` (split at the 300-LOC rule); re-exported
// so every existing consumer's import site keeps working unchanged.
export type {
  Campaign,
  CampaignProvenance,
  CampaignStep,
  CampaignStepStatus,
} from "./campaign-types.js";

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
  // A campaign.md that is THERE and unreadable is a fault; one that is simply
  // absent is not. The two used to be one empty string.
  let mdUnreadable = false;
  if (existsSync(mdPath)) {
    try {
      md = readFileSync(mdPath, "utf-8");
    } catch {
      md = "";
      mdUnreadable = true;
    }
  }
  const statusRead = readStatusJsonRead(campaignDir);
  const status = statusRead.state === "ok" ? statusRead.json : null;

  // Neither source present → not a campaign (empty/garbage dir) → skip.
  // Unchanged on purpose: a dir with NOTHING usable already resolves to a
  // typed `unavailable` downstream (no record found), which is honest. The
  // degradation this iterate fixes is the one that produces a campaign object.
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
    // status.json wins; else the table column; else pending. The SOURCE is
    // recorded alongside the value — a status is a claim, and this is its basis.
    const fromJson = sj && typeof sj.status === "string" && VALID_STATUSES.has(sj.status);
    const fromTable = VALID_STATUSES.has(b.tableStatus);
    const resolvedStatus = fromJson
      ? (sj!.status as CampaignStepStatus)
      : fromTable
        ? (b.tableStatus as CampaignStepStatus)
        : "pending";
    const statusSource: CampaignStep["statusSource"] = fromJson
      ? "status_json"
      : fromTable
        ? "campaign_md"
        // Neither source named this unit: `pending` is this reader's default,
        // not anybody's record of the unit.
        : "default";
    const specMeta = deriveSpecMeta(projectRoot, campaignDir, b.id, stepSlug);
    return {
      id: b.id,
      slug: stepSlug,
      title: b.title || stepSlug || b.id,
      status: resolvedStatus,
      statusSource,
      specPath: specMeta.specPath,
      planFirst: specMeta.planFirst,
      commit: sj && typeof sj.commit === "string" ? sj.commit : null,
      branch: sj && typeof sj.branch === "string" ? sj.branch : null,
    };
  });

  const done = steps.filter((s) => s.status === "complete").length;
  const nextStep = steps.find((s) => s.status !== "complete") ?? null;

  // Where the STATUS claims came from. `status.json` only counts when it
  // actually supplied a usable status for at least one step — a file that
  // parsed but lists nobody has told us nothing about these units.
  const anyFromStatusJson = bases.some((b) => {
    const sj = statusById.get(b.id);
    return !!sj && typeof sj.status === "string" && VALID_STATUSES.has(sj.status);
  });
  const provenance: CampaignProvenance = {
    statusSource: anyFromStatusJson
      ? "status_json"
      : steps.length > 0
        ? "campaign_md"
        : "none",
    // Only a source that EXISTED and failed. An absent status.json is an
    // ordinary legacy campaign, not a degradation.
    degraded: statusRead.state === "unreadable" || mdUnreadable,
    statusJsonState: statusRead.state,
    campaignMdUnreadable: mdUnreadable,
  };

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
    provenance,
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
