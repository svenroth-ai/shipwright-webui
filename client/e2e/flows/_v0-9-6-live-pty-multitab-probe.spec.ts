/*
 * Iterate E (ADR-092) — Confidence Calibration probe: multi-tab race.
 *
 * Underscore prefix marks this as a probe/diagnostic, not a regression
 * fence (the regression fence is `v0-9-6-live-pty-replay.spec.ts`).
 *
 * Question: with two tabs on the SAME task, type in tab A, close tab
 * A. Tab B must see the live mirror state. Then close tab B and open
 * via the TaskBoard. The disk snapshot from snapshot-on-detach must
 * show the same state.
 *
 * Artifact: `client/playwright-report/v0.9.6-live-pty-multitab/`.
 */

import { cleanupProject, seedLocalStorage, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

// A00 — was a pinned operator UUID; seeded via the real API in beforeEach.
let project: SeededProject;


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACT_DIR = path.resolve(
  __dirname,
  "../../playwright-report/v0.9.6-live-pty-multitab",
);

async function makeTaskCwd(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "v096-multitab-"));
}

async function deleteTask(request: APIRequestContext, taskId: string): Promise<void> {
  try {
    await request.delete(`/api/external/tasks/${encodeURIComponent(taskId)}`);
  } catch { /* ignore */ }
}

async function setProjectStorage(page: Page): Promise<void> {
  await seedLocalStorage(page, { "shipwright:terminal-renderer": "dom", "webui:embedded-terminal-default-tab": '"terminal"', });
}

test.describe("Iterate E (ADR-092) probe — multi-tab + server-restart", () => {
  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "_v0-9-6-live-pty-multitab-probe" });
    await setActiveProject(page, project.projectId);
  });
  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test.setTimeout(120_000);

  test("multi-tab: state preserved when one tab closes", async ({ browser, request }) => {
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
    const cwd = await makeTaskCwd();
    let taskId: string | undefined;

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      await setProjectStorage(pageA);
      await setProjectStorage(pageB);

      // Create + launch.
      const created = await request.post("/api/external/tasks", {
        data: {
          title: "ADR-092 multitab probe",
          cwd,
          actionId: "new-task",
          projectId: project.projectId,
        },
      });
      expect(created.ok()).toBeTruthy();
      const cBody = (await created.json()) as { task: { taskId: string } };
      taskId = cBody.task.taskId;

      await request.post(
        `/api/external/tasks/${encodeURIComponent(taskId)}/launch`,
        { data: { actionId: "new-task" } },
      );

      // Open tab A; type MARKER; wait for it to render.
      await pageA.goto(`/tasks/${taskId}`);
      await expect(pageA.getByTestId("embedded-terminal")).toHaveAttribute(
        "data-ws-ready",
        "true",
        { timeout: 15_000 },
      );
      await pageA.waitForTimeout(3_000);
      const MARKER = `MULTITAB_${Date.now()}`;
      await pageA.locator('[data-testid="embedded-terminal-canvas"]').click()
        .catch(async () => { await pageA.locator(".xterm").first().click(); });
      await pageA.keyboard.type(`echo ${MARKER}`, { delay: 30 });
      await pageA.keyboard.press("Enter");
      await pageA.waitForTimeout(1_500);

      // Open tab B (independent context — distinct WS).
      await pageB.goto(`/tasks/${taskId}`);
      await expect(pageB.getByTestId("embedded-terminal")).toHaveAttribute(
        "data-ws-ready",
        "true",
        { timeout: 15_000 },
      );
      await pageB.waitForTimeout(4_000);

      const rowsBOnAttach = await pageB.locator(".xterm-rows > div").allTextContents();
      const tabBSeesMarker = rowsBOnAttach.join("\n").includes(MARKER);

      // Close tab A (its WS detaches; since tab B still attached, no
      // flush-on-detach fires).
      await pageA.close();
      await pageB.waitForTimeout(2_000);

      // Tab B's state should be unchanged (no kill).
      const rowsBStill = await pageB.locator(".xterm-rows > div").allTextContents();
      const tabBStillSeesMarker = rowsBStill.join("\n").includes(MARKER);

      // Close tab B too — this is the LAST detach. Snapshot-on-detach
      // writes to disk. Open a fresh tab C — it must see MARKER.
      await pageB.close();

      const ctxC = await browser.newContext();
      const pageC = await ctxC.newPage();
      await setProjectStorage(pageC);
      try {
        // Give the fire-and-forget flushMirrorSnapshot a moment.
        await new Promise((r) => setTimeout(r, 1_500));
        await pageC.goto(`/tasks/${taskId}`);
        await expect(pageC.getByTestId("embedded-terminal")).toHaveAttribute(
          "data-ws-ready",
          "true",
          { timeout: 15_000 },
        );
        await pageC.waitForTimeout(4_000);
        const rowsC = await pageC.locator(".xterm-rows > div").allTextContents();
        const tabCSeesMarker = rowsC.join("\n").includes(MARKER);

        await fs.writeFile(
          path.join(ARTIFACT_DIR, "multitab-result.json"),
          JSON.stringify({
            marker: MARKER,
            tabBSeesMarkerOnAttach: tabBSeesMarker,
            tabBStillSeesMarkerAfterTabAClose: tabBStillSeesMarker,
            tabCSeesMarkerAfterBothClosedAndReopen: tabCSeesMarker,
          }, null, 2),
          "utf8",
        );

        // Both expectations are hard — the contract is "ADR-092
        // preserves state through multi-tab close + reopen cycles".
        expect(tabBSeesMarker, "tab B should see MARKER via serialize-on-attach").toBeTruthy();
        expect(tabBStillSeesMarker, "tab B should retain MARKER after tab A closes").toBeTruthy();
        expect(tabCSeesMarker, "tab C should see MARKER via disk snapshot from flush-on-last-detach").toBeTruthy();
      } finally {
        await pageC.close();
        await ctxC.close();
      }
    } finally {
      if (taskId) await deleteTask(request, taskId);
      try { await fs.rm(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
      await ctxA.close();
      await ctxB.close();
    }
  });
});
