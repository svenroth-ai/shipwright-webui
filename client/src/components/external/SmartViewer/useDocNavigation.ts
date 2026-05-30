/*
 * useDocNavigation — in-pane cross-file navigation for the SmartViewer
 * (iterate-2026-05-30-smartviewer-render-ux, AC8 cross-file follow-up).
 *
 * Real project docs cross-link to OTHER files, e.g. the RTM:
 *   [FR-01.01](../../.shipwright/planning/01-adopted/spec.md#fr-0101)
 * — a relative `*.md` path + fragment, NOT a same-document `#fragment`.
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
 * Resolve a relative doc `href` against `currentPath` (project-root-relative
 * POSIX) using the URL API, which normalises `./` + `../` and clamps at the
 * root (so a link cannot escape above the project). Returns the resolved
 * path and the decoded fragment. Exported for unit tests.
 */
export function resolveDocPath(
  currentPath: string,
  href: string,
): { path: string; fragment: string | null } {
  const hashIdx = href.indexOf("#");
  const rawPath = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const fragment = hashIdx >= 0 ? decodeURIComponent(href.slice(hashIdx + 1)) : null;
  if (!rawPath) return { path: currentPath, fragment };
  try {
    const base = new URL("https://_local_/" + encodeURI(currentPath));
    const resolved = new URL(encodeURI(rawPath), base).pathname.replace(/^\/+/, "");
    return { path: decodeURI(resolved), fragment };
  } catch {
    return { path: rawPath.replace(/^\.?\//, ""), fragment };
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
      setOverride((prev) => resolveDocPath(prev?.path ?? initialPath, href));
    },
    [initialPath],
  );

  return {
    effectivePath: override?.path ?? initialPath,
    fragment: override?.fragment ?? null,
    navigateToDoc,
  };
}
