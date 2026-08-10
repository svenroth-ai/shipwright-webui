/*
 * triage-board-read.ts — board read for GET /api/triage/:projectId.
 *
 * Composes the local triage union with the delivered-origin snapshot so a
 * dismiss already delivered to origin (but not yet pulled locally) is reflected
 * — the root-cause fix for the "ghost" bug. Kept out of routes/triage.ts to
 * hold that (oversize) route module flat and to keep the git/compose wiring in
 * one testable place (external review "split into layers").
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type { TriageItem } from "../types/triage.js";
import { readAllItemsWithDeliveredOrigin } from "./triage-compose.js";
import { loadDeliveredOrigin } from "./triage-origin.js";

export interface BoardOrigin {
  /** True when the delivered-origin snapshot was unioned into the read. */
  available: boolean;
  /** Commits the local checkout is behind its upstream, or null. */
  behind: number | null;
  /**
   * iterate-2026-08-08-triage-amend-reader (AC9): true when a status/amend
   * write right now would route to the per-tree outbox (idle main — origin
   * remote + HEAD on the default branch). False means a write lands on the
   * TRACKED store instead — the Edit UI uses this to disclose that BEFORE
   * the operator submits, not after. Optional/absent-safe: an older client
   * or a read that fell back to DEGRADED treats it as unknown.
   */
  writesRouteToOutbox?: boolean;
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

const execFileAsync = promisify(execFile);

async function gitAsync(projectRoot: string, gitArgs: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectRoot, ...gitArgs], {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * AC9's disclosure signal — read path twin of the Python CLI's
 * `shouldRouteToOutbox`. This path is polled every 30 s per registered
 * project (useTriage.ts); the write path's version uses `spawnSync`, which
 * blocks Node's single event loop for the duration of up to 3 git calls on
 * EVERY poll of EVERY project (code-reviewer, iterate-2026-08-08-triage-
 * amend-reader). A first fix cached that cost with a short TTL, but a cached
 * `true` can be served for up to the TTL after HEAD actually moves off the
 * default branch — silently suppressing AC9's disclosure banner in exactly
 * the case it exists to catch, the opposite of the spec's "fail toward
 * disclosure" principle (external code-review finding). `execFile` runs
 * off-thread (libuv), so the event loop stays free without caching anything
 * — this closes the performance and the staleness concern at once. Same
 * short-circuit logic and fail-safe-false semantics as the sync version;
 * kept as its own function since this
 * read path is its only caller.
 */
async function shouldRouteToOutboxAsync(projectRoot: string): Promise<boolean> {
  if ((await gitAsync(projectRoot, ["remote", "get-url", "origin"])) === null) return false;
  const current = await gitAsync(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!current) return false;
  const head = await gitAsync(projectRoot, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const defaultBranch = head ? head.replace(/^origin\//, "") : "main";
  return current === defaultBranch;
}

const DEGRADED: BoardOrigin = { available: false, behind: null };

/**
 * Cap on fragments carried into one log line, so a badly damaged file cannot
 * emit an unbounded log event. The COUNT is still reported in full.
 */
const CORRUPT_LOG_CAP = 5;

/**
 * Report unrecoverable fragments at the command boundary — the leaf
 * (`jsonl-records.ts`) never logs, so background callers, tests and routes all
 * behave predictably (iterate-2026-07-18-triage-jsonl-record-boundary).
 *
 * Records recovered from the same physical line are ALREADY in `items`; this
 * only surfaces what could not be decoded, so corruption never reads as
 * absence silently. Server log only — deliberately no API field, no client
 * type and no UI banner: the repair tooling lives in the shipwright monorepo,
 * not the WebUI, so a banner would report a problem the operator cannot act on
 * from here.
 */
function reportCorruption(
  projectId: string,
  total: number,
  sample: { source: string; lineNo: number; bytes: number }[],
): void {
  if (total === 0) return;
  console.warn(
    JSON.stringify({
      level: "warn",
      message: "triage log corruption recovered",
      projectId,
      // `total` is the true count; `sample` is capped, so the two differ on a
      // badly damaged file. Reporting only the sample length would under-report.
      fragments: total,
      sample,
    }),
  );
}

/**
 * Resolve the board items for a tracked `triage.jsonl` path, unioning the
 * delivered-origin snapshot. Degrades to the pure local union (identical to
 * `readAllItems`) when the flag is off or any git step fails. A read failure
 * (e.g. the file was rotated mid-request) is caught here and logged, returning
 * empty items — the caller stays a thin one-liner. Items are shallow-cloned so
 * the route's per-request enrichment never mutates shared objects.
 */
export async function readBoardItems(
  trackedAbsolute: string,
  projectId: string,
): Promise<BoardRead> {
  try {
    const projectRoot = path.dirname(path.dirname(trackedAbsolute));
    const delivered = loadDeliveredOrigin(projectRoot, { enabled: originUnionEnabled() });
    const corrupt: { source: string; lineNo: number; bytes: number }[] = [];
    let corruptTotal = 0;
    const items = readAllItemsWithDeliveredOrigin(trackedAbsolute, {
      originRawLines: delivered.originRawLines,
      // Bounded METADATA only — never the fragment text. A damaged tail can
      // hold arbitrary log contents and control characters, and this is a
      // user-facing read path. Mirrors the Python warning, which reports
      // "<n> bytes unrecoverable".
      onCorrupt: (fragment, source) => {
        corruptTotal += 1;
        if (corrupt.length >= CORRUPT_LOG_CAP) return;
        corrupt.push({
          source,
          lineNo: fragment.lineNo,
          bytes: Buffer.byteLength(fragment.text, "utf-8"),
        });
      },
    }).map((it) => ({ ...it }));
    reportCorruption(projectId, corruptTotal, corrupt);
    return {
      items,
      origin: {
        available: delivered.originAvailable,
        behind: delivered.localBehind,
        writesRouteToOutbox: await shouldRouteToOutboxAsync(projectRoot),
      },
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
