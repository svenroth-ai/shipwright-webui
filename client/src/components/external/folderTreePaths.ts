/*
 * Path helpers for the FileTree context menu (mission-desktop-style-v2 V5).
 * The tree addresses entries by project-relative, forward-slash paths (the
 * server joins segments with "/"); the relative form is copied verbatim (a
 * literal backslash in a filename is never rewritten). The absolute form is
 * the project folder plus the entry; on a Windows root (drive letter or UNC)
 * only the separators BETWEEN tree segments become backslashes.
 */

export function isWindowsRoot(root: string): boolean {
  return /^[A-Za-z]:/.test(root) || root.startsWith("\\\\");
}

export function absoluteTreePath(projectRoot: string, rel: string): string {
  const windows = isWindowsRoot(projectRoot);
  const root = projectRoot.replace(/[\\/]+$/, "");
  if (windows) return `${root}\\${rel.split("/").join("\\")}`;
  return `${root}/${rel}`;
}
