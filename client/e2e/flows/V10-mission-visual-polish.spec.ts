/*
 * V10 — visual polish after the mission-desktop-style-v2 campaign. Real browser + real
 * server; only GET .../session-info is fulfilled (deterministic payload, as in M3).
 *
 *  - Mission and Files & Terminal share ONE column layout: same 16px gutters, same x for
 *    all three columns at desktop width (no jump when switching tabs).
 *  - The Info sidebar tabs sit in the same 46px .ft-head band with the same tab style.
 *  - One row type size: Environment rows = Outputs rows = file-tree rows (13px).
 *  - The Info cards are solid and lifted (shadow), not translucent.
 *  - The Agents pill is a row under Remote Control, in BOTH tabs, and opens the window.
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
  const agent = (agentId: string, state: string, status: string | null) => ({
    agentId, agentType: "sub-iterate-runner", description: `Agent ${agentId}`, toolUseId: null, spawnDepth: 1,
    parentAgentId: null, model: null, prompt: "Do it", answer: null, startedAt: null, endedAt: null,
    durationMs: 1000, state, status, tokens: null, toolUses: null,
  });
  return {
    status: "ok",
    info: {
      sessionUuid: "00000000-0000-4000-8000-000000000000",
      context: { tokens: 1234, model: "claude-opus-4-7-20260101", at: null, compactedSince: false, tokensAfterCompaction: null },
      compaction: { count: 0, last: null },
      outputs: [1, 2, 3].map((i) => ({ path: `${cwd}/out/file${i}.md`, tool: "Write", firstAt: null, lastAt: `2026-01-0${i}T00:00:00Z`, agentId: null })),
      remoteControl: { active: true, onceEnabled: true, pid: 4242 },
      subagents: [agent("r1", "running", null), agent("f1", "finished", "completed")],
      scan: { truncated: false, scannedBytes: 1, sizeBytes: 1, outputsTruncated: 0, subagentsTruncated: 0 },
    },
  };
}

interface Cols { x: number[]; gaps: number[] }
async function columns(page: Page, ids: string[]): Promise<Cols> {
  const boxes: { x: number; width: number }[] = [];
  for (const sel of ids) boxes.push((await page.locator(sel).first().boundingBox())!);
  return {
    x: boxes.map((b) => Math.round(b.x * 10) / 10),
    gaps: boxes.slice(1).map((b, i) => Math.round((b.x - boxes[i].x - boxes[i].width) * 10) / 10),
  };
}

test.describe("V10 — Mission visual polish", () => {
  let project: SeededProject;
  let taskId: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Polish", dirName: "sw-v10-polish", files: { "README.md": "# hi\n", "out/file1.md": "x", "out/file2.md": "x", "out/file3.md": "x" } });
    taskId = (await seedTask(request, { title: "V10", projectId: project.projectId })).taskId;
    await setActiveProject(page, project.projectId);
    await page.route("**/api/external/tasks/*/session-info", (route) => route.fulfill({ json: payload(project.path) }));
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  // @covers FR-01.66
  test("both tabs share the same 16px gutters and column start positions; the Info tabs are identical", async ({ page }) => {
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-files").click();
    await expect(page.getByTestId("pane-left")).toBeVisible();
    await expect(page.getByTestId("ft-side-body-info")).toBeVisible();
    const ft = await columns(page, ['[data-testid="task-detail-files"]', '[data-testid="pane-center"]', '[data-testid="task-detail-viewer"]']);
    const ftHead = await page.getByTestId("task-detail-viewer-head").boundingBox();
    const ftTabs = await page.getByTestId("task-detail-viewer-head").locator(".mc-tabs").evaluate((el) => {
      const s = getComputedStyle(el); const b = el.firstElementChild!; const bs = getComputedStyle(b);
      return { bg: s.backgroundColor, pad: s.padding, gap: s.gap, tabPad: bs.padding, tabFs: bs.fontSize, h: b.getBoundingClientRect().height };
    });

    await page.getByTestId("mission-tab-mission").click();
    await expect(page.getByTestId("mission-side")).toBeVisible();
    const ms = await columns(page, [".mc-body .record", ".mc-body .mc-op", '[data-testid="mission-side"]']);
    const msHead = await page.getByTestId("mission-side-head").boundingBox();
    const msTabs = await page.getByTestId("mission-side-head").locator(".mc-tabs").evaluate((el) => {
      const s = getComputedStyle(el); const b = el.firstElementChild!; const bs = getComputedStyle(b);
      return { bg: s.backgroundColor, pad: s.padding, gap: s.gap, tabPad: bs.padding, tabFs: bs.fontSize, h: b.getBoundingClientRect().height };
    });

    // Gutters: 16px in both tabs; every column starts at the same x (+-1px).
    for (const g of [...ft.gaps, ...ms.gaps]) expect(Math.abs(g - 16)).toBeLessThanOrEqual(1);
    ms.x.forEach((x, i) => expect(Math.abs(x - ft.x[i]), `column ${i} x: mission ${x} vs files ${ft.x[i]}`).toBeLessThanOrEqual(1));

    // Info tabs: same 46px band, same tab look.
    expect(Math.round(msHead!.height)).toBe(46);
    expect(Math.round(ftHead!.height)).toBe(46);
    expect(msTabs).toEqual(ftTabs);
  });

  // @covers FR-01.66
  test("one row type size: Environment = Outputs = file tree; cards are solid + lifted", async ({ page }) => {
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    const fs = (id: string) => page.getByTestId("mission-side").getByTestId(id).first().evaluate((el) => getComputedStyle(el).fontSize);
    await expect(page.getByTestId("mission-side").getByTestId("env-output").first()).toBeVisible();
    const env = await page.getByTestId("mission-side").getByTestId("env-folder").locator(".env-k").evaluate((el) => getComputedStyle(el).fontSize);
    expect(env).toBe("13px");
    expect(await fs("env-output")).toBe(env);
    const outH = (await page.getByTestId("mission-side").getByTestId("env-output").first().boundingBox())!.height;
    expect(outH).toBeLessThanOrEqual(32); // fine pointer: 30px rows (44px only on coarse)

    const card = await page.getByTestId("mission-side").getByTestId("env-environment").evaluate((el) => {
      const s = getComputedStyle(el);
      return { shadow: s.boxShadow, bg: s.backgroundColor, border: s.borderTopWidth };
    });
    expect(card.shadow).not.toBe("none");
    expect(card.bg).toMatch(/^rgb\(/); // opaque, not rgba(...)
    expect(card.border).toBe("1px");

    await page.getByTestId("mission-side-seg-folders").click();
    const row = page.getByTestId("mission-side").getByTestId("folder-tree-row-README.md");
    await expect(row).toBeVisible();
    expect(await row.evaluate((el) => getComputedStyle(el).fontSize)).toBe(env);
  });

  // @covers FR-01.66
  test("the Agents pill is the row under Remote Control in BOTH tabs, opens the window, and the chat has no second copy", async ({ page }) => {
    await page.goto(`/tasks/${taskId}`);
    const check = async (side: string) => {
      const pill = page.getByTestId(side).getByTestId("agents-bar-button");
      await expect(pill).toContainText("1 agent running", { timeout: 20_000 });
      const order = await page.getByTestId(side).getByTestId("env-environment").evaluate((el) =>
        [...el.querySelectorAll(".env-row")].map((r) => r.getAttribute("data-testid")));
      expect(order).toEqual(["env-computer", "env-folder", "env-remote-control", "agents-bar"]);
      await pill.click();
      await expect(page.getByTestId("agents-window")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("agents-window")).toBeHidden();
    };
    await page.getByTestId("mission-tab-files").click();
    await check("ft-side");
    await page.getByTestId("mission-tab-mission").click();
    await check("mission-side");
    await expect(page.getByTestId("mission-activity-feed").locator("[data-testid='agents-bar'], .mc-agents-chip")).toHaveCount(0);
  });
});
