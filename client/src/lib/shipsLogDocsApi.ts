/*
 * shipsLogDocsApi.ts — fetch wrapper for the Ship's-Log Documents panel
 * (iterate-2026-08-31-shipslog-documents-panel): curated links to a
 * project's Requirements spec(s), Iterate mini-specs, Agent Docs and
 * Compliance docs, each opened via the existing SmartViewerModal overlay.
 *
 * Its OWN lib file — externalApi.ts is at the bloat ceiling, no new
 * wrappers there — but reuses its exported httpJson + EXTERNAL_API.
 *
 * SoT for the wire shape: server/src/core/shipslog-docs-types.ts. Verbatim
 * mirror per ADR-080 — DO NOT add a cross-package import. Drift guard:
 * server/src/test/shipslog-docs-mirror-sync.test.ts.
 */

import { EXTERNAL_API, httpJson } from "./externalApi";

export interface ShipsLogDocRow {
  /** Project-root-relative POSIX path, passed straight to SmartViewerModal. */
  path: string;
  label: string;
  /** ISO mtime, or null when the stat failed after the existence check
   *  (a TOCTOU race — treated as "date unknown", never fabricated). */
  when: string | null;
}

export interface ShipsLogDocsBundle {
  requirements: ShipsLogDocRow[];
  iterateSpecs: ShipsLogDocRow[];
  agentDocs: ShipsLogDocRow[];
  compliance: ShipsLogDocRow[];
}

export interface ShipsLogDocsResponse extends ShipsLogDocsBundle {
  status: "ok";
}

export async function getShipsLogDocs(projectId: string): Promise<ShipsLogDocsResponse> {
  return await httpJson<ShipsLogDocsResponse>(
    `${EXTERNAL_API}/projects/${encodeURIComponent(projectId)}/shipslog-docs`,
  );
}
