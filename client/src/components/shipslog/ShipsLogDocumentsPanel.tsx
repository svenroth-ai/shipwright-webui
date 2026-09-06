/*
 * ShipsLogDocumentsPanel — the Ship's-Log right column (iterate-2026-08-31-
 * shipslog-documents-panel, A16 follow-up): curated links to the project's
 * Requirements spec(s), Iterate mini-specs, Agent Docs and Compliance docs
 * — today only findable via the File Viewer or the Mission tab. Every row
 * opens the existing SmartViewerModal overlay (Radix Dialog); one shared
 * modal instance here, keyed by whichever row was last clicked.
 *
 * Read-only observer (Architecture rule 1) — this panel never writes
 * .shipwright/*; GET /api/external/projects/:id/shipslog-docs via
 * useShipsLogDocs. Semantic h2/h3 headings + Radix Tabs (ShipsLogSpecsTabs)
 * for full keyboard nav, per the design-approval accessibility pass.
 *
 * @covers FR-01.60
 */

import { useState } from "react";

import { useShipsLogDocs } from "../../hooks/useShipsLogDocs";
import { ShipsLogSpecsTabs } from "./ShipsLogSpecsTabs";
import { ShipsLogDocList } from "./ShipsLogDocList";
import { SmartViewerModal } from "../external/SmartViewer/SmartViewerModal";

interface GroupProps {
  title: string;
  loading: boolean;
  loadError: boolean;
  children: React.ReactNode;
}

function DocGroup({ title, loading, loadError, children }: GroupProps) {
  return (
    <div className="sheet">
      <div className="sheet-h">
        <h3 className="heading">{title}</h3>
      </div>
      <div className="sheet-body">
        {loading && <div className="doc-empty">Loading…</div>}
        {!loading && loadError && (
          <div className="doc-empty">Could not load {title.toLowerCase()}.</div>
        )}
        {!loading && !loadError && children}
      </div>
    </div>
  );
}

export function ShipsLogDocumentsPanel({ projectId }: { projectId: string }) {
  const { data, isLoading, isError } = useShipsLogDocs(projectId);
  const [openPath, setOpenPath] = useState<string | null>(null);

  const bundle = data?.status === "ok" ? data : null;
  const loadError = isError || (!isLoading && !bundle);

  return (
    <div className="sl-docs" data-testid="shipslog-docs-panel">
      {/* iterate-2026-09-06-tablet-ipad-ux-pass: the panel is visually
          self-evident (three labeled groups) once it sits in its own
          scrollable column, so the redundant "Project documents" caption
          is dropped — kept as an sr-only heading so the region still has
          a name in the accessibility tree (h2, matches ShipsLogPage's h3
          group headings one level down). */}
      <h2 className="sl-lead sr-only">Project documents</h2>

      <DocGroup title="Specs" loading={isLoading} loadError={loadError}>
        <ShipsLogSpecsTabs
          requirements={bundle?.requirements ?? []}
          iterateSpecs={bundle?.iterateSpecs ?? []}
          onOpen={setOpenPath}
        />
      </DocGroup>

      <DocGroup title="Agent docs" loading={isLoading} loadError={loadError}>
        <div className="doc-list-scroll">
          <ShipsLogDocList
            rows={bundle?.agentDocs ?? []}
            emptyLabel="No agent docs found."
            onOpen={setOpenPath}
          />
        </div>
      </DocGroup>

      <DocGroup title="Compliance" loading={isLoading} loadError={loadError}>
        <div className="doc-list-scroll">
          <ShipsLogDocList
            rows={bundle?.compliance ?? []}
            emptyLabel="No compliance docs found."
            onOpen={setOpenPath}
          />
        </div>
      </DocGroup>

      {openPath && (
        <SmartViewerModal
          open
          onOpenChange={(o) => {
            if (!o) setOpenPath(null);
          }}
          projectId={projectId}
          path={openPath}
        />
      )}
    </div>
  );
}
