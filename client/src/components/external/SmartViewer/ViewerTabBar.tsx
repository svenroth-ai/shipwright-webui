/*
 * ViewerTabBar — pill-style tab strip above the SmartViewer (iterate 3.7b,
 * Phase B3). Renders one tab per entry in `paths`; the `activePath` gets
 * a 2px `--color-primary` bottom border + surface background, inactive
 * tabs stay on the muted background with hover surface.
 *
 * Clicking a tab body: selects (activePath). Clicking the × button on a
 * tab: removes that path from the multi-file list via `onClose`. The two
 * are sibling <button>s (not nested), so a close click never bubbles into
 * the tab button's own onClick — no stopPropagation needed.
 *
 * Icon-by-extension is best-effort: uses the same lucide icon set as
 * FolderTree so the visual language is consistent.
 *
 * Accessibility (iterate-2026-09-06-smartviewer-table-a11y): the close
 * control is a REAL sibling <button>, not a `role="button"` span nested
 * inside the tab `<button>` — a11y trees + keyboard users don't reliably
 * cope with a control nested inside another control. It is keyboard-
 * reachable (no `tabIndex={-1}`) and shows on `:focus-visible`, not only on
 * `:hover` — a keyboard user tabbing to it must be able to see it appear.
 */

import {
  File as FileIcon,
  FileCode,
  FileJson,
  FileText,
  ImageIcon,
  X,
} from "lucide-react";

interface Props {
  paths: string[];
  activePath: string | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function iconFor(name: string) {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (ext === "md" || ext === "markdown") {
    return <FileText size={12} className="shrink-0 text-info" />;
  }
  if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") {
    return <FileCode size={12} className="shrink-0 text-info" />;
  }
  if (ext === "json" || ext === "yaml" || ext === "yml") {
    return <FileJson size={12} className="shrink-0 text-warn" />;
  }
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) {
    return <ImageIcon size={12} className="shrink-0 text-info" />;
  }
  if (ext === "mmd" || ext === "mermaid") {
    return <FileText size={12} className="shrink-0 text-ok" />;
  }
  return (
    <FileIcon
      size={12}
      className="shrink-0 text-[var(--color-muted,#6b7280)]"
    />
  );
}

export function ViewerTabBar({ paths, activePath, onActivate, onClose }: Props) {
  if (paths.length === 0) return null;
  return (
    <div
      className="flex min-h-[40px] items-center overflow-x-auto border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] pr-2"
      data-testid="viewer-tab-bar"
      role="tablist"
    >
      {paths.map((p) => {
        const active = p === activePath;
        const name = basename(p);
        return (
          <div
            key={p}
            className={`group flex min-h-[40px] shrink-0 items-center gap-1 whitespace-nowrap border-b-2 pl-3 pr-1.5 font-mono text-[12px] transition ${
              active
                ? "border-[var(--color-primary,#6b5e56)] bg-[var(--color-surface,#ffffff)] text-[var(--color-primary,#6b5e56)]"
                : "border-transparent text-[var(--color-muted,#6b7280)]"
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onActivate(p)}
              data-testid={`viewer-tab-${p}`}
              data-active={active || undefined}
              className={`flex items-center gap-2 ${!active ? "hover:text-[var(--color-text,#1a1a1a)]" : ""}`}
            >
              {iconFor(name)}
              <span className="truncate">{name}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${name}`}
              onClick={() => onClose(p)}
              data-testid={`viewer-tab-close-${p}`}
              className="flex h-[14px] w-[14px] items-center justify-center rounded-[3px] opacity-0 transition hover:bg-[var(--color-muted-bg,#ede8e1)] group-hover:opacity-60 hover:!opacity-100 focus-visible:opacity-100"
            >
              <X size={8} className="text-[var(--color-muted,#6b7280)]" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
