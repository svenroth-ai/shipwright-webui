/*
 * shipslog-docs-types.ts — shape contract for the Ship's-Log Documents
 * panel read surface (iterate-2026-08-31-shipslog-documents-panel):
 * curated links to a project's Requirements spec(s) (per planning-section
 * ur-spec, .shipwright/planning/<section>/spec.md), Iterate mini-specs
 * (.shipwright/planning/iterate/*.md), Agent Docs and Compliance docs.
 *
 * Split out (not folded into the reader) to match the run-data-types.ts
 * precedent; verbatim-mirrored client-side in
 * client/src/lib/shipsLogDocsApi.ts (ADR-080 — no cross-package import).
 * Drift guard: server/src/test/shipslog-docs-mirror-sync.test.ts.
 */

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
