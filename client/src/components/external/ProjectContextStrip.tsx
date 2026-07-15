/*
 * Read-only project chip rendered by NewIssueModal when
 * `useProjectFilter` returns a scoped project (not "All projects").
 *
 * Shape mirrors .project-context from new-task-dialog.html — a soft
 * neutral card with a color dot, name, and truncated path.
 *
 * v0.3.2 — narrow-modal robustness:
 *   - `whitespace-nowrap` + `flex-shrink-0` on the leading "Creating in"
 *     and project-name segments so they never wrap to a second line when
 *     the modal narrows (e.g. when Advanced parameters opens a vertical
 *     scrollbar inside the dialog).
 *   - Path now shows the LAST two segments with a leading ellipsis
 *     (`…/03 Development/shipwright-webui`) instead of the absolute
 *     prefix. The basename + parent are the relevant identifiers; the
 *     drive letter + Users\* prefix is not. Full path remains in the
 *     hover tooltip.
 */

import { FolderOpen } from "lucide-react";

export interface ProjectContextStripProps {
  name: string;
  /** Optional accent color from project.settings.color. */
  color?: string;
  /** Absolute path — UI shows the tail; full string in `title`. */
  path?: string;
}

/**
 * Shorten an absolute path to its last two segments with a leading
 * ellipsis. For shorter paths (<=2 segments) returns the path unchanged.
 *
 *   "C:\Users\Sven\foo\bar\baz" → "…/bar/baz"
 *   "/home/sven/project"        → "…/sven/project"
 *   "/foo"                      → "/foo" (already short)
 */
export function shortenProjectPath(p: string | undefined): string {
  if (!p) return "";
  const segments = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length <= 2) return p;
  return "…/" + segments.slice(-2).join("/");
}

export function ProjectContextStrip({
  name,
  color,
  path,
}: ProjectContextStripProps) {
  const shortPath = shortenProjectPath(path);
  return (
    <div
      className="flex flex-nowrap items-center gap-2 rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)] px-3 py-2 text-[12px] text-[var(--color-muted)]"
      data-testid="project-context-strip"
    >
      <FolderOpen size={13} className="shrink-0 text-[var(--color-accent,#857568)]" />
      <span className="shrink-0 whitespace-nowrap opacity-85">Creating in</span>
      <span
        aria-hidden="true"
        className="h-[9px] w-[9px] shrink-0 rounded-full"
        style={{ background: color ?? "var(--color-muted, #9ca3af)" }}
      />
      <span
        className="shrink-0 whitespace-nowrap font-semibold text-[var(--color-text)]"
        data-testid="project-context-name"
      >
        {name}
      </span>
      {path && (
        <span
          className="ml-auto min-w-0 max-w-[200px] overflow-hidden truncate whitespace-nowrap font-mono text-[11px] opacity-80"
          title={path}
          data-testid="project-context-path"
        >
          {shortPath}
        </span>
      )}
    </div>
  );
}
