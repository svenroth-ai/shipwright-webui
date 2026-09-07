/*
 * commit.ts — POST /api/external/org/leads/commit
 * (iterate-2026-09-07-leadwright-setup-wizard, W14).
 *
 * The wizard's Finish action. Re-merges the proposal against FRESH on-disk
 * state (never trusts the client's earlier verdict-time snapshot), checks
 * the resubmitted digest against the one the operator actually approved at
 * the verdict step (409 verdict_stale on drift — org-chart.json or
 * daemon-config.json changed between preview and commit), then performs
 * the three ordered writes via commit-writes.ts.
 *
 * Server-side validation here only re-checks the SHAPE constraints
 * leadwright's own published contract carries (kebab-case lead id, relative
 * charter/learnings paths, allowed_skills pattern, absolute daemon-config
 * path-shaped fields) — it never re-implements leadwright's semantic
 * judgment. That stays the verdict step's job, via the real check-setup.ts
 * subprocess.
 */
import type { Hono } from "hono";
import path from "node:path";

import { readOrgChartFull, type OrgChartFullReadResult } from "./org-chart-full-read.js";
import { daemonConfigReadCore, type DaemonConfigReadCoreResult } from "./daemon-config-read.js";
import { mergeLeadProposal, computeProposalDigest, canonicalStringify } from "./leadwright-proposal-merge.js";
import { writeNewCharterFile, writeDaemonConfigAddition, applyOrgChartLead, type WithOrgFileLockFn } from "./commit-writes.js";
import { withOrgFileLock, OrgFileSymlinkEscapeError } from "./org-file-lock.js";
import { readExistingLeadCharters, type ReadOrgFileFn } from "./existing-charters-read.js";
import { runLeadwrightPreflight } from "../../core/leadwright-preflight-transport.js";
import { validateCommitBody, type CommitRequestBody } from "./commit-validate.js";
import type { PreflightOrgChart } from "../../types/leadwright-preflight.js";

/** Not a dismissable toast — the client renders this string prominently and
 *  blocks the "done" state on it (W14: "restart the daemon" must be
 *  explicit, because daemon-config.json loads once at boot). */
export const RESTART_NOTICE =
  "leadwright's daemon reads daemon-config.json once at startup. This new lead will not run until you restart the leadwright daemon.";

export type { CommitRequestBody };

export interface CommitCoreDeps {
  leadsRoot: string;
  leadwrightCheckoutRoot: string | undefined;
  webuiBaseUrl: string;
  readOrgChartFullFn: (deps: { leadsRoot: string }) => OrgChartFullReadResult;
  daemonConfigReadFn: (deps: { leadsRoot: string; webuiBaseUrl: string }) => DaemonConfigReadCoreResult;
  withOrgFileLockFn?: WithOrgFileLockFn;
  writeCharterFn?: typeof writeNewCharterFile;
  readOrgFileFn?: ReadOrgFileFn;
  runLeadwrightPreflightFn?: typeof runLeadwrightPreflight;
}

export type CommitCoreResult =
  | { status: 200; body: { committed: true; leadId: string; restartRequired: true; restartNotice: string } }
  | { status: 200; body: { committed: false; stage: "daemon-config"; fragment: string } }
  | { status: 400; body: { error: string } }
  | { status: 403 | 404 | 500 | 502; body: { error: string; detail?: string } }
  | {
      status: 409;
      body: {
        error: "verdict_stale" | "org_chart_lead_exists" | "daemon_config_locked" | "org_chart_locked" | "verdict_not_ok";
        findings?: unknown;
      };
    }
  | { status: 503; body: { error: "leadwright_not_configured" } };

export async function commitCore(deps: CommitCoreDeps, requestBody: unknown): Promise<CommitCoreResult> {
  if (!deps.leadwrightCheckoutRoot) {
    return { status: 503, body: { error: "leadwright_not_configured" } };
  }

  const validated = validateCommitBody(requestBody);
  if (!validated.ok) {
    return { status: 400, body: { error: validated.reason } };
  }
  const { leadId, lead, daemonConfigAdditions, charterContent, expectedProposalDigest } = validated.value;

  const orgChartResult = deps.readOrgChartFullFn({ leadsRoot: deps.leadsRoot });
  if (orgChartResult.status !== 200) return orgChartResult;

  const daemonConfigResult = deps.daemonConfigReadFn({ leadsRoot: deps.leadsRoot, webuiBaseUrl: deps.webuiBaseUrl });
  if (daemonConfigResult.status !== 200) return daemonConfigResult;

  const existingCharters = readExistingLeadCharters(deps.leadsRoot, orgChartResult.body, leadId, deps.readOrgFileFn);
  const { proposal } = mergeLeadProposal({
    orgChart: orgChartResult.body,
    daemonConfig: daemonConfigResult.body,
    leadId,
    lead,
    daemonConfigAdditions,
    charterContent,
    existingCharters,
  });
  const actualDigest = computeProposalDigest(proposal);
  if (actualDigest !== expectedProposalDigest) {
    return { status: 409, body: { error: "verdict_stale" } };
  }

  // External-review fix (openai, high — security): `expectedProposalDigest`
  // is a PLAIN, unsigned SHA-256 of the proposal — proving nothing about
  // WHETHER leadwright's actual verdict was green, only that the client's
  // claimed digest matches what a fresh server-side merge produces for the
  // SAME proposal shape. Any caller able to compute that same hash (no
  // secret is involved) could submit a proposal with unsatisfied MUSS
  // findings and have it accepted without ever running /verdict. The digest
  // check above stays (it's still the right UX for "your answers changed
  // since you last checked"); this re-runs leadwright's REAL check-setup.ts
  // against the exact proposal about to be written, so the write can never
  // happen without a genuinely fresh, server-observed green verdict.
  const runPreflight = deps.runLeadwrightPreflightFn ?? runLeadwrightPreflight;
  const reverify = await runPreflight(deps.leadwrightCheckoutRoot, proposal);
  if (!reverify.ranOk) {
    return { status: 502, body: { error: "leadwright_transport_failed", detail: reverify.reason } };
  }
  if (!reverify.result.ok) {
    return { status: 409, body: { error: "verdict_not_ok", findings: reverify.result.findings } };
  }

  // Cheap fast-path (not the authoritative check — see below): a leadId
  // collision visible on the PRE-LOCK snapshot lets an obvious duplicate
  // 409 without ever touching the filesystem lock. mergeLeadProposal always
  // overwrites orgChart.leads[leadId] with the submitted lead before
  // hashing (so computeProposalDigest is identical whether or not that id
  // already exists on disk) — the digest check above can never see this
  // collision on its own.
  const existingLead = orgChartResult.body.leads[leadId];
  if (existingLead && canonicalStringify(existingLead) !== canonicalStringify(lead)) {
    return { status: 409, body: { error: "org_chart_lead_exists" } };
  }

  // External-review fix (openai, high — "regression"): the fast-path check
  // above reads a PRE-LOCK snapshot, so two genuinely concurrent commits
  // for the SAME NEW leadId can both pass it, then both race past the
  // unlocked charter.md write and the (once-)unconditional daemon-config
  // merge before org-chart.json's own conflict check catches only one —
  // the exact corruption shape the doubt-review fix closed for SEQUENTIAL
  // resubmission, but not for true concurrency. The fix: hold ONE lock on
  // org-chart.json (leadwright's activation source of truth) across the
  // ENTIRE write sequence, with a FRESH re-read + re-check as the first
  // thing inside it. A second racer simply cannot enter this critical
  // section until the first's full commit (all three writes) has finished
  // and released the lock — at which point its own fresh check correctly
  // sees the collision and 409s before writing anything.
  const withOrgFileLockFn = deps.withOrgFileLockFn ?? withOrgFileLock;
  const orgChartTarget = path.join(deps.leadsRoot, "org-chart.json");
  try {
    return await withOrgFileLockFn(orgChartTarget, { mustExist: true }, async (ctx) => {
      const freshOrgChart = JSON.parse(ctx.read()) as PreflightOrgChart;
      const freshExisting = freshOrgChart.leads[leadId];
      if (freshExisting && canonicalStringify(freshExisting) !== canonicalStringify(lead)) {
        return { status: 409, body: { error: "org_chart_lead_exists" } } as const;
      }

      const writeCharter = deps.writeCharterFn ?? writeNewCharterFile;
      try {
        writeCharter(deps.leadsRoot, leadId, charterContent);
      } catch (err) {
        if (err instanceof OrgFileSymlinkEscapeError) {
          return { status: 403, body: { error: "symlink_forbidden", detail: err.path } } as const;
        }
        throw err;
      }

      // Lock-contention error convention (CLAUDE.md rule 6 / DO-NOT #6),
      // mirrored from beat-register-release-request.ts: a genuine
      // cross-process lock conflict (proper-lockfile's ELOCKED, retries
      // exhausted) maps to its OWN named 409 rather than falling through to
      // the app-wide error handler's generic (and wrong-resource) message.
      let daemonConfigWrite;
      try {
        daemonConfigWrite = await writeDaemonConfigAddition(
          deps.leadsRoot,
          leadId,
          daemonConfigAdditions,
          deps.withOrgFileLockFn,
        );
      } catch (err) {
        if (err instanceof OrgFileSymlinkEscapeError) {
          return { status: 403, body: { error: "symlink_forbidden", detail: err.path } } as const;
        }
        if ((err as NodeJS.ErrnoException)?.code === "ELOCKED") {
          return { status: 409, body: { error: "daemon_config_locked" } } as const;
        }
        throw err;
      }
      if (daemonConfigWrite.status === "missing") {
        return {
          status: 200,
          body: { committed: false, stage: "daemon-config", fragment: daemonConfigWrite.fragment },
        } as const;
      }

      // Applies directly against the ALREADY-OPEN ctx from this same lock
      // acquisition — never a second, nested lock() call on org-chart.json.
      const applied = applyOrgChartLead(freshOrgChart, leadId, lead);
      if (applied.status === "conflict") {
        return { status: 409, body: { error: "org_chart_lead_exists" } } as const;
      }
      if (applied.status === "written") {
        ctx.write(JSON.stringify(applied.next, null, 2));
      }

      return {
        status: 200,
        body: { committed: true, leadId, restartRequired: true, restartNotice: RESTART_NOTICE },
      } as const;
    });
  } catch (err) {
    if (err instanceof OrgFileSymlinkEscapeError) {
      return { status: 403, body: { error: "symlink_forbidden", detail: err.path } };
    }
    if ((err as NodeJS.ErrnoException)?.code === "ELOCKED") {
      return { status: 409, body: { error: "org_chart_locked" } };
    }
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { status: 404, body: { error: "org_chart_missing" } };
    }
    throw err;
  }
}

export interface CommitRouteDeps extends Omit<CommitCoreDeps, "readOrgChartFullFn" | "daemonConfigReadFn"> {
  readOrgChartFullFn?: CommitCoreDeps["readOrgChartFullFn"];
  daemonConfigReadFn?: CommitCoreDeps["daemonConfigReadFn"];
}

export function registerCommitRoute(app: Hono, deps: CommitRouteDeps): void {
  const coreDeps: CommitCoreDeps = {
    leadsRoot: deps.leadsRoot,
    leadwrightCheckoutRoot: deps.leadwrightCheckoutRoot,
    webuiBaseUrl: deps.webuiBaseUrl,
    readOrgChartFullFn: deps.readOrgChartFullFn ?? readOrgChartFull,
    daemonConfigReadFn: deps.daemonConfigReadFn ?? daemonConfigReadCore,
    withOrgFileLockFn: deps.withOrgFileLockFn,
    writeCharterFn: deps.writeCharterFn,
    readOrgFileFn: deps.readOrgFileFn,
    runLeadwrightPreflightFn: deps.runLeadwrightPreflightFn,
  };
  app.post("/api/external/org/leads/commit", async (c) => {
    let requestBody: unknown;
    try {
      requestBody = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request_body" }, 400);
    }
    const result = await commitCore(coreDeps, requestBody);
    return c.json(result.body, result.status);
  });
}
