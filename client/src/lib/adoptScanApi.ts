/*
 * adoptScanApi.ts - client wrapper for POST /api/adopt/scan (read-only look at a
 * local repo for the Adopt screen). The server runs the shipwright adopt analyzer
 * and returns ONLY the detected profile block; it already refused an unknown
 * snapshot major and capped/cleaned the repo-derived warnings. Read outcomes are
 * data (`status`), never thrown.
 */

import type { SnapshotProfile } from "../components/wizard/IntentWizard/adoptSnapshotProfile";

export type AdoptScanOutcome =
  | { status: "ok"; profile: SnapshotProfile }
  | { status: "invalid-path" | "busy" | "failed"; reason: string }
  | { status: "unsupported-schema"; version: string }
  | { status: "engine-unavailable"; reason: string; repairCommand: string };

export const adoptScanKey = (path: string) => ["adopt-scan", path] as const;

const STATUSES = new Set(["ok", "invalid-path", "busy", "failed", "unsupported-schema", "engine-unavailable"]);

export async function scanAdoptProfile(path: string): Promise<AdoptScanOutcome> {
  try {
    const r = await fetch("/api/adopt/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const body: unknown = await r.json();
    const status = typeof body === "object" && body !== null ? (body as { status?: unknown }).status : undefined;
    if (typeof status === "string" && STATUSES.has(status)) return body as AdoptScanOutcome;
  } catch {
    // fall through - an unreachable server is a failure, not a verdict
  }
  return { status: "failed", reason: "Couldn't reach the server." };
}

/** Plain-language provenance for `profile.source` (unknown values pass through). */
export function profileSourceLabel(source: string | null): string {
  switch (source) {
    case "project":
      return "this project's own profile";
    case "user":
      return "one of your own profiles";
    case "bundled":
    case "builtin":
      return "a built-in profile";
    case "explicit":
      return "a profile you pointed at";
    case "user-hint":
      return "the profile you named";
    case null:
      return "";
    default:
      return source;
  }
}
