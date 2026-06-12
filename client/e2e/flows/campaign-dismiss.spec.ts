import { test, expect } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * FR-01.33 — manual Campaigns-board dismiss / restore, F0.5 web E2E
 * (iterate-2026-06-12-campaign-dismiss).
 *
 * Self-seeding (Node fs + the API), so it runs against any live stack: it seeds
 * a temp fixture project whose ONLY campaign is a `derivedFromEvents` GHOST —
 * two `work_completed` events in a tracked `shipwright_events.jsonl` and NO
 * campaign planning dir (the exact 2026-06-07-tracked-campaign-status case that
 * can never auto-hide). Then it drives the real browser flow:
 *   board (scoped via ?projectId) → ghost card visible → click "Erledigt"
 *   → card LEAVES the active lane → "N erledigt · anzeigen" toggle →
 *   dismissed card shown → click "Wiederherstellen" → card RETURNS to the lane.
 *
 * The leave/return asymmetry is the load-bearing assertion: the card can only
 * move if the POST dismiss/restore actually wrote the webui-owned state and the
 * board re-read the `dismissed` annotation.
 */

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const SLUG = `2026-06-12-e2e-ghost-${RUN}`;

test.describe("Campaigns board dismiss / restore (FR-01.33)", () => {
  test("dismiss a ghost campaign → it leaves the lane → restore → it returns", async ({
    page,
    request,
  }) => {
    // 1. Seed a fixture project: events.jsonl ghost, NO campaign dir.
    const projectDir = mkdtempSync(path.join(tmpdir(), "sw-campaign-dismiss-"));
    writeFileSync(
      path.join(projectDir, "shipwright_events.jsonl"),
      [
        { type: "work_completed", campaign: SLUG, sub_iterate_id: "S1", commit: "" },
        { type: "work_completed", campaign: SLUG, sub_iterate_id: "S2", commit: "" },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n") + "\n",
      "utf-8",
    );

    // 2. Register the project (server generates the id we scope the board by).
    const reg = await request.post("/api/projects", {
      data: { name: `E2E Dismiss ${RUN}`, path: projectDir, profile: "vite-hono" },
    });
    expect(reg.ok()).toBeTruthy();
    const regBody = (await reg.json()) as { data?: { id?: string }; id?: string };
    const projectId = regBody.data?.id ?? regBody.id;
    expect(projectId, "registration returns a project id").toBeTruthy();

    // 3. Board scoped to the fixture project (URL projectId wins, useProjectFilter).
    await page.goto(`/?projectId=${encodeURIComponent(projectId as string)}`);
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    const card = page.getByTestId(`campaign-lane-card-${SLUG}`);
    await expect(card).toBeVisible({ timeout: 15000 });
    // It's the ghost (events provenance) and not yet dismissed.
    await expect(page.getByTestId(`campaign-events-badge-${SLUG}`)).toBeVisible();
    const control = page.getByTestId(`campaign-dismiss-${SLUG}`);
    await expect(control).not.toHaveAttribute("data-dismissed", "true");

    // 4. Dismiss → the card leaves the active lane.
    await control.click();
    await expect(card).toBeHidden({ timeout: 15000 });
    const toggle = page.getByTestId("campaigns-show-dismissed-toggle");
    await expect(toggle).toContainText("1 erledigt", { timeout: 15000 });

    // 5. Reveal the dismissed list → the ghost is there with a restore control.
    await toggle.click();
    const dismissedCard = page.getByTestId(`campaign-lane-card-${SLUG}`);
    await expect(dismissedCard).toBeVisible();
    const restore = page.getByTestId(`campaign-dismiss-${SLUG}`);
    await expect(restore).toHaveAttribute("data-dismissed", "true");

    // 6. Restore → the card returns to the active lane (no longer dismissed).
    await restore.click();
    await expect(page.getByTestId(`campaign-dismiss-${SLUG}`)).not.toHaveAttribute(
      "data-dismissed",
      "true",
      { timeout: 15000 },
    );
    await expect(page.getByTestId(`campaign-lane-card-${SLUG}`)).toBeVisible();
  });
});
