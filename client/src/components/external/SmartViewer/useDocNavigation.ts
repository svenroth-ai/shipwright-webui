/*
 * useDocNavigation — in-pane cross-file navigation for the SmartViewer
 * (iterate-2026-05-30-smartviewer-render-ux, AC8 cross-file follow-up).
 *
 * Real project docs cross-link to OTHER files, e.g. the RTM:
 *   [FR-01.01](../../.shipwright/planning/01-adopted/spec.md#fr-0101)
 * — a relative file path + fragment, NOT a same-document `#fragment`.
 * This hook lets the SmartViewer follow such links WITHOUT any parent
 * wiring: it keeps an internal override of the displayed path (+ a pending
 * scroll fragment). The override resets whenever the parent selects a
 * different file (the `initialPath` prop changes), so the FolderTree
 * selection still wins on an explicit pick.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface DocNavigation {
  /** Path the viewer should actually load (override if navigated, else prop). */
  effectivePath: string;
  /** Fragment to scroll to after the navigated file renders (null = none). */
  fragment: string | null;
  /** Follow a relative doc link (`href` may carry a `#fragment`). */
  navigateToDoc: (href: string) => void;
}

/**
 * Resolve a relative file `href` (any extension) against `currentPath`
 * (project-root-relative POSIX, or an absolute outside path) segment by
 * segment: `./` + `../` are normalised and clamped at the root (a link cannot
 * escape above the project / drive). Returns the resolved path and the decoded
 * fragment. Exported for unit tests.
 */
export function resolveDocPath(
  currentPath: string,
  href: string,
): { path: string; fragment: string | null } {
  const hashIdx = href.indexOf("#");
  let rawPath = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const fragment = hashIdx >= 0 ? safeDecode(href.slice(hashIdx + 1)) : null;
  const queryIdx = rawPath.indexOf("?");
  if (queryIdx >= 0) rawPath = rawPath.slice(0, queryIdx); // `?plain=1` etc. is not part of the file name
  if (!rawPath) return { path: currentPath, fragment };

  // Segment-wise resolution (no URL API: it double-encodes `%20` and cannot carry a drive letter).
  // A leading `/` means the root of the tree the current file lives in — the project root for a
  // project file (like VS Code's workspace root), the drive / filesystem root for an outside file.
  const cur = currentPath.replaceAll("\\", "/");
  const rootMatch = /^(?:[a-zA-Z]:\/|\/\/[^/]+\/[^/]+\/|\/)/.exec(cur);
  const root = rootMatch ? rootMatch[0] : "";
  const baseDir = cur.slice(root.length).split("/").slice(0, -1);
  const target = rawPath.replaceAll("\\", "/");
  const segs = target.startsWith("/") ? [] : baseDir;
  // Decode PER SEGMENT, after splitting: an encoded `%2F` stays part of a file name, never a separator.
  for (const seg of target.split("/").map(safeDecode)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") segs.pop(); // clamps at the root: a link cannot escape above it
    else segs.push(seg);
  }
  return { path: root + segs.join("/"), fragment };
}

export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // malformed escape (`100%`) — keep it literal rather than throw
  }
}

export function useDocNavigation(initialPath: string): DocNavigation {
  const [override, setOverride] = useState<{ path: string; fragment: string | null } | null>(
    null,
  );
  const initialRef = useRef(initialPath);

  useEffect(() => {
    if (initialRef.current !== initialPath) {
      initialRef.current = initialPath;
      setOverride(null); // parent picked a different file → drop the override
    }
  }, [initialPath]);

  const navigateToDoc = useCallback(
    (href: string) => {
      setOverride((prev) => {
        const next = resolveDocPath(prev?.path ?? initialPath, href);
        // A link to the root / a bare drive (`/`, `./..`) names no file: stay where we are.
        return /^(?:[a-zA-Z]:\/|\/\/[^/]+\/[^/]+\/|\/)?$/.test(next.path) ? prev : next;
      });
    },
    [initialPath],
  );

  return {
    effectivePath: override?.path ?? initialPath,
    fragment: override?.fragment ?? null,
    navigateToDoc,
  };
}
