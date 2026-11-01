/*
 * V8 — Files & Terminal reuses the shared flat file tree and the shared Info |
 * Viewer sidebar (campaign mission-desktop-style-v2). Real browser + real server.
 *
 * Desktop: ONE shared 46px head band across the three cards (Files · Terminal +
 * Expand · Info|Viewer), no second tab row and no "Preview"; a tree pick flips
 * the right card to the Viewer and opens the file as a tab; the row context menu
 * is the V5 one; the right card collapses and comes back.
 * Phone: ONE bar Files | Terminal | Info | Viewer + Expand, no second level.
 * Both: the terminal pty still attaches as writer and a keystroke is its own byte.
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
import { attachWsCapture, isTerminalSocket, outboundDataFrames } from "../helpers/ws-capture";

test.describe("V8 — Files & Terminal shared tree + sidebar", () => {
  let project: SeededProject;
  let taskId: string;

  test.beforeEach(async ({ page, request, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    project = await seedProject(request, {
      name: "V8 shared UI",
      dirName: "sw-v8-shared-ui",
      files: { "README.md": "# V8 shared hello\n", "src/a.ts": "export const a = 1;\n" },
    });
    taskId = (await seedTask(request, { title: "V8", projectId: project.projectId })).taskId;
    await setActiveProject(page, project.projectId);
    await page.route("**/api/external/tasks/*/session-info", (route) =>
      route.fulfill({ json: { status: "missing" } }),
    );
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  const terminalOpens = (cap: ReturnType<typeof attachWsCapture>) =>
    cap.frames.filter((f) => f.kind === "open" && isTerminalSocket(f.url, taskId)).length;

  async function terminalWriter(page: Page) {
    const term = page.getByTestId("embedded-terminal");
    await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 25_000 });
    await expect(term).toHaveAttribute("data-role", "writer", { timeout: 10_000 });
  }

  async function keystrokeIsItsOwnByte(page: Page, cap: ReturnType<typeof attachWsCapture>) {
    await page.getByTestId("embedded-terminal-canvas").click();
    const at = Date.now();
    await page.keyboard.type("x");
    await expect
      .poll(() => outboundDataFrames(cap, taskId, at).map((f) => f.payload.replace(/^\x1b\[[IO]/, "")).join(""), {
        timeout: 15_000,
        intervals: [150],
      })
      .toBe("x");
  }

  test("desktop: shared head band, tree + context menu, Info|Viewer, collapse, pty intact", async ({ page }) => {
    test.setTimeout(120_000);
    const cap = attachWsCapture(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/tasks/${taskId}`);
    await terminalWriter(page);

    // One shared 46px band: left "Files", middle "Terminal" + Expand, right Info | Viewer.
    const heads = [
      page.getByTestId("folder-tree-header"),
      page.getByTestId("task-detail-center-header"),
      page.getByTestId("task-detail-viewer-head"),
    ];
    const boxes = await Promise.all(heads.map((h) => h.boundingBox()));
    for (const b of boxes) expect(Math.round(b!.height)).toBe(46);
    expect(Math.abs(boxes[0]!.y - boxes[2]!.y)).toBeLessThan(2);
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2);
    await expect(heads[0]).toContainText("Files");
    await expect(heads[1]).toContainText("Terminal");
    await expect(page.getByTestId("terminal-maximize")).toBeVisible();
    const seg = page.getByRole("radiogroup", { name: "Info sidebar sections" });
    await expect(seg.getByRole("radio")).toHaveText(["Info", "Viewer"]);
    // No second tab row, no "Preview", no Folders segment in this card.
    await expect(page.getByTestId("task-detail-viewer").getByText("Preview", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("task-detail-viewer").getByText("Folders")).toHaveCount(0);
    await expect(page.getByTestId("viewer-tab-bar")).toHaveCount(0);
    await expect(page.getByTestId("ft-side-seg-info")).toHaveAttribute("aria-checked", "true");

    // V5 context menu on a row of the shared tree.
    const readme = page.getByTestId("folder-tree-row-README.md");
    await readme.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Open in Viewer" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Copy Relative Path" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Clicking a file switches the right card to the Viewer and opens it as a tab.
    await readme.click();
    await expect(page.getByTestId("ft-side-seg-viewer")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("smart-viewer-markdown")).toContainText("V8 shared hello");
    await expect(page.getByTestId("viewer-tab-README.md")).toHaveAttribute("data-active", "true");
    await page.getByTestId("folder-tree-row-src").click();
    await page.getByTestId("folder-tree-row-src/a.ts").click();
    await expect(page.getByTestId("viewer-tab-src/a.ts")).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("viewer-tab-README.md")).toBeVisible();

    // Collapse the right card, then bring it back from the middle head.
    await page.getByTestId("ft-side-collapse").click();
    await expect(page.getByTestId("pane-right")).toHaveAttribute("data-collapsed", "true");
    await page.getByTestId("viewer-toggle").click();
    await expect(page.getByTestId("pane-right")).not.toHaveAttribute("data-collapsed", "true");
    await expect(page.getByTestId("viewer-tab-README.md")).toBeVisible();

    // A file picked while the card is collapsed reveals it again (never an invisible open).
    await page.getByTestId("ft-side-collapse").click();
    await expect(page.getByTestId("pane-right")).toHaveAttribute("data-collapsed", "true");
    await page.getByTestId("folder-tree-row-README.md").click();
    await expect(page.getByTestId("pane-right")).not.toHaveAttribute("data-collapsed", "true");
    await expect(page.getByTestId("viewer-tab-src/a.ts")).toBeVisible();

    await terminalWriter(page);
    await keystrokeIsItsOwnByte(page, cap);
  });

  test("phone: ONE tab bar Files | Terminal | Info | Viewer + Expand, no Preview, terminal intact", async ({ page }) => {
    test.setTimeout(120_000);
    const cap = attachWsCapture(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/tasks/${taskId}`);
    await terminalWriter(page);

    const opensBefore = terminalOpens(cap);
    const bar = page.getByTestId("pane-tab-bar");
    await expect(bar.getByRole("tab")).toHaveText(["Files", "Terminal", "Info", "Viewer"]);
    await expect(bar.getByRole("tab", { name: "Preview" })).toHaveCount(0);
    await expect(page.getByTestId("task-detail-viewer-head")).toHaveCount(0); // no second level
    await expect(page.getByTestId("pane-tab-terminal")).toHaveAttribute("aria-selected", "true");

    await page.getByTestId("pane-tab-info").click();
    await expect(page.getByTestId("pane-tab-info")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("ft-side-body-info")).toBeVisible();
    await page.getByTestId("pane-tab-right").click();
    await expect(page.getByTestId("pane-tab-right")).toHaveAttribute("aria-selected", "true");

    // Tree pick -> Viewer tab selected, file rendered.
    await page.getByTestId("pane-tab-left").click();
    await page.getByTestId("folder-tree-row-README.md").click();
    await expect(page.getByTestId("pane-tab-right")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("smart-viewer-markdown")).toContainText("V8 shared hello");

    // Expand folds the chrome above the bar, the bar stays, and it restores.
    const expand = page.getByTestId("pane-tab-expand");
    await expect(expand).toBeVisible();
    await expand.click();
    await expect(expand).toHaveAttribute("aria-pressed", "true");
    await expect(bar).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-term-expanded", "");
    await expand.click();
    await expect(page.locator("html")).not.toHaveAttribute("data-term-expanded", "");

    await page.getByTestId("pane-tab-terminal").click();
    await terminalWriter(page);
    // Tab switches + Expand never re-attach the pty socket (same subtree, same session).
    expect(terminalOpens(cap)).toBe(opensBefore);
    await keystrokeIsItsOwnByte(page, cap);
  });
});
