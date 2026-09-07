/*
 * commit-lock.test.ts — commitCore's mapping of org-chart.json lock
 * acquisition/write errors (ELOCKED, symlink escape) to their named HTTP
 * responses. Split out of commit.test.ts (bloat ceiling) — a cohesive
 * concern of its own: the ONE lock now spans the whole charter+daemon-config
 * +org-chart write sequence, so every error surfaced through it is caught
 * at a single outer boundary in commitCore.
 */
import { describe, it, expect, vi } from "vitest";

import { commitCore } from "./commit.js";
import { OrgFileSymlinkEscapeError } from "./org-file-lock.js";
import { EMPTY_ORG_CHART, baseDeps, validBody } from "./commit.test-fixtures.js";

describe("commitCore — org-chart.json lock error mapping", () => {
  // CLAUDE.md rule 6 / DO-NOT #6, mirrored from beat-register-release-request.ts:
  // genuine cross-process lock contention gets its OWN named 409, never the
  // app-wide error handler's generic (wrong-resource) fallback.
  //
  // Concurrency-fix note: commitCore now holds ONE lock on org-chart.json
  // across the whole charter+daemon-config+org-chart write sequence, so the
  // org-chart.json lock acquisition must SUCCEED (with a fake ctx) before
  // the inner daemon-config.json write can even be attempted.
  it("409s daemon_config_locked on ELOCKED from the daemon-config.json write, without touching org-chart.json", async () => {
    const withOrgFileLockFn = vi.fn(async (target: string, _opts: unknown, fn: (ctx: unknown) => unknown) => {
      if (target.includes("daemon-config.json")) {
        const err = new Error("lock exhausted") as NodeJS.ErrnoException;
        err.code = "ELOCKED";
        throw err;
      }
      return fn({ read: () => JSON.stringify(EMPTY_ORG_CHART), write: () => {} });
    });
    const deps = baseDeps({
      daemonConfigReadFn: () => ({
        status: 200 as const,
        body: { found: true as const, config: { orgChartPath: "/leads/org-chart.json", webuiBaseUrl: "http://localhost:5173" } },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      withOrgFileLockFn: withOrgFileLockFn as any,
    });
    const result = await commitCore(deps, validBody());
    expect(result).toEqual({ status: 409, body: { error: "daemon_config_locked" } });
  });

  it("409s org_chart_locked on ELOCKED from acquiring the org-chart.json lock, before any write is attempted", async () => {
    const withOrgFileLockFn = vi.fn(() => {
      const err = new Error("lock exhausted") as NodeJS.ErrnoException;
      err.code = "ELOCKED";
      throw err;
    });
    const deps = baseDeps({
      daemonConfigReadFn: () => ({
        status: 200 as const,
        body: { found: true as const, config: { orgChartPath: "/leads/org-chart.json", webuiBaseUrl: "http://localhost:5173" } },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      withOrgFileLockFn: withOrgFileLockFn as any,
    });
    const result = await commitCore(deps, validBody());
    expect(result).toEqual({ status: 409, body: { error: "org_chart_locked" } });
    expect(deps.writeCharterFn).not.toHaveBeenCalled();
  });

  it("403s symlink_forbidden when acquiring the org-chart.json lock hits a symlinked target", async () => {
    const deps = baseDeps({
      daemonConfigReadFn: () => ({
        status: 200 as const,
        body: { found: true as const, config: { orgChartPath: "/leads/org-chart.json", webuiBaseUrl: "http://localhost:5173" } },
      }),
      withOrgFileLockFn: vi.fn(() => {
        throw new OrgFileSymlinkEscapeError("/leads/org-chart.json");
      }),
    });
    const result = await commitCore(deps, validBody());
    expect(result).toEqual({ status: 403, body: { error: "symlink_forbidden", detail: "/leads/org-chart.json" } });
  });

  it("403s symlink_forbidden when the charter.md write itself hits a symlinked target, inside the org-chart.json lock", async () => {
    const withOrgFileLockFn = vi.fn(async (_target: string, _opts: unknown, fn: (ctx: unknown) => unknown) =>
      fn({ read: () => JSON.stringify(EMPTY_ORG_CHART), write: () => {} }),
    );
    const deps = baseDeps({
      writeCharterFn: vi.fn(() => {
        throw new OrgFileSymlinkEscapeError("/leads/new-lead/charter.md");
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      withOrgFileLockFn: withOrgFileLockFn as any,
    });
    const result = await commitCore(deps, validBody());
    expect(result).toEqual({ status: 403, body: { error: "symlink_forbidden", detail: "/leads/new-lead/charter.md" } });
    expect(withOrgFileLockFn).toHaveBeenCalledTimes(1);
  });
});
