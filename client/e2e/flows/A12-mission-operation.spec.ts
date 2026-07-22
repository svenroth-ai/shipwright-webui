/*
 * A12 — Mission Control "Operation" card (FR-01.56): verdict banner + mission
 * line + curated proof summary.
 *
 * Seeded fixtures only (never operator UUIDs). A seeded task joins to NO run (no
 * shipwright_events.jsonl), so the card renders its HONEST neutral verdict —
 * "No run data yet", NEVER a false ALL CLEAR (AC3, proven here end-to-end in a
 * real browser). The ALL CLEAR / GATE HOLD derivations are pinned deterministically
 * against seeded facts in the unit + component suites (proofLines.test.ts,
 * OperationCard.test.tsx).
 *
 * The regression this spec exists to PREVENT (AC2): the proof summary is NOT the
 * terminal. It has no xterm, no pty, no WebSocket, no input. The REAL embedded
 * terminal is a distinct surface in the Files & Terminal tab (A18) — this spec
 * proves both live side by side.
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";

test.describe("A12 — Mission 'Operation' card", () => {
  let project: SeededProject;
  let taskId: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Operation", dirName: "sw-a12-operation" });
    const task = await seedTask(request, {
      title: "Survey the operation",
      projectId: project.projectId,
    });
    taskId = task.taskId;
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  test("no run AND no transcript -> the HONEST waiting narration, never a false ALL CLEAR (AC3, FR-01.66)", async ({
    page,
  }) => {
    // A seeded task has no JSONL and no run row → the middle is the live narration
    // in its honest EMPTY state ("waiting"), never a fabricated verdict.
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    const card = page.getByTestId("operation-card");
    await expect(card).toBeVisible();

    const narration = page.getByTestId("mission-narration");
    await expect(narration).toBeVisible();
    await expect(narration).toHaveAttribute("data-empty", "true");
    await expect(page.getByTestId("mission-narration")).toContainText(/waiting/i);
    // Never a green ALL CLEAR over an unknown run.
    await expect(card).not.toContainText("ALL CLEAR");
  });

  test("the proof summary is NOT the terminal; the REAL terminal is in Files & Terminal (AC2)", async ({
    page,
  }) => {
    await page.goto(`/tasks/${taskId}`);

    // Files & Terminal is the mount-default (A11): the real embedded terminal is
    // present without any navigation.
    await expect(page.getByTestId("embedded-terminal")).toBeVisible({ timeout: 15_000 });

    // Switch to Mission — the Operation card renders its live JSONL narration, which
    // is NOT a terminal: no embedded terminal, no xterm canvas, no input inside it.
    await page.getByTestId("mission-tab-mission").click();
    const card = page.getByTestId("operation-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("embedded-terminal")).toHaveCount(0);
    await expect(card.locator(".xterm")).toHaveCount(0);
    await expect(card.locator("canvas")).toHaveCount(0);
    await expect(card.locator("textarea")).toHaveCount(0);

    // Back to Files & Terminal — the real terminal is still there and attaches its
    // WS (the two surfaces are genuinely distinct; the restyle moved no byte of it).
    await page.getByTestId("mission-tab-files").click();
    const term = page.getByTestId("embedded-terminal");
    await expect(term).toBeVisible();
    await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 20_000 });

    // With the Files pane active, getByRole("tab", {name:/terminal/i}) resolves to
    // the ONE center Terminal tab — the Operation card added no stray terminal tab.
    await expect(page.getByRole("tab", { name: /terminal/i })).toHaveCount(1);
  });

  test("the Operation card sits BESIDE the left panel in the Mission body", async ({ page }) => {
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    // Both cards of the Mission body are present: the left panel + the Operation card.
    await expect(page.getByTestId("record-rail")).toBeVisible();
    await expect(page.getByTestId("operation-card")).toBeVisible();
    // The live narration is keyboard-reachable (a labelled scroll region, AC7).
    await expect(page.getByTestId("mission-narration")).toHaveAttribute("tabindex", "0");
  });
});
