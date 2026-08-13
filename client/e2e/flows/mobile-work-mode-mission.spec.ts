import { expect, test } from "@playwright/test";
import { cleanupTaskCwd, seedTask, type SeededTask } from "../helpers/fixtures";

// Split out of mobile-work-mode.spec.ts (iterate-2026-08-13-mission-mobile-visual,
// bloat gate — the terminal work-mode scenario and this Mission-tabs scenario are
// independent concerns that happened to share a file).
test.describe("Mobile work mode — Mission tabs", () => {
  let task: SeededTask | undefined;
  test.afterEach(async ({ request }) => {
    await cleanupTaskCwd(request, task);
    task = undefined;
  });

  test("Mission uses Overview, Activity and contextual Detail", async ({
    page,
    request,
  }, testInfo) => {
    task = await seedTask(request, { title: "Inspect the mobile mission" });
    await page.goto(`/tasks/${task.taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    const tabs = page.getByTestId("mission-compact-tabs").getByRole("tab");
    await expect(tabs).toHaveText(["Overview", "Activity", "Detail"]);
    await expect(page.getByTestId("mission-compact-tab-detail")).toBeDisabled();
    await expect(page.getByTestId("mission-panel-overview")).toBeVisible();
    await expect(page.getByTestId("mission-panel-activity")).toBeHidden();

    await page.getByTestId("record-node-req").click();
    await expect(page.getByTestId("mission-compact-tab-detail")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("artifact-panel")).toBeVisible();
    for (const action of ["artifact-close", "artifact-open-document"]) {
      const box = await page.getByTestId(action).boundingBox();
      expect(box?.height, `${action} needs a compact touch target`).toBeGreaterThanOrEqual(44);
      expect(box?.width, `${action} needs a compact touch target`).toBeGreaterThanOrEqual(44);
    }
    await page.waitForTimeout(200);
    await page.screenshot({
      path: testInfo.outputPath("mobile-mission-detail.png"),
      fullPage: false,
    });

    await page.getByTestId("artifact-close").click();
    await expect(page.getByTestId("mission-compact-tab-overview")).toBeFocused();
    await expect(page.getByTestId("mission-compact-tab-detail")).toBeDisabled();

    await page.setViewportSize({ width: 820, height: 900 });
    const shiplog = page.getByTestId("mission-open-ships-log");
    await expect(shiplog).toHaveRole("link");
    await expect(shiplog).toHaveAttribute("href", "/projects");
    await expect(shiplog).not.toHaveAttribute("role", "tab");
    await expect(shiplog).toHaveText("Shiplog");
    const shiplogBox = await shiplog.boundingBox();
    expect(shiplogBox?.height).toBeGreaterThanOrEqual(44);
  });
});
