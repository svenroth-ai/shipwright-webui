/*
 * verdict.ts — POST /api/external/org/verdict
 * (iterate-2026-09-07-leadwright-setup-wizard, W14).
 *
 * The wizard's live preview step. Merges the proposed new lead into the
 * CURRENT on-disk org-chart/daemon-config (never a client-assembled guess —
 * `mergeLeadProposal` is the single merge point, shared with the commit
 * route so preview and commit can never disagree on what was submitted)
 * and runs the merged proposal through L19's real `check-setup.ts`
 * subprocess via `runLeadwrightPreflight`. Never re-implements that
 * validation — this route's only job is assembling the input and relaying
 * the verdict.
 *
 * `leadwrightCheckoutRoot` unset is a distinct, named 503 — the config
 * pointer is fail-closed by design (W14's "leadwright not reachable" gate).
 * A transport `ranOk: false` (leadwright ran but produced no parsable
 * output) is NOT an HTTP error — it's a normal 200 carrying the same named
 * state, because it's the client's job to render it as the blocking
 * "leadwright not reachable" explanation, not this route's.
 */
import type { Hono } from "hono";

import type { OrgChartFullReadResult } from "./org-chart-full-read.js";
import type { DaemonConfigReadCoreResult } from "./daemon-config-read.js";
import { mergeLeadProposal, computeProposalDigest, type DaemonConfigAdditions } from "./leadwright-proposal-merge.js";
import { runLeadwrightPreflight, type LeadwrightTransportResult } from "../../core/leadwright-preflight-transport.js";
import type { PreflightLead } from "../../types/leadwright-preflight.js";
import { readOrgChartFull } from "./org-chart-full-read.js";
import { daemonConfigReadCore } from "./daemon-config-read.js";
import { readExistingLeadCharters, type ReadOrgFileFn } from "./existing-charters-read.js";

export interface VerdictRequestBody {
  leadId: string;
  lead: PreflightLead;
  daemonConfigAdditions: DaemonConfigAdditions;
  charterContent?: string;
}

function isValidBody(body: unknown): body is VerdictRequestBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.leadId !== "string" || b.leadId.length === 0) return false;
  if (typeof b.lead !== "object" || b.lead === null) return false;
  const additions = b.daemonConfigAdditions;
  if (
    typeof additions !== "object" ||
    additions === null ||
    typeof (additions as Record<string, unknown>).path !== "string" ||
    typeof (additions as Record<string, unknown>).actionId !== "string" ||
    !Array.isArray((additions as Record<string, unknown>).pluginDirs)
  ) {
    return false;
  }
  return true;
}

export interface VerdictCoreDeps {
  leadsRoot: string;
  leadwrightCheckoutRoot: string | undefined;
  webuiBaseUrl: string;
  readOrgChartFullFn: (deps: { leadsRoot: string }) => OrgChartFullReadResult;
  daemonConfigReadFn: (deps: { leadsRoot: string; webuiBaseUrl: string }) => DaemonConfigReadCoreResult;
  runLeadwrightPreflightFn: typeof runLeadwrightPreflight;
  readOrgFileFn?: ReadOrgFileFn;
}

export type VerdictCoreResult =
  | { status: 200; body: (LeadwrightTransportResult & { proposalDigest: string }) }
  | { status: 400; body: { error: string } }
  | { status: 403 | 404 | 500 | 502; body: { error: string; detail?: string } }
  | { status: 503; body: { error: "leadwright_not_configured" } };

export async function verdictCore(deps: VerdictCoreDeps, requestBody: unknown): Promise<VerdictCoreResult> {
  if (!deps.leadwrightCheckoutRoot) {
    return { status: 503, body: { error: "leadwright_not_configured" } };
  }
  if (!isValidBody(requestBody)) {
    return { status: 400, body: { error: "invalid_request_body" } };
  }

  const orgChartResult = deps.readOrgChartFullFn({ leadsRoot: deps.leadsRoot });
  if (orgChartResult.status !== 200) {
    return orgChartResult;
  }

  const daemonConfigResult = deps.daemonConfigReadFn({ leadsRoot: deps.leadsRoot, webuiBaseUrl: deps.webuiBaseUrl });
  if (daemonConfigResult.status !== 200) {
    return daemonConfigResult;
  }

  const existingCharters = readExistingLeadCharters(
    deps.leadsRoot,
    orgChartResult.body,
    requestBody.leadId,
    deps.readOrgFileFn,
  );
  const { proposal } = mergeLeadProposal({
    orgChart: orgChartResult.body,
    daemonConfig: daemonConfigResult.body,
    leadId: requestBody.leadId,
    lead: requestBody.lead,
    daemonConfigAdditions: requestBody.daemonConfigAdditions,
    charterContent: requestBody.charterContent,
    existingCharters,
  });
  const proposalDigest = computeProposalDigest(proposal);

  const transportResult = await deps.runLeadwrightPreflightFn(deps.leadwrightCheckoutRoot, proposal);

  return { status: 200, body: { ...transportResult, proposalDigest } };
}

export interface VerdictRouteDeps extends Omit<VerdictCoreDeps, "readOrgChartFullFn" | "daemonConfigReadFn" | "runLeadwrightPreflightFn"> {
  readOrgChartFullFn?: VerdictCoreDeps["readOrgChartFullFn"];
  daemonConfigReadFn?: VerdictCoreDeps["daemonConfigReadFn"];
  runLeadwrightPreflightFn?: VerdictCoreDeps["runLeadwrightPreflightFn"];
}

export function registerVerdictRoute(app: Hono, deps: VerdictRouteDeps): void {
  const coreDeps: VerdictCoreDeps = {
    leadsRoot: deps.leadsRoot,
    leadwrightCheckoutRoot: deps.leadwrightCheckoutRoot,
    webuiBaseUrl: deps.webuiBaseUrl,
    readOrgChartFullFn: deps.readOrgChartFullFn ?? readOrgChartFull,
    daemonConfigReadFn: deps.daemonConfigReadFn ?? daemonConfigReadCore,
    runLeadwrightPreflightFn: deps.runLeadwrightPreflightFn ?? runLeadwrightPreflight,
  };
  app.post("/api/external/org/verdict", async (c) => {
    let requestBody: unknown;
    try {
      requestBody = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request_body" }, 400);
    }
    const result = await verdictCore(coreDeps, requestBody);
    return c.json(result.body, result.status);
  });
}
