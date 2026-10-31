/*
 * FolderTreeRow — one row of the FileTree: select/expand button, the touch
 * "..." actions button, right-click + long-press menu triggers.
 */

import { useRef } from "react";
import {
  ChevronRight,
  File as FileIcon,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  ImageIcon,
  Loader2,
  MoreHorizontal,
} from "lucide-react";

export interface TreeRow {
  path: string;
  name: string;
  kind: "file" | "dir";
  ignored: boolean;
  depth: number;
  expanded: boolean;
}

const LONG_PRESS_MS = 500;

function iconForEntry(name: string, kind: "file" | "dir", expanded: boolean) {
  if (kind === "dir") {
    return expanded ? (
      <FolderOpen size={14} className="shrink-0 text-[var(--color-accent,#857568)]" />
    ) : (
      <Folder size={14} className="shrink-0 text-[var(--color-accent,#857568)]" />
    );
  }
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (ext === "md" || ext === "markdown") return <FileText size={14} className="shrink-0 text-info" />;
  if (["ts", "tsx", "js", "jsx"].includes(ext)) return <FileCode size={14} className="shrink-0 text-info" />;
  if (["json", "yaml", "yml"].includes(ext)) return <FileJson size={14} className="shrink-0 text-warn" />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) {
    return <ImageIcon size={14} className="shrink-0 text-info" />;
  }
  return <FileIcon size={14} className="shrink-0 text-[var(--color-muted,#6b7280)]" />;
}

interface Props {
  row: TreeRow;
  selected: boolean;
  tabbable: boolean;
  loading: boolean;
  error: string | null;
  onActivate: (row: TreeRow) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, row: TreeRow) => void;
  onMenu: (row: TreeRow, x: number, y: number, sheet: boolean) => void;
}

export function FolderTreeRow({ row, selected, tabbable, loading, error, onActivate, onKeyDown, onMenu }: Props) {
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const clearPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={row.kind === "dir" ? row.expanded : undefined}
      className="ft-row"
    >
      {Array.from({ length: row.depth }, (_, i) => (
        <span key={i} aria-hidden="true" className="ft-guide" style={{ left: `${14 + i * 14}px` }} />
      ))}
      <button
        type="button"
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          onActivate(row);
        }}
        onKeyDown={(e) => onKeyDown(e, row)}
        onContextMenu={(e) => {
          e.preventDefault();
          // Touch: the long-press timer owns the (sheet) menu; a native
          // contextmenu from the same gesture must not open a second surface.
          const pt = (e.nativeEvent as PointerEvent).pointerType;
          if (pt === "touch" || pt === "pen" || longPressed.current || pressTimer.current !== null) return;
          clearPress();
          onMenu(row, e.clientX, e.clientY, false);
        }}
        onPointerDown={(e) => {
          if (e.pointerType !== "touch") return;
          longPressed.current = false;
          const { clientX, clientY } = e;
          pressTimer.current = window.setTimeout(() => {
            longPressed.current = true;
            onMenu(row, clientX, clientY, true);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={clearPress}
        onPointerCancel={clearPress}
        onPointerLeave={clearPress}
        data-testid={`folder-tree-row-${row.path}`}
        data-path={row.path}
        data-ignored={row.ignored || undefined}
        data-kind={row.kind}
        data-selected={selected || undefined}
        tabIndex={tabbable ? 0 : -1}
        className={`ft-tree-row ft-node ${row.ignored ? "ignored italic opacity-60" : ""} ${selected ? "sel" : ""}`}
        style={{ paddingLeft: `${8 + row.depth * 14}px` }}
      >
        <span className="ft-tree-chev flex w-3 shrink-0 items-center justify-center">
          {row.kind === "dir" ? (
            <ChevronRight
              size={12}
              className="transition-transform"
              style={{ transform: row.expanded ? "rotate(90deg)" : "none" }}
            />
          ) : (
            <span aria-hidden="true" className="inline-block h-3 w-3" />
          )}
        </span>
        {iconForEntry(row.name, row.kind, row.expanded)}
        <span className="truncate">{row.name}</span>
        {row.kind === "dir" && loading && <Loader2 size={10} className="ml-auto animate-spin opacity-60" />}
      </button>
      <button
        type="button"
        className="ft-more"
        aria-label={`Actions for ${row.name}`}
        data-testid={`folder-tree-more-${row.path}`}
        tabIndex={-1}
        onClick={(e) => {
          // Mouse: anchored menu under the button; touch/pen/keyboard-less: bottom sheet.
          const mouse = (e.nativeEvent as PointerEvent).pointerType === "mouse";
          const r = e.currentTarget.getBoundingClientRect();
          onMenu(row, mouse ? r.left : 0, mouse ? r.bottom : 0, !mouse);
        }}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {row.kind === "dir" && error && (
        <div
          className="ml-8 mr-2 my-1 rounded-sm border border-[var(--color-error,#DC2626)]/30 bg-[var(--color-error,#DC2626)]/10 px-1.5 py-0.5 text-[10px]"
          style={{ color: "var(--color-error, #DC2626)" }}
          data-testid={`folder-tree-error-${row.path}`}
        >
          {error}
        </div>
      )}
    </div>
  );
}

export function focusRow(root: HTMLElement | null, path: string) {
  if (!root) return;
  root
    .querySelector<HTMLButtonElement>(`[data-testid="folder-tree-row-${CSS.escape(path)}"]`)
    ?.focus();
}
