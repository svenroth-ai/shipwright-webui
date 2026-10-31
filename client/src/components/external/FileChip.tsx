/*
 * FileChip — the `.mc-file` chip: file icon + file name (+ `:line`), FULL resolved path
 * (absolute; project root + relative path for inside files) in the tooltip. Click opens the Smart Viewer via FileOpenContext.
 */

import { FileText } from "lucide-react";

import { fullPathOf, type ViewerTarget } from "../../lib/viewerTarget";
import { baseName } from "../../lib/sessionInfoFormat";
import { useFileOpen } from "./FileOpenContext";

interface Props {
  target: ViewerTarget;
  /** Visible label; defaults to the file name (+ `:line`). */
  label?: string;
}

export function FileChip({ target, label }: Props) {
  const ctx = useFileOpen();
  const text = label ?? `${baseName(target.path)}${target.line ? `:${target.line}` : ""}`;
  return (
    <button
      type="button"
      className="mc-file"
      data-testid="mc-file"
      data-outside={target.outside ? "true" : undefined}
      title={fullPathOf(target, ctx?.projectRoot ?? null)}
      onClick={() => ctx?.open(target)}
    >
      <FileText size={14} aria-hidden="true" />
      <span>{text}</span>
    </button>
  );
}
