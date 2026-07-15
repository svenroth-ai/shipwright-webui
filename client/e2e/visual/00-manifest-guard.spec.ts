/*
 * Manifest guard. iterate-2026-07-10-harness-hardening (A00, AC4).
 *
 * A new surface must not be able to ship un-baselined by accident. This asserts
 * the manifest is HONEST:
 *
 *   - every route is exactly `baselined` or `pending` (no third state, no blank);
 *   - every `pending` route names the sub-iterate that owes it — so "pending" is
 *     visible, attributable debt rather than a hole someone can hide a screen in;
 *   - every `baselined` route actually HAS its committed PNG on disk. A route
 *     that claims a baseline it does not have is the exact failure this whole
 *     sub-iterate exists to prevent: a green gate that is checking nothing.
 *
 * It runs in the `visual` project, so it gates in CI alongside the screenshots.
 */

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINED_ROUTES, PENDING_ROUTES, VISUAL_ROUTES } from "./routes";

const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(__dirname_, "__screenshots__");

/** Mirrors `snapshotPathTemplate` in playwright.config.ts. */
function baselinePath(routeId: string): string {
  return path.join(SNAPSHOT_DIR, `${routeId}.png`);
}

test.describe("A00 — visual route manifest is honest", () => {
  test("every route is either baselined or explicitly pending with an owner", () => {
    const bad: string[] = [];
    for (const r of VISUAL_ROUTES) {
      if (r.status !== "baselined" && r.status !== "pending") {
        bad.push(`${r.id}: status must be "baselined" | "pending", got ${String(r.status)}`);
        continue;
      }
      if (r.status === "pending" && !r.owner?.trim()) {
        bad.push(
          `${r.id}: status "pending" REQUIRES an owning sub-iterate id (e.g. "A08") — ` +
            `otherwise the debt is anonymous and nobody ever pays it`,
        );
      }
      if (r.status === "baselined" && r.owner) {
        bad.push(`${r.id}: a baselined route must not carry a pending owner (${r.owner})`);
      }
    }
    expect(bad, `manifest violations:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  test("ids are unique — the id IS the baseline filename", () => {
    const seen = new Map<string, number>();
    for (const r of VISUAL_ROUTES) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(dupes, `duplicate route ids would overwrite each other's baselines: ${dupes}`).toEqual(
      [],
    );
  });

  test("every baselined route has its committed PNG on disk", () => {
    const missing = BASELINED_ROUTES.filter((r) => !fs.existsSync(baselinePath(r.id))).map(
      (r) => `${r.id} -> ${path.relative(process.cwd(), baselinePath(r.id))}`,
    );
    expect(
      missing,
      "These routes claim status 'baselined' but have NO baseline PNG committed. " +
        "A route that claims a baseline it does not have is a green gate checking nothing.\n" +
        "Either commit the container-generated baseline (see README in e2e/visual/), " +
        "or mark the route 'pending' with an owning sub-iterate.\n  " +
        missing.join("\n  "),
    ).toEqual([]);
  });

  test("no orphan baselines — every committed PNG belongs to a manifest route", () => {
    if (!fs.existsSync(SNAPSHOT_DIR)) return;
    const known = new Set(VISUAL_ROUTES.map((r) => r.id));
    const orphans = fs
      .readdirSync(SNAPSHOT_DIR)
      .filter((f) => f.endsWith(".png"))
      .map((f) => path.basename(f, ".png"))
      .filter((id) => !known.has(id));
    expect(
      orphans,
      `Baseline PNGs with no manifest entry (a renamed/removed route leaves these behind, ` +
        `and they then gate nothing): ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  test("pending debt is reported, not hidden", () => {
    // Not a failure — a deliberate, visible ledger line in the CI log. The point
    // is that "4 screens are not yet gated" is something a reviewer READS, rather
    // than something they have to go digging for.
    // eslint-disable-next-line no-console
    console.log(
      `[A00] visual coverage: ${BASELINED_ROUTES.length} baselined, ` +
        `${PENDING_ROUTES.length} pending -> ` +
        PENDING_ROUTES.map((r) => `${r.id}(${r.owner})`).join(", "),
    );
    expect(BASELINED_ROUTES.length).toBeGreaterThan(0);
  });
});
