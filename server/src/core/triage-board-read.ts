/*
 * triage-board-read.ts — board read for GET /api/triage/:projectId.
 *
 * Composes the local triage union with the delivered-origin snapshot so a
 * dismiss already delivered to origin (but not yet pulled locally) is reflected
 * — the root-cause fix for the "ghost" bug. Kept out of routes/triage.ts to
 * hold that (oversize) route module flat and to keep the git/compose wiring in
 * one testable place (external review "split into layers").
 */

import path from "node:path";

import type { TriageItem } from "../types/triage.js";
import { readAllItemsWithDeliveredOrigin } from "./triage-compose.js";
import { loadDeliveredOrigin } from "./triage-origin.js";

export interface BoardOrigin {
  /** True when the delivered-origin snapshot was unioned into the read. */
  available: boolean;
  /** Commits the local checkout is behind its upstream, or null. */
  behind: number | null;
}

export interface BoardRead {
  items: TriageItem[];
  origin: BoardOrigin;
}

/**
 * Feature flag for the delivered-origin union read. Default ON; set
 * SHIPWRIGHT_WEBUI_TRIAGE_ORIGIN_UNION=0|false|off to roll back to the pure
 * local-only read. Independent of the automatic degrade-to-local on any git
 * failure — this is an explicit kill switch.
 */
export function originUnionEnabled(): boolean {
  const v = (process.env.SHIPWRIGHT_WEBUI_TRIAGE_ORIGIN_UNION ?? "").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

const DEGRADED: BoardOrigin = { available: false, behind: null };

/**
 * Resolve the board items for a tracked `triage.jsonl` path, unioning the
 * delivered-origin snapshot. Degrades to the pure local union (identical to
 * `readAllItems`) when the flag is off or any git step fails. A read failure
 * (e.g. the file was rotated mid-request) is caught here and logged, returning
 * empty items — the caller stays a thin one-liner. Items are shallow-cloned so
 * the route's per-request enrichment never mutates shared objects.
 */
export function readBoardItems(trackedAbsolute: string, projectId: string): BoardRead {
  try {
    const projectRoot = path.dirname(path.dirname(trackedAbsolute));
    const delivered = loadDeliveredOrigin(projectRoot, { enabled: originUnionEnabled() });
    const items = readAllItemsWithDeliveredOrigin(trackedAbsolute, {
      originRawLines: delivered.originRawLines,
    }).map((it) => ({ ...it }));
    return {
      items,
      origin: { available: delivered.originAvailable, behind: delivered.localBehind },
    };
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "triage read failed",
        projectId,
        error: String(err).slice(0, 200),
      }),
    );
    return { items: [], origin: DEGRADED };
  }
}
