/*
 * OrgSharedDocs — the `.rost` shared-documents block (AC-1, between the
 * chart and the lead cards): GET/view-only tiles for `org-chart.json`,
 * `conventions.md`, `principal.md`, `decision_log.md`. Editing any of the
 * four is out of scope (see the iterate spec's Out of Scope) — each opens
 * the same read-only `OrgDocViewerModal`, never a write path.
 *
 * A fifth tile, `decisions-proposed.md` (FR-01.71 (F), iterate-2026-09-06-
 * decisions-proposed-countersign), is DELIBERATELY different: it opens the
 * dedicated, write-capable `OrgDecisionsProposedModal` instead — parsed
 * entries with a Countersign button each, never the generic viewer (which
 * stays read-only-only, per its own doc comment).
 */

import { useState } from "react";

import { fetchOrgChart, fetchOrgFileText } from "../../lib/orgApi";
import { OrgDocViewerModal } from "./OrgDocViewerModal";
import { OrgDecisionsProposedModal } from "./OrgDecisionsProposedModal";

interface Tile {
  path: string;
  label: string;
  meta: string;
  renderAs: "markdown" | "json";
  fetcher: () => Promise<string>;
}

// `org-chart.json` is deliberately EXCLUDED from the `/api/org/file` six-kind
// allowlist (server/src/routes/org.ts — "readable only, via its own typed
// endpoint") — its tile fetches through the typed `/api/org/org-chart`
// endpoint instead and stringifies the parsed body for the JSON viewer.
const TILES: Tile[] = [
  {
    path: "org-chart.json",
    label: "org-chart.json",
    meta: "Structure",
    renderAs: "json",
    fetcher: () => fetchOrgChart().then((chart) => JSON.stringify(chart)),
  },
  {
    path: "conventions.md",
    label: "conventions.md",
    meta: "Shared conventions",
    renderAs: "markdown",
    fetcher: () => fetchOrgFileText("conventions.md"),
  },
  {
    path: "principal.md",
    label: "principal.md",
    meta: "Principal profile",
    renderAs: "markdown",
    fetcher: () => fetchOrgFileText("principal.md"),
  },
  {
    path: "decision_log.md",
    label: "decision_log.md",
    meta: "Decision log",
    renderAs: "markdown",
    fetcher: () => fetchOrgFileText("decision_log.md"),
  },
];

export function OrgSharedDocs() {
  const [openTile, setOpenTile] = useState<Tile | null>(null);
  const [decisionsProposedOpen, setDecisionsProposedOpen] = useState(false);

  return (
    <div className="rost" data-testid="org-shared-docs">
      <h6>Organization documents</h6>
      <div className="doctiles">
        {TILES.map((tile) => (
          <div className="dtile" key={tile.path}>
            <span className="dn">
              <span className="t">{tile.label}</span>
            </span>
            <span className="dm">{tile.meta}</span>
            <button
              type="button"
              className="da"
              data-testid={`org-shared-doc-view-${tile.path}`}
              onClick={() => setOpenTile(tile)}
            >
              View
            </button>
          </div>
        ))}
        <div className="dtile">
          <span className="dn">
            <span className="t">decisions-proposed.md</span>
          </span>
          <span className="dm">Waiting decisions</span>
          <button
            type="button"
            className="da"
            data-testid="org-shared-doc-view-decisions-proposed.md"
            onClick={() => setDecisionsProposedOpen(true)}
          >
            View
          </button>
        </div>
      </div>
      {openTile && (
        <OrgDocViewerModal
          open={openTile !== null}
          onOpenChange={(o) => !o && setOpenTile(null)}
          title={openTile.label}
          queryKey={["org", "shared-doc", openTile.path]}
          fetcher={openTile.fetcher}
          renderAs={openTile.renderAs}
        />
      )}
      {decisionsProposedOpen && (
        <OrgDecisionsProposedModal
          open={decisionsProposedOpen}
          onOpenChange={setDecisionsProposedOpen}
        />
      )}
    </div>
  );
}
