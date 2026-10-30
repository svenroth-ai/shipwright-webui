/*
 * M3 — Mission right info sidebar (campaign mission-desktop-style).
 *
 * Real browser + real server for everything except GET .../session-info, which
 * is fulfilled with a deterministic payload (the real endpoint reads Claude's
 * own JSONL under the operator's home, which an isolated stack must not touch).
 * Proves what jsdom cannot: real layout (no horizontal clip with the sidebar
 * beside the artifact card), the splitter really resizes and the width survives
 * a reload, the poll cadence is NOT 1 s, and spec-35 hygiene (no chat-*, no
 * textarea).
 * @covers FR-01.66
 */

import { test, expect, type Page } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";

function payload(cwd: string) {
  return {
    status: "ok",
    info: {
      sessionUuid: "00000000-0000-4000-8000-000000000000",
      context: { tokens: 123456, model: "claude-opus-4-7-20260101", at: null, compactedSince: false, tokensAfterCompaction: null },
      compaction: { count: 0, last: null },
      outputs: Array.from({ length: 7 }, (_, i) => ({
        path: `${cwd}/out/file${i}.md`, tool: "Write", firstAt: null, lastAt: `2026-01-0${i + 1}T00:00:00Z`, agentId: null,
      })),
      remoteControl: { active: true, onceEnabled: true, pid: 4242 },
      subagents: [],
      scan: { truncated: false, scannedBytes: 1, sizeBytes: 1, outputsTruncated: 0, subagentsTruncated: 0 },
    },
  };
}

async function mockSessionInfo(page: Page, cwd: string): Promise<{ hits: number[] }> {
  const rec = { hits: [] as number[] };
  await page.route("**/api/external/tasks/*/session-info", async (route) => {
    rec.hits.push(Date.now());
    await route.fulfill({ json: payload(cwd) });
  });
  return rec;
}

test.describe("M3 — Mission right info sidebar", () => {
  let project: SeededProject;
  let taskId: string;
  let cwd: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Side", dirName: "sw-m3-side" });
    const task = await seedTask(request, { title: "Sidebar", projectId: project.projectId });
    taskId = task.taskId;
    cwd = project.path;
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  // @covers FR-01.66
  test("shows Environment / Context / Outputs, no percentage, Show more works", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const rec = await mockSessionInfo(page, cwd);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    await expect(page.getByTestId("mission-side")).toBeVisible();
    await expect(page.getByTestId("env-computer")).toContainText("This computer");
    await expect(page.getByTestId("env-folder")).toBeVisible();
    await expect(page.getByTestId("env-tokens")).toContainText("123k");
    await expect(page.getByTestId("env-model")).toContainText("claude-opus-4-7");
    await expect(page.getByTestId("env-context")).not.toContainText("%");
    await expect(page.getByTestId("env-remote-pill")).toHaveText("On");
    await expect(page.getByTestId("env-output")).toHaveCount(5);
    await page.getByTestId("env-outputs-more").click();
    await expect(page.getByTestId("env-output")).toHaveCount(7);

    // NO timer (operator decision): idle time produces no further requests;
    // only the manual Refresh button does.
    const before = rec.hits.length;
    await page.waitForTimeout(3500);
    expect(rec.hits.length).toBe(before);
    await page.getByTestId("env-refresh").click();
    await expect.poll(() => rec.hits.length).toBe(before + 1);

    // spec 35 hygiene.
    await expect(page.locator("[data-testid^='chat-']")).toHaveCount(0);
    await expect(page.getByTestId("mission-body").locator("textarea")).toHaveCount(0);
  });

  // @covers FR-01.66
  test("no horizontal clip with the sidebar; Folders segment reuses the tree; layout survives reload", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockSessionInfo(page, cwd);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await expect(page.getByTestId("mission-side")).toBeVisible();

    const doc = await page.evaluate(() => ({
      s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth,
    }));
    expect(doc.s).toBeLessThanOrEqual(doc.c + 1);
    // The row itself must not clip either (it can hide overflow without widening the page).
    const row = await page.getByTestId("mission-body").evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth }));
    expect(row.s).toBeLessThanOrEqual(row.c + 1);
    const bodyBox = (await page.getByTestId("mission-body").boundingBox())!;
    const sideBox = (await page.getByTestId("mission-side").boundingBox())!;
    expect(sideBox.x + sideBox.width).toBeLessThanOrEqual(bodyBox.x + bodyBox.width + 1);
    expect((await page.getByTestId("operation-card").boundingBox())!.width).toBeGreaterThanOrEqual(360);

    // Keyboard resize (+10px per ArrowLeft) is persisted across a reload.
    const w0 = (await page.getByTestId("mission-side").boundingBox())!.width;
    const sep = page.getByTestId("mission-side-splitter");
    await sep.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => (await page.getByTestId("mission-side").boundingBox())!.width).toBeGreaterThan(w0 + 25);

    await page.getByTestId("mission-side-seg-folders").click();
    await expect(page.getByTestId("mission-side-body-folders")).toBeVisible();

    await page.reload();
    await page.getByTestId("mission-tab-mission").click();
    await expect(page.getByTestId("mission-side-body-folders")).toBeVisible();
    const w1 = (await page.getByTestId("mission-side").boundingBox())!.width;
    expect(Math.abs(w1 - (w0 + 30))).toBeLessThanOrEqual(2);

    // Collapse is remembered too.
    await page.getByTestId("mission-side-collapse").click();
    await expect(page.getByTestId("mission-side")).toHaveCount(0);
    await expect(page.getByTestId("mission-side-expand")).toBeVisible();
  });

  // @covers FR-01.66
  test("an open artifact card takes the row below 1700px; both fit at 1920px", async ({ page }) => {
    await mockSessionInfo(page, cwd);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await expect(page.getByTestId("mission-side")).toBeVisible();
    await page.getByTestId("record-node-req").click();
    await expect(page.getByTestId("artifact-panel")).toBeVisible();
    await expect(page.getByTestId("mission-side")).toBeHidden();
    // Closing the artifact restores the sidebar at the user's persisted width.
    await page.getByTestId("record-node-req").click();
    await expect(page.getByTestId("mission-side")).toBeVisible();
    expect((await page.getByTestId("mission-side").boundingBox())!.width).toBeGreaterThan(230);
    await page.getByTestId("record-node-req").click();
    await expect(page.getByTestId("mission-side")).toBeHidden();
    await page.setViewportSize({ width: 1920, height: 1000 });
    await expect(page.getByTestId("mission-side")).toBeVisible();
    const doc = await page.evaluate(() => ({
      s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth,
    }));
    expect(doc.s).toBeLessThanOrEqual(doc.c + 1);
    const op = await page.getByTestId("operation-card").boundingBox();
    expect(op!.width).toBeGreaterThanOrEqual(360);
  });

  // @covers FR-01.66
  test("legible text (not white on glass) and no clip at 1024/1280 with the widest sidebar", async ({ page }) => {
    await mockSessionInfo(page, cwd);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await expect(page.getByTestId("mission-side")).toBeVisible();
    // Dark ink on the light glass card: every channel of the colour well below white.
    const rgb = await page.getByTestId("env-tokens").evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = rgb.match(/\d+/g)!.slice(0, 3).map(Number);
    expect(Math.max(r, g, b)).toBeLessThan(120);
    await page.getByTestId("mission-side-splitter").focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("End");
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      const doc = await page.evaluate(() => ({
        s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth,
      }));
      expect(doc.s, `no horizontal clip at ${width}`).toBeLessThanOrEqual(doc.c + 1);
    }
  });

  // @covers FR-01.66
  test("phone: the Info tab shows the sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await mockSessionInfo(page, cwd);
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await page.getByTestId("mission-compact-tab-info").click();
    await expect(page.getByTestId("mission-side")).toBeVisible();
    await expect(page.getByTestId("env-tokens")).toContainText("123k");
    await expect(page.getByTestId("mission-side-splitter")).toHaveCount(0);
    const doc = await page.evaluate(() => ({
      s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth,
    }));
    expect(doc.s).toBeLessThanOrEqual(doc.c + 1);
  });
});
