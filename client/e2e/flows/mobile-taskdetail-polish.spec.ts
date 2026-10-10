/*
 * Spec — mobile-taskdetail-polish (iterate-2026-10-10-mobile-taskdetail-favicon).
 *
 * Real-browser proof (jsdom has no layout engine) of the phone Task Detail
 * polish: description beside the status pill, the header-hosted expand toggle,
 * the keyboard-fit anchoring of dialogs / scene padding, and the iOS
 * home-screen icon set. Runs under `mobile-chromium` (Pixel 5: hasTouch +
 * isMobile, so `(pointer: coarse)` and the phone breakpoints resolve true).
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  cleanupProject,
  cleanupTaskCwd,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededTask,
} from "../helpers/fixtures";

let task: SeededTask;
const NL = String.fromCharCode(10);

test.beforeEach(async ({ request }) => {
  task = await seedTask(request, { title: `polish-${Date.now()}` });
  const res = await request.patch(`/api/external/tasks/${task.taskId}`, {
    data: { description: "Brief for the polish spec" },
  });
  expect(res.ok()).toBeTruthy();
});
test.afterEach(async ({ request }) => {
  await cleanupTaskCwd(request, task);
});

// @covers FR-01.38
test("description toggle sits on the SAME row as the status pill", async ({ page }) => {
  await page.goto(`/tasks/${task.taskId}`);
  const row = page.getByTestId("task-detail-mobile-status-row");
  await expect(row).toBeVisible({ timeout: 35_000 });
  const toggle = page.getByTestId("task-description-toggle");
  const t = await toggle.boundingBox();
  const r = await row.boundingBox();
  expect(t && r).toBeTruthy();
  // One line: the toggle is inside the row box and the row is a single line tall.
  expect(t!.y).toBeGreaterThanOrEqual(r!.y - 1);
  expect(t!.y + t!.height).toBeLessThanOrEqual(r!.y + r!.height + 1);
  expect(r!.height).toBeLessThan(60);
  await toggle.click();
  await expect(page.getByTestId("task-description-body")).toBeVisible();
});

// @covers FR-01.38
test("expand toggle lives in the header (not over the terminal) and folds the page chrome", async ({ page }) => {
  await page.goto(`/tasks/${task.taskId}`);
  const btn = page.getByTestId("task-detail-expand-terminal");
  await expect(btn).toBeVisible({ timeout: 35_000 });
  const header = await page.getByTestId("task-detail-header").boundingBox();
  const b = await btn.boundingBox();
  expect(b!.y + b!.height).toBeLessThanOrEqual(header!.y + header!.height + 1);
  await page.getByTestId("mission-tab-files").click().catch(() => {});
  await expect(page.getByTestId("pane-tab-bar")).toBeVisible();
  await btn.click();
  await expect(page.getByTestId("pane-tab-bar")).toBeHidden();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await btn.click();
  await expect(page.getByTestId("pane-tab-bar")).toBeVisible();
});

// @covers FR-01.38
test("keyboard-up: New Task dialog hugs the visible viewport bottom, scene padding is dropped", async ({ page, request }) => {
  const project = await seedProject(request, { name: `polish-kbd-${Date.now()}` });
  await page.goto("/");
  await expect(page.getByTestId("task-board-page")).toBeVisible({ timeout: 35_000 });
  await page.getByTestId("create-menu-cascade-trigger").click();
  await page.getByTestId(`create-menu-cascade-project-${project.projectId}`).press("Enter");
  await page.getByTestId(`create-menu-cascade-action-${project.projectId}-new-task`).press("Enter");
  const dlg = page.getByTestId("new-issue-modal-new-task");
  await expect(dlg).toBeVisible();
  await expect(dlg).toHaveClass(/kbd-dialog/);
  // innerHeight, not viewportSize(): the mobile emulation's layout viewport differs.
  const vh = await page.evaluate(() => innerHeight);
  // Simulate the hook's output for a 300px keyboard. Re-applied inside the poll:
  // the real hook recomputes on every focusin (Radix focuses the dialog async),
  // and with no real keyboard it would clear the flag again.
  await expect
    .poll(async () => {
      await page.evaluate(() => {
        const r = document.documentElement;
        r.style.setProperty("--app-vh", `${innerHeight - 300}px`);
        r.style.setProperty("--app-top", "0px");
        r.style.setProperty("--app-bottom", "300px");
        r.setAttribute("data-kbd-open", "");
      });
      const box = await dlg.boundingBox();
      return vh - 300 - (box!.y + box!.height);
    })
    .toBeLessThanOrEqual(10);
  const pad = await page.evaluate(
    () => getComputedStyle(document.querySelector(".scene-fore")!).paddingBottom,
  );
  expect(pad).toBe("0px");
  await cleanupProject(request, project);
});

// @covers FR-01.38
test("home-screen icon set is served (iOS apple-touch-icon + manifest)", async ({ request, page }) => {
  for (const [url, type] of [
    ["/apple-touch-icon.png", "image/png"],
    ["/manifest.json", ""],
  ] as const) {
    const res = await request.get(url);
    expect(res.status(), url).toBe(200);
    if (type) expect(res.headers()["content-type"], url).toContain(type);
  }
  await page.goto("/");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/apple-touch-icon.png",
  );
});

// @covers FR-01.38
test("triage list is tight: cards sit 4px apart and 3 fit on a phone screen", async ({ page, request }) => {
  const project = await seedProject(request, { name: `polish-triage-${Date.now()}` });
  try {
    await setActiveProject(page, project.projectId);
    const dir = path.join(project.path, ".shipwright");
    mkdirSync(dir, { recursive: true });
    const row = (i: number) =>
      JSON.stringify({
        event: "append", id: `trg-pol0000${i}`, ts: "2026-09-12T08:00:00Z", originalTs: "2026-09-12T08:00:00Z",
        source: "phaseQuality", severity: "high", kind: "bug", title: `Polish item ${i}`,
        detail: "Detail body text that wraps onto a second line for the card preview here",
        evidencePath: null, runId: null, commit: null, dedupKey: `e2e:pol:${i}`, status: "triage",
        suggestedPriority: "P1", suggestedDomain: "engineering", statusBy: null, statusReason: null,
        promotedTaskId: null, revisitAt: null, revisitDue: false, amendedBy: null, amendedAt: null,
      });
    writeFileSync(
      path.join(dir, "triage.jsonl"),
      [JSON.stringify({ v: 1, schema: "triage", created: "2026-09-12T08:00:00Z" }), ...[1, 2, 3, 4].map(row)].join(NL) + NL,
    );
    await page.goto("/triage");
    const cards = [1, 2, 3, 4].map((i) => page.getByTestId(`triage-item-trg-pol0000${i}`));
    await expect(cards[0]).toBeVisible({ timeout: 35_000 });
    const boxes = [];
    for (const c of cards) boxes.push((await c.boundingBox())!);
    for (let i = 1; i < boxes.length; i++) {
      const gap = boxes[i].y - (boxes[i - 1].y + boxes[i - 1].height);
      expect(gap, `gap before card ${i + 1}`).toBeGreaterThanOrEqual(0);
      expect(gap, `gap before card ${i + 1}`).toBeLessThanOrEqual(6);
    }
    const vh = await page.evaluate(() => innerHeight);
    expect(boxes[2].y + boxes[2].height, "3 cards fit in the first screen").toBeLessThanOrEqual(vh);
  } finally {
    await cleanupProject(request, project);
  }
});
