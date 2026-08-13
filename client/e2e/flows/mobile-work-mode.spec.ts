import { expect, test } from "@playwright/test";
import {
  cleanupProject,
  cleanupTaskCwd,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
  type SeededTask,
} from "../helpers/fixtures";
import {
  attachWsCapture,
  awaitFrame,
  isTerminalSocket,
} from "../helpers/ws-capture";
import {
  expectLightActiveControl,
  expectMinTouchTargets,
  expectOneLineEllipsis,
  expectOnlyUsableResizesSince,
  installFirstCompactTabProbe,
} from "../helpers/terminal-resize-assertions";
const LONG_TITLE =
  "Fix the mobile terminal layout while preserving every active Shipwright session";
const DESCRIPTION =
  "Keep the terminal useful on a phone. The full brief belongs in an overlay, not in the working viewport.";

test.describe("Mobile work mode", () => {
  let task: SeededTask | undefined;
  let project: SeededProject | undefined;
  test.afterEach(async ({ request }) => {
    await cleanupTaskCwd(request, task);
    if (project) await cleanupProject(request, project);
    task = undefined;
    project = undefined;
  });

  test("the terminal owns the viewport with one light four-way control row", async ({
    page,
    request,
  }, testInfo) => {
    const cap = attachWsCapture(page);
    project = await seedProject(request, {
      name: "mobile-work-mode",
      files: { "README.md": "# Mobile work mode" },
    });
    await setActiveProject(page, project.projectId);
    task = await seedTask(request, {
      title: LONG_TITLE,
      projectId: project.projectId,
    });
    await request.patch(`/api/external/tasks/${task.taskId}`, {
      data: { description: DESCRIPTION },
    });

    // Centre pane defaults to Terminal (the sole center-pane surface since
    // iterate-2026-08-13-mission-mobile-visual retired the Transcript
    // sub-tab) — correct on first compact paint and after a round-trip.
    await installFirstCompactTabProbe(page);

    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId("task-detail-page")).toBeVisible();
    await expect(page.getByTestId("pane-tab-terminal")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect.poll(() => page.evaluate(
      () => document.documentElement.dataset.firstCompactWorkspaceTab,
    )).toBe("pane-tab-terminal");
    const phoneViewport = page.viewportSize()!;
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(page.getByTestId("task-detail-terminal")).toBeVisible();
    await page.setViewportSize(phoneViewport);
    await expect(page.getByTestId("pane-tab-terminal")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const terminal = page.getByTestId("embedded-terminal");
    await expect(terminal).toHaveAttribute("data-ws-ready", "true", {
      timeout: 20_000,
    });

    const terminalOpens = () => cap.frames.filter(
      (frame) => frame.kind === "open" && isTerminalSocket(frame.url, task!.taskId),
    );
    const opensBefore = terminalOpens().length;
    const socketId = terminalOpens().at(-1)?.socketId;
    const socketOpenedAt = terminalOpens().at(-1)?.ts;
    expect(socketId).toBeDefined();
    expect(socketOpenedAt).toBeDefined();
    expectOnlyUsableResizesSince(cap, socketId!, socketOpenedAt!);
    await terminal.evaluate((element) => {
      element.setAttribute("data-mobile-session-marker", "preserved");
    });

    // Crossing 1024px while active must refit this same terminal socket.
    for (const viewport of [{ width: 1100, height: 900 }, phoneViewport]) {
      const crossedAt = Date.now();
      await page.setViewportSize(viewport);
      // Wait for the responsive React commit before sampling the resize. In a
      // production bundle the browser resize event can precede that commit;
      // dispatch one coalesced resize at the settled breakpoint to exercise
      // the same live-socket refit path deterministically.
      if (viewport.width > 1024) {
        await expect(page.getByTestId("task-detail-center-header")).toBeVisible();
      } else {
        await expect(page.getByTestId("pane-tab-bar")).toBeVisible();
      }
      await page.evaluate(() => window.dispatchEvent(new Event("resize")));
      const crossedResize = await awaitFrame(
        page,
        cap,
        (frame, env) =>
          frame.kind === "tx" &&
          frame.ts >= crossedAt &&
          frame.socketId === socketId &&
          env?.type === "resize" &&
          typeof env.cols === "number" && env.cols >= 5 &&
          typeof env.rows === "number" && env.rows >= 2,
        { timeoutMs: 10_000 },
      );
      expect(crossedResize, "breakpoint crossing must refit the live socket").not.toBeNull();
      expectOnlyUsableResizesSince(cap, socketId!, crossedAt);
      await expect(terminal).toHaveAttribute("data-mobile-session-marker", "preserved");
    }
    expect(terminalOpens().length).toBe(opensBefore);

    const tabs = page.getByTestId("pane-tab-bar").getByRole("tab");
    await expect(tabs).toHaveText(["Files", "Terminal", "Viewer"]);
    await expect(page.getByTestId("pane-tab-center")).toHaveCount(0);
    await expect(page.getByTestId("task-detail-center-header")).toHaveCount(0);
    await expect(page.getByTestId("pane-tab-terminal")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expectLightActiveControl(page.getByTestId("mission-tab-files"));

    await page.getByTestId("pane-tab-left").click();
    await expect(page.getByTestId("pane-left")).not.toHaveAttribute("inert");
    await page.getByTestId("folder-tree-row-README.md").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("pane-tab-right")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("pane-tab-right")).toBeFocused();
    await expect(page.getByTestId("smart-viewer-markdown")).toContainText(
      "Mobile work mode",
    );

    // The task-level `t` shortcut drives the same controlled pane state.
    await page.keyboard.press("t");
    await expect(page.getByTestId("pane-tab-terminal")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("terminal-maximize")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(() => page.evaluate(() => {
      const terminal = document.querySelector('[data-testid="embedded-terminal"]');
      return terminal?.contains(document.activeElement) ?? false;
    })).toBe(true);
    await page.getByTestId("terminal-maximize").click();

    const title = page.getByTestId("task-title-display");
    await expectOneLineEllipsis(title);

    const header = page.getByTestId("task-detail-header");
    const headerHeight = async () => (await header.boundingBox())!.height;
    const headerHeightBefore = await headerHeight();

    await title.click();
    const titleTriggerBox = await title.boundingBox();
    expect(titleTriggerBox?.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("task-title-popover")).toContainText(LONG_TITLE);
    const rename = page.getByTestId("task-title-popover-rename");
    await expect(rename).toBeVisible();
    const renameBox = await rename.boundingBox();
    expect(renameBox?.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs((await headerHeight()) - headerHeightBefore)).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(title).toBeFocused();

    const descriptionToggle = page.getByTestId("task-description-toggle");
    await descriptionToggle.click();
    await expect(page.getByTestId("task-description-body")).toContainText(DESCRIPTION);
    const descriptionBox = await page.getByTestId("task-description-body").boundingBox();
    expect(descriptionBox?.x).toBeGreaterThanOrEqual(0);
    expect((descriptionBox?.x ?? 0) + (descriptionBox?.width ?? 0))
      .toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(Math.abs((await headerHeight()) - headerHeightBefore)).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(descriptionToggle).toBeFocused();
    const topbarBox = await page.getByTestId("mobile-topbar").boundingBox();
    expect(topbarBox?.y).toBeGreaterThanOrEqual(0);
    await expectMinTouchTargets([
      page.getByTestId("task-detail-back"),
      page.getByTestId("task-detail-menu-trigger"),
    ]);

    const expand = page.getByTestId("terminal-maximize");
    await expect(expand).toBeVisible();
    const expandBox = await expand.boundingBox();
    expect(expandBox?.width).toBeGreaterThanOrEqual(44);
    expect(expandBox?.height).toBeGreaterThanOrEqual(44);

    const keybarPadding = await page.getByTestId("terminal-key-bar").evaluate((element) => {
      const style = getComputedStyle(element);
      return { top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom) };
    });
    expect(Math.abs(keybarPadding.top - keybarPadding.bottom)).toBeLessThanOrEqual(0.5);

    // The four-way row keeps the same terminal DOM/socket and refits on reveal.
    await page.getByTestId("pane-tab-right").click();
    await expect(page.getByTestId("task-detail-viewer")).toBeVisible();
    await page.setViewportSize({ width: 380, height: 800 });
    const restoredAt = Date.now();
    await page.getByTestId("pane-tab-terminal").click();
    await expect(terminal).toHaveAttribute("data-mobile-session-marker", "preserved");
    await expect(terminal).toHaveAttribute("data-ws-ready", "true");

    const resize = await awaitFrame(
      page,
      cap,
      (frame, env) =>
        frame.kind === "tx" &&
        frame.ts >= restoredAt &&
        frame.socketId === socketId &&
        env?.type === "resize" &&
        typeof env.cols === "number" &&
        env.cols >= 5 &&
        typeof env.rows === "number" &&
        env.rows >= 2,
      { timeoutMs: 10_000 },
    );
    expect(resize, "Terminal restore must fit and resize the existing session").not.toBeNull();
    expectOnlyUsableResizesSince(cap, socketId!, restoredAt);
    expect(terminalOpens().length).toBe(opensBefore);
    expect(cap.frames.some(
      (frame) => frame.kind === "close" && frame.socketId === socketId && frame.ts >= restoredAt,
    )).toBe(false);

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);

    const terminalBox = await page.getByTestId("task-detail-terminal").boundingBox();
    expect(terminalBox?.height).toBeGreaterThan(page.viewportSize()!.height * 0.45);
    expectOnlyUsableResizesSince(cap, socketId!, socketOpenedAt!);
    await page.screenshot({
      path: testInfo.outputPath("mobile-terminal-work-mode.png"),
      fullPage: false,
    });
  });
});
