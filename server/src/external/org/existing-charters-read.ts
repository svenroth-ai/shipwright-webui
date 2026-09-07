/*
 * existing-charters-read.ts — reads every OTHER lead's charter.md content
 * for inlining into a preflight `charters[]` submission
 * (iterate-2026-09-07-leadwright-setup-wizard, W14).
 *
 * External-review fix (GLM, medium, round 3): leadwright's
 * `runSetupPreflight` validates `charter-bands:<leadId>` for EVERY lead in
 * `orgChart.leads`, so a proposal that inlines only the NEW lead's charter
 * makes every OTHER existing lead fail its own "no charter provided" MUSS
 * finding — turning `verdict.ok` red the moment a second lead exists. There
 * is no on-disk "path mode" fallback for the inline stdin contract; every
 * lead's content must be submitted explicitly. Reuses `orgFileReadCore` —
 * the same symlink/realpath-guarded, allowlist-scoped read the org file
 * viewer uses — rather than a bespoke `readFileSync`.
 *
 * A charter.md that fails to read (missing, symlink-forbidden, etc.) is
 * treated as an empty charter, mirroring leadwright's own documented
 * semantics for an empty/missing charter file in path mode: "a valid
 * submission ... surfaces as its own finding, never a submission error."
 */
import { orgFileReadCore, type OrgFileReadDeps, type OrgFileReadCoreResult } from "./file-read.js";
import type { PreflightCharter, PreflightOrgChart } from "../../types/leadwright-preflight.js";

export type ReadOrgFileFn = (deps: OrgFileReadDeps, relpath: string | undefined) => OrgFileReadCoreResult;

export function readExistingLeadCharters(
  leadsRoot: string,
  orgChart: PreflightOrgChart,
  excludeLeadId: string,
  readFn: ReadOrgFileFn = orgFileReadCore,
): PreflightCharter[] {
  return Object.keys(orgChart.leads)
    .filter((leadId) => leadId !== excludeLeadId)
    .map((leadId) => {
      const result = readFn({ leadsRoot }, `${leadId}/charter.md`);
      const content = result.status === 200 && result.kind === "file" ? result.body.toString("utf8") : "";
      return { leadId, content };
    });
}
