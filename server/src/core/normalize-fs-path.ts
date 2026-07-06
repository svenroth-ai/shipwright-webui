/*
 * normalize-fs-path.ts — strip paste-artifact quoting from a user-supplied
 * filesystem path before it is stored (project.path / task.cwd) or fed to the
 * launch-command builder in core/launcher.ts.
 *
 * Why (iterate-2026-07-06, reported on macOS): a directory path copied from a
 * shell context — a `cd '…'` line, a drag-into-terminal, or "Copy as Pathname"
 * on a space-containing folder — arrives wrapped in a matching pair of
 * surrounding quotes, e.g.
 *   '/Users/me/Claude Command Center'   or   "C:\Users\me\My Project"
 * The value is stored verbatim and core/launcher.ts later SHELL-ESCAPES it.
 * Escaping the LITERAL quote characters yields a broken command —
 *   cd ''\''/Users/me/Claude Command Center'\''' && claude …
 * which the shell reads as a directory literally named "'…'", so `cd` fails
 * ("no such file or directory") and the launch never starts.
 *
 * A real path never both begins AND ends with the same quote character, so
 * removing a single balanced surrounding pair is always safe and never
 * corrupts a legitimate path. Inner quotes (e.g. o'brien) are preserved, and a
 * lone leading/trailing quote (not a matching pair) is left untouched.
 */
export function normalizeFsPath(raw: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.length >= 2 &&
    (trimmed[0] === "'" || trimmed[0] === '"') &&
    trimmed[trimmed.length - 1] === trimmed[0]
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}
