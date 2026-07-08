/*
 * Flow — Board + List default sort = Last Modified (descending).
 * iterate-2026-07-08-board-sort-last-modified.
 *
 * Seeds three draft tasks with a deliberate ≥1 s gap so their `createdAt`
 * (the last-modified source for a never-launched draft) is strictly ordered
 * old → new. Then asserts, against a running stack:
 *   - AC-1: the Backlog column lists them newest-first (t3, t2, t1).
 *   - Board ↔ List: toggling to the List view keeps the SAME order.
 *   - AC-5: the order is identical at Desktop / Tablet / Phone widths (the
 *     sort lives in the data layer, before any responsive breakpoint).
 *
 * Targets the live/isolated stack via BASE_URL (F0.5). Cleans up after itself.
 */
import { test, expect, type Page } from "@playwright/test";

const API = process.env.BASE_URL || "http://127.0.0.1:5173";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "phone", width: 390, height: 844 },
] as const;

async function createDraft(
  page: Page,
  title: string,
): Promise<string> {
  const res = await page.request.post(`${API}/api/external/tasks`, {
    data: { title, cwd: "/tmp/board-sort-e2e" },
  });
  expect(res.ok(), `create ${title}: ${res.status()}`).toBeTruthy();
  const { task } = (await res.json()) as { task: { taskId: string } };
  return task.taskId;
}

/** Ordered task ids found under `root`, filtered to `mine` (ignoring any
 *  pre-existing cards), preserving DOM order. */
async function orderedIds(
  page: Page,
  columnTestId: string,
  cardPrefix: string,
  mine: string[],
): Promise<string[]> {
  const all = await page
    .getByTestId(columnTestId)
    .locator(`[data-testid^="${cardPrefix}"]`)
    .evaluateAll((els, prefix) =>
      els.map((el) => el.getAttribute("data-testid")!.slice(prefix.length)),
      cardPrefix,
    );
  return all.filter((id) => mine.includes(id));
}

test.describe("Board + List default sort = Last Modified desc", () => {
  test("newest-first in Backlog, same in List, stable across all devices", async ({
    page,
  }) => {
    // Seed oldest → newest with a >1 s gap so createdAt is strictly ordered.
    const t1 = await createDraft(page, `sort-e2e-oldest-${Date.now()}`);
    await page.waitForTimeout(1100);
    const t2 = await createDraft(page, `sort-e2e-middle-${Date.now()}`);
    await page.waitForTimeout(1100);
    const t3 = await createDraft(page, `sort-e2e-newest-${Date.now()}`);
    const mine = [t1, t2, t3];
    const expectedDesc = [t3, t2, t1]; // newest first

    try {
      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible();
      await expect(page.getByTestId(`task-card-${t3}`)).toBeVisible({
        timeout: 8_000,
      });

      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.reload();
        await expect(page.getByTestId("task-board-page")).toBeVisible();

        // --- Board view (AC-1 + AC-5) ---
        await expect(page.getByTestId(`task-card-${t3}`)).toBeVisible({
          timeout: 8_000,
        });
        const boardOrder = await orderedIds(
          page,
          "column-draft",
          "task-card-draggable-",
          mine,
        );
        expect(boardOrder, `board order @${vp.name}`).toEqual(expectedDesc);

        // --- List view (same order, AC-5) ---
        await page.getByTestId("view-toggle-list").click();
        await expect(page.getByTestId("task-list-view")).toBeVisible();
        await expect(page.getByTestId(`task-list-row-${t3}`)).toBeVisible({
          timeout: 8_000,
        });
        const listOrder = await orderedIds(
          page,
          "task-list-view",
          "task-list-row-",
          mine,
        );
        expect(listOrder, `list order @${vp.name}`).toEqual(expectedDesc);

        // AC-2 (once, on desktop): clicking the "Updated" header toggles to
        // ascending (oldest-first), then back to the newest-first default.
        if (vp.name === "desktop") {
          const updatedBtn = page
            .getByTestId("task-list-header-updated")
            .locator("button");
          await updatedBtn.click();
          const listAsc = await orderedIds(
            page,
            "task-list-view",
            "task-list-row-",
            mine,
          );
          expect(listAsc, "list ascending after Updated toggle").toEqual([
            t1,
            t2,
            t3,
          ]);
          await updatedBtn.click(); // restore newest-first default
        }

        // Back to board for the next viewport iteration.
        await page.getByTestId("view-toggle-board").click();
        await expect(page.getByTestId("task-board-columns")).toBeVisible();
      }
    } finally {
      for (const id of mine) {
        await page.request
          .delete(`${API}/api/external/tasks/${encodeURIComponent(id)}`)
          .catch(() => {});
      }
    }
  });
});
