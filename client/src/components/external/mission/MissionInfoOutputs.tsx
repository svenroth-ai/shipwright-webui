/*
 * MissionInfoOutputs — the "Outputs" card of the Mission info sidebar (V6).
 * Every row is a full-width button (40px): it opens the file in the Smart
 * Viewer, INCLUDING files outside the project (session-file route; such rows
 * carry a small "outside project" tag and the full path as tooltip).
 *
 * Each shown row is probed (batched, cached - lib/pathProbe): a file that no longer exists (typically
 * written inside an iterate worktree that was removed after its merge, or a deleted scratch file) renders
 * as a NON-clickable row with a small "missing" tag instead of a click that ends in "File not found".
 * A path the session may not read is the same dead end and is shown the same way; an inconclusive probe
 * keeps the row clickable (the Viewer then reports the real state).
 */

import { useState } from "react";
import { FileText } from "lucide-react";

import { useOpenable } from "../../../hooks/useOpenable";
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

function OutputRow({ p, taskId, projectRoot, rootReady, onOpen }: { p: string; taskId?: string; projectRoot: string | null; rootReady: boolean; onOpen: (t: ViewerTarget) => void }) {
  const target = targetForAbsolute(p, projectRoot);
  const outside = rootReady && target.outside;
  const state = useOpenable(rootReady ? taskId : undefined, target.path);
  const missing = state === "no";
  return (
    <li>
      <button
        type="button"
        className="env-output"
        title={missing ? `${p} — no longer exists or is not available` : p}
        data-testid="env-output"
        data-outside={outside ? "true" : undefined}
        data-missing={missing ? "true" : undefined}
        disabled={!rootReady || missing}
        onClick={() => onOpen(target)}
      >
        <FileText size={16} aria-hidden="true" />
        <span className="env-output-name">{baseName(p)}</span>
        {missing ? <span className="env-tag" data-testid="env-output-missing">missing</span> : null}
        {outside && !missing ? <span className="env-tag" data-testid="env-output-outside">outside project</span> : null}
      </button>
    </li>
  );
}

export function MissionInfoOutputs({ taskId, paths, projectRoot, rootReady, emptyText, onOpen }: Props) {
  const [showAll, setShowAll] = useState(false);
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
            <OutputRow key={p} p={p} taskId={taskId} projectRoot={projectRoot} rootReady={rootReady} onOpen={onOpen} />
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
