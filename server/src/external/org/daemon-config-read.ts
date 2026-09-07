/*
 * external/org/daemon-config-read.ts — GET /api/external/org/daemon-config
 * (iterate-2026-09-07-leadwright-setup-wizard, W14).
 *
 * Mirrors org-chart.ts's read pattern (fixed path, inline symlink check).
 * Unlike org-chart.ts, a MISSING file is not an error here — it's the
 * "show a fragment instead of writing" template branch the card's own
 * brief specifies ("Do not guess a location" — but orgChartPath/
 * webuiBaseUrl in the template ARE server-computed, never left for the
 * client to invent, per the external-review finding in round 2).
 */
import type { Hono } from "hono";
import { readFileSync, lstatSync } from "node:fs";
import path from "node:path";

import type { PreflightDaemonConfig } from "../../types/leadwright-preflight.js";

export interface DaemonConfigReadDeps {
  leadsRoot: string;
  webuiBaseUrl: string;
  lstatSync?: (path: string) => { isSymbolicLink(): boolean };
}

export type DaemonConfigReadCoreResult =
  | { status: 200; body: { found: true; config: PreflightDaemonConfig } | { found: false; template: { orgChartPath: string; webuiBaseUrl: string } } }
  | { status: 403 | 500 | 502; body: { error: string; detail?: string } };

export function daemonConfigReadCore(deps: DaemonConfigReadDeps): DaemonConfigReadCoreResult {
  const { leadsRoot, webuiBaseUrl } = deps;
  const lstat = deps.lstatSync ?? ((p: string) => lstatSync(p));
  const target = path.join(leadsRoot, "daemon-config.json");

  try {
    if (lstat(target).isSymbolicLink()) {
      return { status: 403, body: { error: "symlink_forbidden" } };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      return { status: 500, body: { error: "daemon_config_stat_failed", detail: String(err).slice(0, 200) } };
    }
  }

  let raw: string;
  try {
    raw = readFileSync(target, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return {
        status: 200,
        body: { found: false, template: { orgChartPath: path.join(leadsRoot, "org-chart.json"), webuiBaseUrl } },
      };
    }
    return { status: 500, body: { error: "daemon_config_read_failed", detail: String(err).slice(0, 200) } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 502, body: { error: "daemon_config_invalid" } };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { status: 502, body: { error: "daemon_config_invalid" } };
  }

  return { status: 200, body: { found: true, config: parsed as PreflightDaemonConfig } };
}

export function registerDaemonConfigReadRoute(app: Hono, deps: DaemonConfigReadDeps): void {
  app.get("/api/external/org/daemon-config", async (c) => {
    const result = daemonConfigReadCore(deps);
    return c.json(result.body, result.status);
  });
}
