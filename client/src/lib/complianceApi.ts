/*
 * complianceApi.ts — fetch wrapper for
 * GET /api/external/projects/:id/compliance (FR-01.43).
 *
 * Kept in its own lib file (externalApi.ts is at the bloat ceiling) but reuses
 * its exported httpJson + EXTERNAL_API so endpoint strings live in one place.
 *
 * SoT for the wire shape: server/src/core/compliance-reader.ts
 * (ComplianceData / ComplianceReadResult). The server flattens the `ok`
 * payload's `data` onto the envelope, so the `ok` arm here is
 * `{status:"ok"} & ComplianceData`. Verbatim mirror per ADR-080 — DO NOT add a
 * cross-package import.
 */

import { EXTERNAL_API, httpJson } from "./externalApi";

/**
 * One structured Control-Verdict dimension (A16, FR-01.60). Verbatim mirror of
 * server/src/core/compliance-dimensions.ts (ADR-080 — no cross-package import).
 * `pct` is the dashboard's own ✅/⚠️/❌ verdict as a bar height; `null` = no bar
 * (the reader NEVER scrapes a fraction out of the free-text signal).
 */
export interface ComplianceDimension {
  key: string;
  label: string;
  value: string;
  pct: number | null;
  doc: string;
}

export interface ComplianceData {
  grade: string;
  score: number;
  verdict: string;
  generatedAt: string;
  controlVerdictMarkdown: string;
  ciSecurityMarkdown: string;
  /** Structured sub-scores (A16); `[]` when the table is absent/unparseable. */
  dimensions: ComplianceDimension[];
}

export type ComplianceResponse =
  | ({ status: "ok" } & ComplianceData)
  | { status: "missing" }
  | { status: "invalid"; reason: string };

export async function getProjectCompliance(
  projectId: string,
): Promise<ComplianceResponse> {
  return await httpJson<ComplianceResponse>(
    `${EXTERNAL_API}/projects/${encodeURIComponent(projectId)}/compliance`,
  );
}
