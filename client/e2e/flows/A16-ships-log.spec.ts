/*
 * A16 — Ship's Log project home (FR-01.60). Seeds a graded project + one run on
 * disk (a real dashboard.md + shipwright_events.jsonl), then drives the real UI:
 * the Captain's Drawer argues its grade, the logbook shows the run as an entry,
 * the promptbox opens a scoped plan card whose unknown fields render "—", and
 * "Open board" escapes to the project-filtered board.
 *
 * Stops at the plan-card confirm — it does NOT click Go (that would create +
 * launch a real Claude session). The clickable entry→Mission navigation is
 * covered deterministically in LogEntryList.test.tsx (the join needs a task with
 * a matching runId, which the create API does not expose to a plain seed).
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";

const DASHBOARD_MD = [
  "# Compliance Dashboard",
  "",
  "Generated: 2026-07-14T12:00:00Z",
  "",
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

const EVENT = JSON.stringify({
  type: "work_completed",
  adr_id: "run-a16-e2e",
  ts: "2026-07-13T12:00:00Z",
  intent: "feature",
  change_type: "feature",
  summary: "Ship's-Log project home",
  commit: "abc1234def5678",
  spec_impact: "add",
  affected_frs: ["FR-01.60"],
  tests: { passed: 12, total: 12 },
});

test.describe("A16 — Ship's Log home", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, {
      name: "Atlas",
      files: {
        ".shipwright/compliance/dashboard.md": DASHBOARD_MD,
        "shipwright_events.jsonl": EVENT + "\n",
      },
    });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("drawer + logbook + promptbox render; plan card confirms; open-board escapes", async ({ page }) => {
    await page.goto(`/projects/${project.projectId}/log`);

    // 1 — the Captain's Drawer argues its grade with parsed sub-scores.
    const drawer = page.getByTestId("captains-drawer");
    await expect(drawer).toBeVisible({ timeout: 15_000 });
    await expect(drawer).toHaveAttribute("data-graded", "true");
    await expect(page.getByTestId("captains-drawer-subs")).toBeVisible();

    // 2 — the promptbox auto-focuses on load (§5.2). Assert this BEFORE any
    //     focus-stealing interaction (the drawer modal restores focus to its
    //     own trigger on close).
    const input = page.getByTestId("shipslog-promptbox-input");
    await expect(input).toBeFocused();

    // 3 — "Why an A?" opens the real control record.
    await page.getByTestId("captains-drawer-why").click();
    await expect(page.getByTestId("compliance-detail-modal")).toBeVisible();
    await page.keyboard.press("Escape");

    // 4 — the logbook shows the seeded run as an entry. It has NO joined task, so
    //     it is a non-clickable entry (AC3 — never a dead click into a 404).
    const entry = page.getByTestId("shipslog-entry-run-a16-e2e");
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute("data-clickable", "false");
    await expect(entry).toContainText("Ship's-Log project home");

    // 5 — the promptbox opens a scoped plan card whose unknown fields render "—".
    await input.fill("add rate-limit headers to the media route");
    await page.getByTestId("shipslog-promptbox-plan").click();
    await expect(page.getByTestId("shipslog-plan-card")).toBeVisible();
    await expect(page.getByTestId("shipslog-plan-complexity")).toHaveText("—");
    await expect(page.getByTestId("shipslog-plan-affected-frs")).toHaveText("—");
    // Stop at the confirm — Cancel, do NOT drive a real Claude session.
    await page.getByTestId("shipslog-plan-cancel").click();
    await expect(page.getByTestId("shipslog-plan-card")).toBeHidden();

    // 6 — "Open board" escapes to the board filtered by this project.
    await page.getByTestId("ships-log-open-board").click();
    await expect(page).toHaveURL(new RegExp(`projectId=${project.projectId}`));
  });
});
