/*
 * MissionInfoOutputs — the "Outputs" card of the Mission info sidebar (V6).
 * Every row is a full-width button (40px): it opens the file in the Smart
 * Viewer, INCLUDING files outside the project (session-file route; such rows
 * carry a small "outside project" tag and the full path as tooltip).
 *
 * Rows are probed as a LIST (batched, cached - lib/pathProbe via useOpenableMap): a file that no longer
 * exists (typically written inside an iterate worktree that was removed after its merge, or a deleted
 * scratch file; the server says `not_found`) is HIDDEN, and the count / "Show all N" count visible rows
 * only. While a probe is pending or inconclusive the row stays visible and clickable (the Viewer reports
 * the real state); a file that EXISTS but cannot be previewed (type, size, sensitive path) is not gone and
 * keeps its row. Long names truncate with an ellipsis.
 */

import { useState } from "react";
import { FileText } from "lucide-react";

import { useOpenableMap } from "../../../hooks/useOpenableMap";
import { baseName } from "../../../lib/sessionInfoFormat";
import { targetForAbsolute, type ViewerTarget } from "../../../lib/viewerTarget";

const OUTPUTS_PREVIEW = 5;

interface Props {
  /** Task the outputs belong to (enables the missing-file probe). */
  taskId?: string;
  /** Deduplicated, newest first. */
  paths: string[];
  /** Project root; null with `rootReady` = a task without a project. */
  projectRoot: string | null;
  /** False while the project is still loading (inside/outside is not yet known). */
  rootReady: boolean;
  emptyText: string;
  onOpen: (t: ViewerTarget) => void;
}

function OutputRow({ p, projectRoot, rootReady, onOpen }: { p: string; projectRoot: string | null; rootReady: boolean; onOpen: (t: ViewerTarget) => void }) {
  const target = targetForAbsolute(p, projectRoot);
  const outside = rootReady && target.outside;
  return (
    <li>
      <button
        type="button"
        className="env-output"
        title={p}
        data-testid="env-output"
        data-outside={outside ? "true" : undefined}
        disabled={!rootReady}
        onClick={() => onOpen(target)}
      >
        <FileText size={16} aria-hidden="true" />
        <span className="env-output-name">{baseName(p)}</span>
        {outside ? <span className="env-tag" data-testid="env-output-outside">outside project</span> : null}
      </button>
    </li>
  );
}

export function MissionInfoOutputs({ taskId, paths: all, projectRoot, rootReady, emptyText, onOpen }: Props) {
  const [showAll, setShowAll] = useState(false);
  const openable = useOpenableMap(rootReady ? taskId : undefined, all);
  const paths = all.filter((p) => openable.get(p) !== "gone");
  const shown = showAll ? paths : paths.slice(0, OUTPUTS_PREVIEW);
  return (
    <section className="env-sec" aria-labelledby="env-h-outputs" data-testid="env-outputs">
      <h4 className="env-h">
        <span id="env-h-outputs">Outputs</span>
        {paths.length > 0 ? (
          <span className="env-count" data-testid="env-outputs-count">
            {paths.length} {paths.length === 1 ? "file" : "files"}
          </span>
        ) : null}
      </h4>
      {paths.length === 0 ? (
        <p className="env-empty" data-testid="env-outputs-empty">{emptyText}</p>
      ) : (
        <ul className="env-outputs">
          {shown.map((p) => (
            <OutputRow key={p} p={p} projectRoot={projectRoot} rootReady={rootReady} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {paths.length > OUTPUTS_PREVIEW ? (
        <button
          type="button"
          className="env-more"
          data-testid="env-outputs-more"
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Show less" : `Show all ${paths.length}`}
        </button>
      ) : null}
    </section>
  );
}
