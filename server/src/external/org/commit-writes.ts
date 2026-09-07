/*
 * commit-writes.ts — the three ordered, lock-protected writes the leads
 * commit route performs (iterate-2026-09-07-leadwright-setup-wizard, W14).
 * Order (enforced by commit.ts's call sequence, not here):
 *   charter.md -> daemon-config.json -> org-chart.json
 * org-chart.json is what "activates" a lead (leadwright's daemon reads the
 * roster from there), so writing it LAST means a failure at any earlier
 * step leaves only harmless, retry-safe residue (an orphan charter.md, or
 * a daemon-config.json entry pointing at a lead the roster doesn't list
 * yet) rather than a half-activated lead.
 */
import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { withOrgFileLock, assertNotSymlink, type LstatFn, type OrgFileLockOptions } from "./org-file-lock.js";
import { canonicalStringify, type DaemonConfigAdditions } from "./leadwright-proposal-merge.js";
import type { PreflightDaemonConfig, PreflightLead, PreflightOrgChart } from "../../types/leadwright-preflight.js";

export type WithOrgFileLockFn = typeof withOrgFileLock;
export type { LstatFn };

/** charter.md is a brand-new file under a brand-new leadId — no concurrent
 *  WRITER can exist for a path that did not exist a moment ago, so this
 *  needs no LOCK (mirrors file-write.ts's documented "no lock" posture for
 *  charter files; the concurrency story there is If-Match, which has no
 *  meaning for a CREATE). It IS symlink-checked, same as the other two
 *  writes: `<leadsRoot>/<leadId>` and the charter.md path itself are each
 *  checked immediately before the syscall that would follow them, closing
 *  the escape a pre-planted symlink (or a retry landing on one) would
 *  otherwise open. */
export function writeNewCharterFile(
  leadsRoot: string,
  leadId: string,
  content: string,
  lstat: LstatFn = lstatSync,
): void {
  const dir = path.join(leadsRoot, leadId);
  assertNotSymlink(dir, lstat);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "charter.md");
  assertNotSymlink(filePath, lstat);
  writeFileSync(filePath, content, "utf8");
}

export type DaemonConfigWriteResult = { status: "written" } | { status: "missing"; fragment: string };

function buildDaemonConfigFragment(leadId: string, additions: DaemonConfigAdditions): string {
  return JSON.stringify(
    {
      leadProjectRoots: { [leadId]: additions.path },
      leadActionIds: { [leadId]: additions.actionId },
      leadPluginDirs: { [leadId]: additions.pluginDirs },
    },
    null,
    2,
  );
}

/**
 * ADD-ONLY merge — reads the CURRENT on-disk daemon-config.json fresh
 * (inside the lock, never the pre-commit snapshot) and writes back with
 * ONLY this lead's three entries added to leadProjectRoots/leadActionIds/
 * leadPluginDirs. Every existing key — other leads' entries, every
 * unrelated top-level field — passes through untouched. A file that does
 * not exist on disk is never guessed into existence — the caller gets a
 * copy-paste fragment instead (W14's "home is <leadsRoot>/daemon-config.json,
 * if absent show a fragment instead of guessing a location").
 *
 * External-review fix (GLM, medium): the "does it exist" decision now comes
 * from the `mustExist: true` lock ACQUISITION's own ENOENT, not a boolean
 * the caller read before taking the lock — a pre-lock snapshot is a TOCTOU
 * window (the file could be deleted between that read and this call).
 */
export async function writeDaemonConfigAddition(
  leadsRoot: string,
  leadId: string,
  additions: DaemonConfigAdditions,
  withOrgFileLockFn: WithOrgFileLockFn = withOrgFileLock,
  lockOptions: Omit<OrgFileLockOptions, "mustExist"> = {},
): Promise<DaemonConfigWriteResult> {
  const target = path.join(leadsRoot, "daemon-config.json");
  try {
    await withOrgFileLockFn(target, { ...lockOptions, mustExist: true }, (ctx) => {
      const current = JSON.parse(ctx.read()) as PreflightDaemonConfig;
      const next: PreflightDaemonConfig = {
        ...current,
        leadProjectRoots: { ...(current.leadProjectRoots ?? {}), [leadId]: additions.path },
        leadActionIds: { ...(current.leadActionIds ?? {}), [leadId]: additions.actionId },
        leadPluginDirs: { ...(current.leadPluginDirs ?? {}), [leadId]: additions.pluginDirs },
      };
      ctx.write(JSON.stringify(next, null, 2));
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { status: "missing", fragment: buildDaemonConfigFragment(leadId, additions) };
    }
    throw err;
  }
  return { status: "written" };
}

export type OrgChartWriteResult = { status: "written" } | { status: "already_committed" } | { status: "conflict" };

/** Pure decision for adding `leadId` -> `lead` to an org-chart snapshot —
 *  idempotent when the roster ALREADY carries this exact lead (a safe retry
 *  after an earlier commit attempt crashed between this write and its HTTP
 *  response reaching the client); a DIFFERING existing entry is refused,
 *  never silently overwritten or reordered. Exported so `commit.ts` can
 *  reuse it INSIDE an org-chart.json lock it already holds (the
 *  concurrent-same-leadId-commit race fix) rather than acquiring a second,
 *  nested lock on the same file via `writeOrgChartLead`. */
export function applyOrgChartLead(
  current: PreflightOrgChart,
  leadId: string,
  lead: PreflightLead,
): { status: "written"; next: PreflightOrgChart } | { status: "already_committed" } | { status: "conflict" } {
  const existing = current.leads[leadId];
  if (existing) {
    return canonicalStringify(existing) === canonicalStringify(lead)
      ? ({ status: "already_committed" } as const)
      : ({ status: "conflict" } as const);
  }
  return { status: "written", next: { ...current, leads: { ...current.leads, [leadId]: lead } } };
}

/**
 * Adds `leadId` -> `lead` to org-chart.json's `leads` map, re-reading fresh
 * inside the lock. Thin wrapper over `applyOrgChartLead` for callers that
 * don't already hold this file's lock (`commit.ts` does, and calls
 * `applyOrgChartLead` directly instead — see that file).
 */
export async function writeOrgChartLead(
  leadsRoot: string,
  leadId: string,
  lead: PreflightLead,
  withOrgFileLockFn: WithOrgFileLockFn = withOrgFileLock,
  lockOptions: Omit<OrgFileLockOptions, "mustExist"> = {},
): Promise<OrgChartWriteResult> {
  const target = path.join(leadsRoot, "org-chart.json");
  return withOrgFileLockFn(target, { ...lockOptions, mustExist: true }, (ctx) => {
    const current = JSON.parse(ctx.read()) as PreflightOrgChart;
    const result = applyOrgChartLead(current, leadId, lead);
    if (result.status === "written") ctx.write(JSON.stringify(result.next, null, 2));
    return { status: result.status } as const;
  });
}
