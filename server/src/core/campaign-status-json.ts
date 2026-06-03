/*
 * campaign-status-json.ts — the `status.json` input-reader for campaigns
 * (the JSON-side sibling of `campaign-parse.ts`, which reads campaign.md).
 *
 * `status.json` is written by `campaign_init.py` / `campaign_progress.py` /
 * the autonomous loop. It carries per-sub-iterate status + (new) a top-level
 * campaign lifecycle `status`. Reads are torn-read tolerant (the 3 s poll can
 * race a Python write) — a malformed/half-written file resolves to null and the
 * caller falls back to campaign.md.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Campaign-level lifecycle status, producer-owned (status.json top-level
 * `status`, or hand-authored campaign.md frontmatter `status:`). Optional — a
 * campaign without it is "legacy" and consumers fall back to derived done/total.
 * draft = planned (triage-only), active = running (shown on the board),
 * complete = done (hidden).
 */
export type CampaignLifecycleStatus = "draft" | "active" | "complete";

const VALID_LIFECYCLE: ReadonlySet<string> = new Set([
  "draft",
  "active",
  "complete",
]);

export interface StatusSubIterate {
  id?: unknown;
  slug?: unknown;
  status?: unknown;
  commit?: unknown;
  branch?: unknown;
}

export interface StatusJson {
  branch_strategy?: unknown;
  status?: unknown;
  sub_iterates?: unknown;
}

/** Read + JSON-parse `<campaignDir>/status.json`, or null when absent/torn. */
export function readStatusJson(campaignDir: string): StatusJson | null {
  const p = path.join(campaignDir, "status.json");
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as StatusJson;
  } catch {
    // torn read / malformed → treat as absent, fall back to campaign.md
    return null;
  }
}

/**
 * Resolve the campaign-level lifecycle status: status.json top-level `status`
 * wins, else the campaign.md frontmatter `status:`. Unknown / absent → null
 * (legacy; the consumer falls back to done/total).
 */
export function pickLifecycle(
  status: StatusJson | null,
  fm: Record<string, string>,
): CampaignLifecycleStatus | null {
  const fromJson =
    status && typeof status.status === "string" ? status.status : "";
  const raw = (fromJson || fm.status || "").trim().toLowerCase();
  return VALID_LIFECYCLE.has(raw) ? (raw as CampaignLifecycleStatus) : null;
}
