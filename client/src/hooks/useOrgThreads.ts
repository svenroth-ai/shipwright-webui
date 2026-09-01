/*
 * useOrgThreads — the Org page's per-lead follow-up-thread lookup (FR-04.42,
 * V4c). leadwright owns the actual round store and has not shipped its
 * producer yet (L8, FR-04.17-FR-04.19) — until it does, every lead
 * legitimately has no thread, and the Org page must keep rendering that
 * cleanly rather than fabricating rounds (AC-d). This file is the seam:
 * once that producer exists, this hook becomes a real query (its return
 * shape will change to `{data, isLoading, error}` like `useOrgRoster`, and
 * `OrgPage.tsx`'s call site changes with it) — do not treat this stub as a
 * data source to build against.
 */
import type { OrgThreadCard } from "../components/org/OrgThread";

const EMPTY: Record<string, OrgThreadCard[]> = {};

export function useOrgThreads(): Record<string, OrgThreadCard[]> {
  return EMPTY;
}
