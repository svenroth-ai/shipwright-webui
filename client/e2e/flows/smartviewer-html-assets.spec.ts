/*
 * Spec — SmartViewer shows the IMAGES and CSS resources of a rendered .html page
 * (iterate-2026-11-02-smartviewer-html-images, FR-01.02).
 *
 * Regression: the page lives in a sandboxed srcdoc iframe with no base URL, so a relative
 * <img src="shot.png"> never loaded (and for a page OUTSIDE the project even the stylesheet was
 * skipped). Real browser + REAL server: the project route for a project page, and the
 * session-file route (`assetOf`) for a page outside the project that the session evidences.
 * Only GET .../session-info is fulfilled (it reads the operator's Claude home).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { cleanupProject, cleanupTask, makeTempDir, removeTempDir, seedProject, seedTask, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { seedClaudeJsonlEvents } from "../helpers/claude-jsonl";
import { apiUrl } from "../helpers/env";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const PAGE = [
  "<!DOCTYPE html><html><head><link rel='stylesheet' href='mockup.css'></head><body>",
  "<h1 id='t'>Report</h1><img id='shot' src='shot.png' alt='shot'><div id='bg'>bg</div>",
  "</body></html>",
].join("");
const CSS = "#t{color:rgb(255,0,0)} #bg{background-image:url(img/bg.png);width:10px;height:10px}";

// @covers FR-01.02
test.describe("SmartViewer HTML resources (FR-01.02)", () => {
  let project: SeededProject;
  let taskId: string;
  let outsideDir: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "HtmlAssets", dirName: "sw-html-assets" });
    outsideDir = await makeTempDir("sw-html-assets-outside-");
    await fs.mkdir(path.join(outsideDir, "img"));
    await fs.mkdir(path.join(project.path, "docs", "img"), { recursive: true });
    for (const dir of [outsideDir, path.join(project.path, "docs")]) {
      await fs.writeFile(path.join(dir, "report.html"), PAGE);
      await fs.writeFile(path.join(dir, "mockup.css"), CSS);
      await fs.writeFile(path.join(dir, "shot.png"), PNG);
      await fs.writeFile(path.join(dir, "img", "bg.png"), PNG);
    }
    await fs.writeFile(path.join(outsideDir, "secret.png"), PNG);
    const task = await seedTask(request, { title: "HtmlAssets", projectId: project.projectId, cwd: project.path });
    taskId = task.taskId;
    const outsidePage = path.join(outsideDir, "report.html");
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        { type: "user", message: { role: "user", content: "Make the comparison page." } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "w1", name: "Write", input: { file_path: outsidePage, content: "x" } }] } },
      ],
    });
    await page.route("**/api/external/tasks/*/session-info", (route) =>
      route.fulfill({
        json: {
          status: "ok",
          info: {
            sessionUuid: task.sessionUuid,
            context: { tokens: 1, model: "claude-opus-4-7", at: null, compactedSince: false, tokensAfterCompaction: null },
            compaction: { count: 0, last: null },
            outputs: [{ path: outsidePage, tool: "Write", firstAt: null, lastAt: "2026-01-03T00:00:00Z", agentId: null }],
            remoteControl: { active: false, onceEnabled: false, pid: null },
            subagents: [],
            scan: { truncated: false, scannedBytes: 1, sizeBytes: 1, outputsTruncated: 0, subagentsTruncated: 0 },
          },
        },
      }),
    );
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
    await removeTempDir(outsideDir);
  });

  async function expectResources(frame: ReturnType<import("@playwright/test").Page["frameLocator"]>) {
    await expect(frame.locator("#t")).toHaveCSS("color", "rgb(255, 0, 0)", { timeout: 10000 });
    await expect.poll(() => frame.locator("#shot").evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 10000 }).toBe(1);
    await expect(frame.locator("#bg")).toHaveCSS("background-image", /data:image\/png/);
  }

  // @covers FR-01.02
  test("a project page shows its image, stylesheet and CSS background", async ({ page }) => {
    await page.goto(`/preview?projectId=${project.projectId}&path=docs/report.html`);
    await expectResources(page.frameLocator('[data-testid="smart-viewer-html-frame"]').first());
  });

  // @covers FR-01.02
  test("a page OUTSIDE the project shows them too, inline and in the pop-out", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await page.getByTestId("env-output").filter({ hasText: "report.html" }).click();
    await expect(page.getByTestId("smart-viewer-outside-tag")).toHaveText("Outside project");
    await expectResources(page.frameLocator('[data-testid="smart-viewer-html-frame"]').first());

    await page.getByTestId("smart-viewer-popout").click();
    const modal = page.getByTestId("smart-viewer-modal");
    await expect(modal).toBeVisible();
    await expectResources(modal.frameLocator('[data-testid="smart-viewer-html-frame"]'));
  });

  // @covers FR-01.02
  test("the server serves a sibling only for an evidenced page, and nothing else outside its folder", async ({ request }) => {
    const page = path.join(outsideDir, "report.html");
    const url = (p: string, owner?: string) =>
      apiUrl(`/api/external/tasks/${taskId}/session-file?path=${encodeURIComponent(p)}${owner ? `&assetOf=${encodeURIComponent(owner)}` : ""}`);
    expect((await request.get(url(path.join(outsideDir, "secret.png")))).status()).toBe(403); // no page named: still refused
    const ok = await request.get(url(path.join(outsideDir, "secret.png"), page));
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toContain("image/png");
    // a page the session never evidenced owns nothing; a script / text file is never an asset
    expect((await request.get(url(path.join(outsideDir, "secret.png"), path.join(outsideDir, "other.html")))).status()).toBe(403);
    await fs.writeFile(path.join(outsideDir, "s.js"), "1");
    expect((await request.get(url(path.join(outsideDir, "s.js"), page))).status()).toBe(403);
    expect((await request.get(url(path.join(outsideDir, "..", "x.png"), page))).status()).toBe(403);
  });
});
