/*
 * navDestinations — the palette's "Open" group, derived from the REAL route
 * table (client/src/router.tsx), never a hand-typed list (A21, FR-01.65).
 *
 * The label lives ON the route as `handle.nav` (co-located with the route it
 * opens), so a surface removed from the router disappears from the palette
 * automatically, a route with no `nav` handle is simply not a destination, and
 * there is no separate label map to drift. Dynamic (`:param`) and nested
 * (`a/b`) routes are excluded by construction — only top-level surfaces carry a
 * `nav` handle.
 */

import { router } from "../router";

export interface NavDestination {
  id: string;
  label: string;
  path: string;
}

interface NavHandle {
  nav?: { label: string; order?: number };
}
interface RouteLike {
  path?: string;
  index?: boolean;
  handle?: unknown;
  children?: RouteLike[];
}

export function getNavDestinations(): NavDestination[] {
  const routes = (router.routes ?? []) as RouteLike[];
  const root = routes.find((r) => r.path === "/") ?? routes[0];
  const children = root?.children ?? [];
  const out: Array<NavDestination & { order: number }> = [];
  for (const child of children) {
    const nav = (child.handle as NavHandle | undefined)?.nav;
    if (!nav) continue;
    const key = child.index ? "" : (child.path ?? "");
    out.push({
      id: key === "" ? "board" : key,
      label: nav.label,
      path: key === "" ? "/" : `/${key}`,
      order: nav.order ?? 999,
    });
  }
  out.sort((a, b) => a.order - b.order);
  return out.map(({ id, label, path }) => ({ id, label, path }));
}
