/*
 * Visual baseline — the Ship's Log project home (A16, FR-01.60; A00 AC7).
 *
 * Flips A00's `ships-log` route out of the `pending` manifest into `baselined`
 * (client/e2e/visual/routes.ts, same PR). Captures the Captain's Drawer (ring +
 * inline sub-scores + "Why an A?"), the scoped-iterate promptbox + graduation
 * card, and the logbook sheet with real entry rows.
 *
 * DETERMINISTIC: the compliance dashboard + the A02 run bundle are INTERCEPTED
 * with fixed content (no on-disk dashboard, no live event log, no Claude). The
 * run timestamps are midday-UTC so the locale-formatted dates never cross a day
 * boundary. The promptbox auto-focuses on load; playwright.config hides the caret.
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { settle } from "./stabilize";

const CONTROL_VERDICT_MD = [
  "## ✅ Control Verdict",
  "",
  "> **Under full control.**",
  "",
  "### Control Grade: **A** (98/100) — Under full control.",
  "",
  "| | Dimension | Signal | Anchor |",
  "|---|-----------|--------|--------|",
  "| ✅ | Requirement traceability | 43/44 FRs covered | ISO/IEC/IEEE 29148 |",
  "| ✅ | Test health | latest full suite 2092/2093 | OpenSSF Scorecard |",
  "| ✅ | Security | 0 open high/critical | NIST SSDF |",
  "",
].join("\n");

const COMPLIANCE = {
  status: "ok",
  grade: "A",
  score: 98,
  verdict: "Under full control.",
  generatedAt: "2026-07-14T12:00:00Z",
  controlVerdictMarkdown: CONTROL_VERDICT_MD,
  ciSecurityMarkdown: "",
  dimensions: [
    { key: "requirement-traceability", label: "Traceability", value: "43/44 FRs covered", pct: 100, doc: "ISO 29148" },
    { key: "test-health", label: "Test health", value: "2092/2093", pct: 100, doc: "OpenSSF" },
    { key: "security", label: "Security", value: "0 high/critical", pct: 100, doc: "NIST SSDF" },
  ],
};

function run(id: string, ts: string, intent: string, summary: string, frs: string[], commit: string) {
  return {
    runId: id,
    ts,
    source: "iterate",
    intent,
    changeType: intent,
    summary,
    description: null,
    commit,
    specImpact: "add",
    specImpactRaw: "add",
    affectedFrs: frs,
    newFrs: [],
    tests: { passed: 12, total: 12 },
    gates: { derived: true, test: "pass", review: "unknown", security: "unknown" },
    phaseDurations: null,
    campaign: null,
    subIterateId: null,
  };
}

const RUNS = {
  status: "ok",
  runs: [
    run("run-c3", "2026-07-13T12:00:00Z", "feature", "Ship's-Log project home", ["FR-01.60"], "abc1234def"),
    run("run-b2", "2026-07-11T12:00:00Z", "change", "Weather-Deck token sweep", ["FR-01.48", "FR-01.49"], "9f8e7d6c5b"),
    run("run-a1", "2026-07-05T12:00:00Z", "bug", "Fix pty spawn on a vanished cwd", ["FR-01.28"], "1122334455"),
  ],
  runCount: 3,
  gradeTrend: [],
  pipelinePhaseDurations: [],
  skippedLines: 0,
};

test.describe("visual: ships-log", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-visual-shipslog" });
    await setActiveProject(page, project.projectId);

    await page.route((u) => u.pathname.endsWith("/compliance"), (route) =>
      route.fulfill({ json: COMPLIANCE }),
    );
    await page.route((u) => /\/runs$/.test(u.pathname), (route) => route.fulfill({ json: RUNS }));
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("ships-log", async ({ page }) => {
    await page.goto(`/projects/${project.projectId}/log`);

    await expect(page.getByTestId("captains-drawer")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("captains-drawer-subs")).toBeVisible();
    await expect(page.getByTestId("shipslog-promptbox")).toBeVisible();
    await expect(page.getByTestId("shipslog-logbook")).toBeVisible();
    await expect(page.getByTestId("shipslog-entry-run-c3")).toBeVisible();
    await settle(page);

    await expect(page).toHaveScreenshot("ships-log.png", { fullPage: true });
  });
});
