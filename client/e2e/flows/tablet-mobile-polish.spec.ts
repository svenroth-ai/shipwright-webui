/*
 * Spec — tablet + mobile polish (iterate-2026-10-08-tablet-mobile-layout-polish).
 *
 * Bug report (translated): on a tablet the Kanban board needs a horizontal
 * scroll even with the nav collapsed (it should be three lanes, no scroll); the
 * List view scrolls oddly (header must stay, rows scroll beneath it); on the
 * tablet's Task Detail the Smart Viewer squeezes the terminal (it should be
 * hidden until needed); on phones the "expand terminal" icon is useless, the
 * Description is a pill that does not read as "unfold", the Files tree is too
 * small, and Triage cards spread their meta row across the whole width.
 *
 * WHY E2E: jsdom has no layout engine — only a real browser measures lane
 * widths, scroller ownership and sticky pinning. The soft-keyboard fit
 * (useKeyboardViewportFit) needs a physical on-screen keyboard and is covered at
 * unit level only.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { apiUrl } from "../helpers/env";
import {
  cleanupProject,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";

const TABLET_LANDSCAPE = { width: 1180, height: 820 };
const TABLET_1024 = { width: 1024, height: 768 };
const PHONE = { width: 390, height: 844 };

function triageLine(fields: Record<string, unknown>): string {
  return JSON.stringify({
    ts: "2026-09-12T08:00:00Z",
    originalTs: "2026-09-12T08:00:00Z",
    source: "phaseQuality",
    severity: "high",
    kind: "bug",
    detail: "Detail body",
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: null,
    status: "triage",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
    statusBy: null,
    statusReason: null,
    promotedTaskId: null,
    revisitAt: null,
    revisitDue: false,
    amendedBy: null,
    amendedAt: null,
    event: "append",
    ...fields,
  });
}

async function seedBoard(
  request: Parameters<typeof seedProject>[0],
  count: number,
  extra: { description?: string } = {},
) {
  const project = await seedProject(request, {
    name: `tablet-polish-${Date.now()}`,
    adopted: true,
    // The folder tree lists the PROJECT dir — give it a deterministic markdown row.
    files: { "README.md": "# hi" },
  });
  let last: Awaited<ReturnType<typeof seedTask>> | null = null;
  for (let i = 0; i < count; i++) {
    last = await seedTask(request, {
      title: `Polish task ${i}`,
      projectId: project.projectId,
      files: { "README.md": "# hi", "src/app.ts": "export {}" },
    });
  }
  if (extra.description && last) {
    await request.patch(apiUrl(`/api/external/tasks/${last.taskId}`), {
      data: { description: extra.description },
    });
  }
  return { project, last: last! };
}

test.describe("Tablet / mobile polish", () => {
  let project: SeededProject;

  test.afterEach(async ({ request }) => {
    if (project) await cleanupProject(request, project);
  });

  for (const vp of [TABLET_LANDSCAPE, TABLET_1024]) {
    // @covers FR-01.38
    test(`board shows three lanes without horizontal scroll at ${vp.width}px`, async ({
      browser,
      request,
    }) => {
      const ctx = await browser.newContext({ viewport: vp, hasTouch: true });
      const page = await ctx.newPage();
      ({ project } = await seedBoard(request, 3));
      await setActiveProject(page, project.projectId);
      await page.goto("/");
      const cols = page.getByTestId("task-board-columns");
      await expect(cols).toBeVisible();
      const m = await cols.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(m.sw, "board rail must not scroll sideways").toBeLessThanOrEqual(m.cw + 1);
      const rail = (await cols.boundingBox())!;
      for (const id of ["column-draft", "column-in-progress", "column-done"]) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(rail.x - 1);
        expect(box.x + box.width, `${id} fits inside the rail`).toBeLessThanOrEqual(
          rail.x + rail.width + 1,
        );
      }
      await ctx.close();
    });
  }

  // @covers FR-01.38
  test("list view: one bounded scroller, column header stays pinned while rows scroll", async ({
    browser,
    request,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 600 }, hasTouch: true });
    const page = await ctx.newPage();
    ({ project } = await seedBoard(request, 24));
    await setActiveProject(page, project.projectId);
    await page.goto("/?view=list");
    const scroller = page.getByTestId("task-list-scroller");
    await expect(page.getByTestId("task-list-table")).toBeVisible();

    // Exactly ONE vertical scroll container is overflowing: the list scroller.
    // (The old `overflow-x-auto` card wrapper was a second, nested one.)
    const overflowing = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll("*").forEach((node) => {
        const el = node as HTMLElement;
        const s = getComputedStyle(el);
        if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 2) {
          out.push(el.dataset.testid ?? el.className.toString().slice(0, 40));
        }
      });
      return out;
    });
    expect(overflowing).toEqual(["task-list-scroller"]);

    const head = page.getByTestId("task-board-header");
    const headBefore = (await head.boundingBox())!;
    const th = page.getByTestId("task-list-header-state");
    await scroller.evaluate((el) => el.scrollTo(0, 400));
    const headAfter = (await head.boundingBox())!;
    expect(headAfter.y).toBe(headBefore.y);
    const scrollerTop = (await scroller.boundingBox())!.y;
    const thTop = (await th.boundingBox())!.y;
    expect(Math.abs(thTop - scrollerTop), "table header pinned to the scroller top").toBeLessThanOrEqual(2);
    await ctx.close();
  });

  // @covers FR-01.38
  test("tablet task detail: Smart Viewer hidden until summoned (toggle + opening a file)", async ({
    browser,
    request,
  }) => {
    const ctx = await browser.newContext({ viewport: TABLET_LANDSCAPE, hasTouch: true });
    const page = await ctx.newPage();
    let last;
    ({ project, last } = await seedBoard(request, 1));
    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${last.taskId}`);
    const right = page.getByTestId("pane-right");
    await expect(right).toHaveAttribute("data-collapsed", "true");
    const centerWidth = (await page.getByTestId("pane-center").boundingBox())!.width;

    const toggle = page.getByTestId("viewer-toggle");
    await expect(toggle).toBeVisible();
    expect((await toggle.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(right).not.toHaveAttribute("data-collapsed", "true");
    // The panel resize lands one effect later than the attribute — poll the geometry.
    await expect
      .poll(async () => (await right.boundingBox())!.width, { timeout: 5000 })
      .toBeGreaterThan(250);
    expect((await page.getByTestId("pane-center").boundingBox())!.width).toBeLessThan(centerWidth);
    await toggle.click();
    await expect(right).toHaveAttribute("data-collapsed", "true");
    await expect
      .poll(async () => (await right.boundingBox())!.width, { timeout: 5000 })
      .toBeLessThan(5);

    // Opening a file from the tree summons the viewer by itself.
    await page.getByTestId("folder-tree-row-README.md").click();
    await expect(right).not.toHaveAttribute("data-collapsed", "true");
    await ctx.close();
  });

  // @covers FR-01.38
  test("phone task detail: no maximize icon, description is a plain unfold, tree rows are touch-sized", async ({
    browser,
    request,
  }) => {
    const ctx = await browser.newContext({
      viewport: PHONE,
      hasTouch: true,
      isMobile: true,
    });
    const page = await ctx.newPage();
    let last;
    ({ project, last } = await seedBoard(request, 1, { description: "The brief for this task." }));
    await setActiveProject(page, project.projectId);
    await page.goto(`/tasks/${last.taskId}`);
    await expect(page.getByTestId("task-detail-header")).toBeVisible();

    await expect(page.getByTestId("terminal-maximize")).toHaveCount(0);

    const toggle = page.getByTestId("task-description-toggle");
    await expect(toggle).toBeVisible();
    const style = await toggle.evaluate((el) => {
      const s = getComputedStyle(el);
      return { radius: s.borderTopLeftRadius, border: s.borderTopWidth };
    });
    expect(style.border, "no pill outline").toBe("0px");
    expect(style.radius, "no pill shape").toBe("0px");
    await toggle.click();
    await expect(page.getByTestId("task-description-body")).toContainText("The brief");

    await page.getByTestId("pane-tab-left").click();
    const row = page.getByTestId("folder-tree-row-README.md");
    await expect(row).toBeVisible();
    const box = (await row.boundingBox())!;
    expect(box.height, "tree row meets the 44px touch floor").toBeGreaterThanOrEqual(43.5);
    const fontPx = await row.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontPx).toBeGreaterThanOrEqual(15);
    await ctx.close();
  });

  // @covers FR-01.38
  for (const [label, vp] of [
    ["tablet", TABLET_LANDSCAPE],
    ["phone", PHONE],
  ] as const) {
    test(`triage card keeps its meta row together at ${label} width`, async ({ browser, request }) => {
      const ctx = await browser.newContext({ viewport: vp, hasTouch: true });
      const page = await ctx.newPage();
      project = await seedProject(request, { name: `triage-polish-${Date.now()}` });
      const dir = path.join(project.path, ".shipwright");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, "triage.jsonl"),
        [
          JSON.stringify({ v: 1, schema: "triage", created: "2026-09-12T08:00:00Z" }),
          triageLine({ id: "trg-tp000001", title: "Polish", dedupKey: "tp:1" }),
        ].join("\n") + "\n",
      );
      await setActiveProject(page, project.projectId);
      await page.goto("/triage");
      const card = page.getByTestId("triage-item-trg-tp000001");
      await expect(card).toBeVisible({ timeout: 35_000 });
      const cardBox = (await card.boundingBox())!;
      const ts = (await page.getByTestId("triage-item-trg-tp000001-relative-ts").boundingBox())!;
      if (label === "tablet") {
        // Not flung to the far right edge of a ~900px card.
        expect(ts.x + ts.width).toBeLessThan(cardBox.x + cardBox.width * 0.75);
      }
      expect(ts.x + ts.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
      await ctx.close();
    });
  }
});
