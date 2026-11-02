/*
 * FileChip — the `.mc-file` chip: file icon + file name (+ `:line`), FULL resolved path
 * (absolute; project root + relative path for inside files) in the tooltip. Click opens the Smart Viewer via FileOpenContext.
 *
 * Inside a task (context carries `taskId`) the path is probed first: it only becomes a clickable chip
 * once the server says the Viewer can open it. A dead path (not found, not part of this session, not
 * previewable) and one still being checked render as plain styled text instead, never a link that opens
 * nothing. An inconclusive probe ("unknown") keeps the chip: the Viewer then reports the real state.
 */

import { FileText } from "lucide-react";

import { fullPathOf, type ViewerTarget } from "../../lib/viewerTarget";
import { baseName } from "../../lib/sessionInfoFormat";
import { useOpenable } from "../../hooks/useOpenable";
import { useFileOpen } from "./FileOpenContext";

interface Props {
  target: ViewerTarget;
  /** Visible label; defaults to the file name (+ `:line`). */
  label?: string;
}

export function FileChip({ target, label }: Props) {
  const ctx = useFileOpen();
  const openable = useOpenable(ctx?.taskId, target.path);
  const text = label ?? `${baseName(target.path)}${target.line ? `:${target.line}` : ""}`;
  const full = fullPathOf(target, ctx?.projectRoot ?? null);
  if (openable === "no" || openable === "pending") {
    return (
      <code
        className="mc-file-plain"
        data-testid="mc-file-plain"
        data-state={openable === "no" ? "unavailable" : "checking"}
        title={openable === "no" ? `Not found or not available: ${full}` : full}
      >
        {text}
      </code>
    );
  }
  return (
    <button
      type="button"
      className="mc-file"
      data-testid="mc-file"
      data-outside={target.outside ? "true" : undefined}
      title={full}
      aria-label={`Open ${full}`}
      onClick={() => ctx?.open(target)}
    >
      <FileText size={14} aria-hidden="true" />
      <span>{text}</span>
    </button>
  );
}
