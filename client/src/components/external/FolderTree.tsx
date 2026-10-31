/*
 * FolderTree — the shared project file tree (iterate 3 section 04, FR-03.32 +
 * FR-03.33; flat variant + row context menu: mission-desktop-style-v2 V5).
 *
 * Fetches ONE level at a time via GET /api/external/projects/:id/tree —
 * lazy expand; collapsing a dir DOES NOT refetch on the next expand
 * inside the same mount. Ignored entries render italic + muted by default; the
 * "Show ignored entries" toggle persists per project (`useHideIgnored`).
 * `flat` = no card chrome; `projectRoot` enables the absolute "Copy Path".
 *
 * Keyboard: arrows move/expand/collapse, Enter selects, ContextMenu / Shift+F10 opens the row menu.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";

import { ApiError, fetchProjectTree, type TreeEntry } from "../../lib/externalApi";
import { useHideIgnored } from "../../hooks/useHideIgnored";
import { FolderTreeMenu, type TreeMenuTarget } from "./FolderTreeMenu";
import { FolderTreeRow, focusRow, type TreeRow } from "./FolderTreeRow";
import { useCopyToast } from "./useCopyToast";
import { absoluteTreePath } from "./folderTreePaths";

interface Props {
  projectId: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** Absolute project folder (enables "Copy Path"). */
  projectRoot?: string | null;
  flat?: boolean;
  label?: string | null;
}

interface DirState {
  loading: boolean;
  error: string | null;
  entries: TreeEntry[] | null;
  expanded: boolean;
}

type DirCache = Record<string, DirState | undefined>;

const ROOT = "";

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function FolderTree({ projectId, selectedPath, onSelect, projectRoot = null, flat = false, label = null }: Props) {
  const [cache, setCache] = useState<DirCache>({});
  const [hideIgnored, setHideIgnored] = useHideIgnored(projectId);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [menu, setMenu] = useState<TreeMenuTarget | null>(null);
  const { toast, copy } = useCopyToast();

  useEffect(() => {
    setCache({});
    setFocusedPath(null);
    setMenu(null);
  }, [projectId]);

  const loadDir = useCallback(
    async (relpath: string) => {
      setCache((prev) => ({
        ...prev,
        [relpath]: {
          loading: true,
          error: null,
          entries: prev[relpath]?.entries ?? null,
          expanded: prev[relpath]?.expanded ?? true,
        },
      }));
      try {
        const res = await fetchProjectTree(projectId, relpath || undefined);
        setCache((prev) => ({
          ...prev,
          [relpath]: { loading: false, error: null, entries: res.entries, expanded: true },
        }));
      } catch (err) {
        const msg = err instanceof ApiError ? err.code : err instanceof Error ? err.message : String(err);
        setCache((prev) => ({
          ...prev,
          [relpath]: {
            loading: false,
            error: msg,
            entries: prev[relpath]?.entries ?? null,
            expanded: prev[relpath]?.expanded ?? false,
          },
        }));
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (!cache[ROOT]) void loadDir(ROOT);
  }, [cache, loadDir]);

  const refreshTree = useCallback(() => {
    setCache({});
    void loadDir(ROOT);
  }, [loadDir]);

  const toggleDir = useCallback(
    (path: string) => {
      setCache((prev) => {
        const cur = prev[path];
        if (cur && cur.entries) return { ...prev, [path]: { ...cur, expanded: !cur.expanded } };
        return prev;
      });
      const cur = cache[path];
      if (!cur || cur.entries === null) void loadDir(path);
    },
    [cache, loadDir],
  );

  const rootState = cache[ROOT];

  const visibleRows = useMemo(() => {
    const rows: TreeRow[] = [];
    const walk = (parentPath: string, depth: number) => {
      const state = cache[parentPath];
      if (!state || !state.entries) return;
      for (const e of state.entries) {
        if (hideIgnored && e.ignored) continue;
        const p = joinPath(parentPath, e.name);
        const expanded = Boolean(cache[p]?.expanded);
        rows.push({ path: p, name: e.name, kind: e.kind, ignored: e.ignored, depth, expanded });
        if (e.kind === "dir" && expanded) walk(p, depth + 1);
      }
    };
    walk(ROOT, 0);
    return rows;
  }, [cache, hideIgnored]);

  const openMenu = useCallback((row: TreeRow, x: number, y: number, sheet: boolean) => {
    setFocusedPath(row.path);
    setMenu({ path: row.path, kind: row.kind, x, y, sheet });
  }, []);

  const closeMenu = useCallback(() => {
    const path = menu?.path;
    setMenu(null);
    // Return focus to the row only if nothing else took it (an outside click
    // or a second menu must keep its own focus).
    if (path) {
      window.setTimeout(() => {
        const a = document.activeElement;
        if (!a || a === document.body) focusRow(treeRef.current, path);
      }, 0);
    }
  }, [menu]);

  const move = (row: TreeRow, delta: number) => {
    const idx = visibleRows.findIndex((r) => r.path === row.path);
    const next = visibleRows[idx + delta];
    if (next) {
      setFocusedPath(next.path);
      focusRow(treeRef.current, next.path);
    }
  };

  const onRowKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, row: TreeRow) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      move(row, e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "ArrowRight" && row.kind === "dir") {
      e.preventDefault();
      if (!row.expanded) toggleDir(row.path);
    } else if (e.key === "ArrowLeft" && row.kind === "dir" && row.expanded) {
      e.preventDefault();
      toggleDir(row.path);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (row.kind === "dir") toggleDir(row.path);
      else onSelect(row.path);
    } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      openMenu(row, r.left + 24, r.bottom, false);
    }
  };

  // "Open in Viewer": a file opens in the viewer; a folder (nothing to render) expands.
  const openFromMenu = (path: string, kind: "file" | "dir") => {
    if (kind === "file") onSelect(path);
    else if (!cache[path]?.expanded) toggleDir(path);
  };

  const activate = (row: TreeRow) => {
    setFocusedPath(row.path);
    if (row.kind === "dir") toggleDir(row.path);
    else onSelect(row.path);
  };

  return (
    <div
      className={`${flat ? "ft-flat" : "ft-card ft-files"} flex h-full min-h-0 flex-col`}
      data-testid="folder-tree"
    >
      <div className={flat ? "ft-flat-bar" : "ft-head"} data-testid="folder-tree-header">
        <span className="ft-title flex-1 truncate">{label ? `Files · ${label}` : "Files"}</span>
        {rootState?.loading && <Loader2 size={12} className="animate-spin" aria-label="Loading" />}
        <button
          type="button"
          onClick={refreshTree}
          className="ft-refresh inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--color-muted,#6b7280)] transition hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)] pointer-coarse:h-11 pointer-coarse:w-11"
          title="Refresh tree"
          aria-label="Refresh tree"
          data-testid="folder-tree-refresh"
        >
          <RefreshCw size={12} aria-hidden="true" />
        </button>
      </div>
      <div
        ref={treeRef}
        role="tree"
        aria-label="Project files"
        className="ft-tree flex-1 overflow-y-auto py-1"
        data-testid="folder-tree-body"
      >
        {rootState?.error && (
          <div
            className="mx-2 mb-2 rounded-md border border-[var(--color-error,#DC2626)]/30 bg-[var(--color-error,#DC2626)]/10 px-2 py-1.5 text-[11px]"
            style={{ color: "var(--color-error, #DC2626)" }}
            data-testid="folder-tree-error"
          >
            <AlertCircle size={12} className="mr-1 inline" />
            {rootState.error}
          </div>
        )}
        {visibleRows.map((row) => (
          <FolderTreeRow
            key={row.path}
            row={row}
            selected={selectedPath === row.path}
            tabbable={row.path === (focusedPath ?? visibleRows[0]?.path)}
            loading={Boolean(cache[row.path]?.loading)}
            error={cache[row.path]?.error ?? null}
            onActivate={activate}
            onKeyDown={onRowKeyDown}
            onMenu={openMenu}
          />
        ))}
        {rootState && !rootState.loading && visibleRows.length === 0 && !rootState.error && (
          <div
            className="px-4 py-3 text-[11px] italic"
            style={{ color: "var(--color-muted, #6b7280)" }}
            data-testid="folder-tree-empty"
          >
            No files to show.
          </div>
        )}
      </div>
      <label className="ft-foot" data-testid="folder-tree-show-ignored-label">
        <input
          type="checkbox"
          checked={!hideIgnored}
          onChange={(e) => setHideIgnored(!e.target.checked)}
          className="cursor-pointer"
          data-testid="folder-tree-show-ignored-toggle"
        />
        <span className="cursor-pointer">Show ignored entries</span>
        <span className="ml-auto text-[11px] italic opacity-70" data-testid="folder-tree-saved-hint">
          saved per project
        </span>
      </label>
      <div role="status" aria-live="polite" className={toast ? "ft-toast" : "sr-only"} data-testid="folder-tree-toast">
        {toast}
      </div>
      <FolderTreeMenu
        target={menu}
        onClose={closeMenu}
        onOpen={openFromMenu}
        canCopyPath={Boolean(projectRoot)}
        onCopyPath={(p) => projectRoot && copy(absoluteTreePath(projectRoot, p))}
        onCopyRelative={(p) => copy(p)}
      />
    </div>
  );
}
