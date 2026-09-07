/*
 * commit-validate.ts — request-body validation for POST
 * /api/external/org/leads/commit (iterate-2026-09-07-leadwright-setup-wizard,
 * W14). Split out of commit.ts (bloat ceiling) — a self-contained concern:
 * shape-checking the untyped request body against leadwright's published
 * contract, never leadwright's semantic judgment (that's the verdict step's
 * real check-setup.ts subprocess).
 */
import path from "node:path";

import { LEAD_ID_RE, ALLOWED_SKILL_RE } from "../../types/leadwright-preflight.js";
import type { PreflightLead } from "../../types/leadwright-preflight.js";
import type { DaemonConfigAdditions } from "./leadwright-proposal-merge.js";

export interface CommitRequestBody {
  leadId: string;
  lead: PreflightLead;
  daemonConfigAdditions: DaemonConfigAdditions;
  charterContent: string;
  expectedProposalDigest: string;
}

export type ValidationResult = { ok: true; value: CommitRequestBody } | { ok: false; reason: string };

export function validateCommitBody(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) return { ok: false, reason: "invalid_request_body" };
  const b = body as Record<string, unknown>;

  if (typeof b.leadId !== "string" || !LEAD_ID_RE.test(b.leadId)) {
    return { ok: false, reason: "invalid_lead_id" };
  }
  if (typeof b.lead !== "object" || b.lead === null) {
    return { ok: false, reason: "invalid_lead" };
  }
  const lead = b.lead as Partial<PreflightLead>;
  // External-review fix (both legs, high): commitCore ALWAYS writes charter
  // content to `<leadsRoot>/<leadId>/charter.md` regardless of what
  // charter_path says — checking only "relative, no .." (CHARTER_LEARNINGS_
  // PATH_RE) let a caller submit a charter_path that doesn't match, so the
  // org-chart entry would point at a file the endpoint never wrote. Exact
  // match subsumes that regex check (a value equal to the fixed convention
  // is trivially relative with no `..`). The wizard itself always sends
  // this convention (buildLeadProposal.ts); this closes the gap for any
  // other caller. `b.leadId` is a validated string by this point.
  if (lead.charter_path !== `${b.leadId as string}/charter.md`) {
    return { ok: false, reason: "charter_path_must_match_lead_id_convention" };
  }
  if (lead.learnings_path !== `${b.leadId as string}/learnings.md`) {
    return { ok: false, reason: "learnings_path_must_match_lead_id_convention" };
  }
  if (!Array.isArray(lead.allowed_skills) || !lead.allowed_skills.every((s) => typeof s === "string" && ALLOWED_SKILL_RE.test(s))) {
    return { ok: false, reason: "invalid_allowed_skills" };
  }

  const additionsRaw = b.daemonConfigAdditions;
  if (typeof additionsRaw !== "object" || additionsRaw === null) {
    return { ok: false, reason: "invalid_daemon_config_additions" };
  }
  const additions = additionsRaw as Record<string, unknown>;
  if (
    typeof additions.path !== "string" ||
    !path.isAbsolute(additions.path) ||
    typeof additions.actionId !== "string" ||
    !Array.isArray(additions.pluginDirs) ||
    !additions.pluginDirs.every((d) => typeof d === "string" && path.isAbsolute(d))
  ) {
    return { ok: false, reason: "daemon_config_additions_must_be_absolute" };
  }

  if (typeof b.charterContent !== "string") return { ok: false, reason: "charter_content_required" };
  if (typeof b.expectedProposalDigest !== "string" || b.expectedProposalDigest.length === 0) {
    return { ok: false, reason: "expected_proposal_digest_required" };
  }

  return { ok: true, value: body as CommitRequestBody };
}
