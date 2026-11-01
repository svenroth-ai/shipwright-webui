/*
 * Spec 106 - file-path and web links in the embedded terminal (FR-01.28,
 * iterate-2026-11-01-terminal-links).
 *
 * Real browser + REAL server + REAL pty: the paths are printed by the shell into
 * the real xterm buffer, the link provider finds them, and the click goes through
 * the real project file route / session-file route into the shared Smart Viewer
 * of the Files & Terminal page. Only window.open is stubbed (to record the call).
 *
 *   web link            -> window.open(url, "_blank", "noopener,noreferrer"), plain click
 *   project file        -> right card switches to the Viewer and shows the file
 *   evidenced outside   -> Viewer with the "Outside project" tag
 *   unevidenced outside -> NO Viewer, notice "Not part of this session"
 *   phone (Pixel-5 size, touch) -> a swipe scrolls the terminal and opens nothing; a tap opens
 * @covers FR-01.28
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  makeTempDir,
  removeTempDir,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { seedClaudeJsonlEvents } from "../helpers/claude-jsonl";
import { openTaskTerminal } from "../helpers/terminal-drive";

const INSIDE_BODY = "INSIDE-BODY-106";
const OUTSIDE_BODY = "OUTSIDE-BODY-106";
const WIN = process.platform === "win32";

/** Print one line through the real pty (shell-dialect aware; printf avoids dash's backslash escapes). */
async function printLine(page: Page, text: string) {
  // focus without a positional click (a click could land on an earlier printed link)
  await page.evaluate(() => (window as unknown as { __embeddedTerminal: import("@xterm/xterm").Terminal }).__embeddedTerminal.focus());
  const cmd = WIN ? `Write-Output '${text}'` : `printf '%s\\n' '${text}'`;
  await page.keyboard.type(cmd);
  await page.keyboard.press("Enter");
  // The typed command line also holds `text`; pointOn skips it, so row >= 0 means the OUTPUT line is on screen.
  await expect.poll(async () => (await pointOn(page, text)).row, { timeout: 20_000 }).toBeGreaterThanOrEqual(0);
}

/** Viewport row of the LAST occurrence of `needle` in the xterm buffer (-1 when absent). */
function bufferHas(page: Page, needle: string): Promise<number> {
  return page.evaluate((n) => {
    const t = (window as unknown as { __embeddedTerminal?: import("@xterm/xterm").Terminal }).__embeddedTerminal;
    if (!t) return -1;
    const b = t.buffer.active;
    let hit = -1;
    for (let i = b.viewportY; i < b.viewportY + t.rows; i++) {
      const line = b.getLine(i);
      if (line && line.translateToString(true).includes(n)) hit = i - b.viewportY;
    }
    return hit;
  }, needle);
}

/** Pixel centre of the first character of the last occurrence of `needle`, plus 2 cells in. */
async function pointOn(page: Page, needle: string) {
  return page.evaluate((n) => {
    const t = (window as unknown as { __embeddedTerminal: import("@xterm/xterm").Terminal }).__embeddedTerminal;
    const b = t.buffer.active;
    let row = -1;
    let col = -1;
    for (let i = b.viewportY; i < b.viewportY + t.rows; i++) {
      const s = b.getLine(i)?.translateToString(true) ?? "";
      // OUTPUT lines start with the text itself (the command line starts with the prompt); a long
      // path soft-wraps, so only its head is matched and the click lands on the first row.
      if (s.startsWith(n.slice(0, 24))) {
        row = i - b.viewportY;
        col = 0;
      }
    }
    const r = (document.querySelector(".xterm-screen") as HTMLElement).getBoundingClientRect();
    return { x: r.left + ((col + 2.5) * r.width) / t.cols, y: r.top + ((row + 0.5) * r.height) / t.rows, row };
  }, needle);
}

async function clickPath(page: Page, text: string) {
  await printLine(page, text);
  const p = await pointOn(page, text);
  expect(p.row).toBeGreaterThanOrEqual(0);
  await page.mouse.move(p.x - 3, p.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}

test.describe("106 - terminal file and web links", () => {
  test.setTimeout(150_000);
  let project: SeededProject;
  let taskId = "";
  let outsideDir = "";
  let outsideFile = "";
  let secretFile = "";

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "T106", dirName: "sw-t106-links" });
    await fs.mkdir(path.join(project.path, "src"), { recursive: true });
    await fs.writeFile(path.join(project.path, "src", "hello.ts"), `// ${INSIDE_BODY}\nexport const a = 1;\n`);
    outsideDir = await makeTempDir("sw-t106-outside-");
    outsideFile = path.join(outsideDir, "scratch-notes.md");
    secretFile = path.join(outsideDir, "never-mentioned.md");
    await fs.writeFile(outsideFile, `# ${OUTSIDE_BODY}\n`);
    await fs.writeFile(secretFile, "# not evidenced\n");
    const task = await seedTask(request, { title: "T106 links", projectId: project.projectId, cwd: project.path });
    taskId = task.taskId;
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        { type: "user", message: { role: "user", content: "write the notes" } },
        {
          type: "assistant",
          message: { role: "assistant", content: [{ type: "tool_use", id: "w1", name: "Write", input: { file_path: outsideFile, content: "x" } }] },
        },
      ],
    });
    await setActiveProject(page, project.projectId);
    await page.addInitScript(() => {
      const w = window as unknown as { __opened: unknown[][] };
      w.__opened = [];
      window.open = ((...a: unknown[]) => {
        w.__opened.push(a);
        return null;
      }) as typeof window.open;
    });
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
    await removeTempDir(outsideDir);
  });

  test.describe("desktop", () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openTaskTerminal(page, taskId);
    });

    // @covers FR-01.28
    test("a web link opens in a new tab on a plain click (no modifier), noopener", async ({ page }) => {
      await clickPath(page, "https://example.test/docs/page");
      await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: unknown[][] }).__opened)).toEqual([
        ["https://example.test/docs/page", "_blank", "noopener,noreferrer"],
      ]);
    });

    // @covers FR-01.28
    test("a project file path opens in the Viewer (right card switches) and shows the file", async ({ page }) => {
      await clickPath(page, "src/hello.ts:2:1");
      await expect(page.getByTestId("ft-side-body-viewer")).toContainText(INSIDE_BODY, { timeout: 20_000 });
      await expect(page.getByTestId("smart-viewer-outside-head")).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __opened: unknown[] }).__opened.length)).toBe(0);
    });

    // @covers FR-01.28
    test("an outside file the session evidences opens in the Viewer with the Outside-project tag", async ({ page }) => {
      await clickPath(page, outsideFile);
      await expect(page.getByTestId("ft-side-body-viewer")).toContainText(OUTSIDE_BODY, { timeout: 20_000 });
      await expect(page.getByTestId("smart-viewer-outside-tag")).toHaveText("Outside project");
    });

    // @covers FR-01.28
    test("an outside file the session does NOT evidence shows the hint and opens nothing", async ({ page }) => {
      await clickPath(page, secretFile);
      const notice = page.getByTestId("embedded-terminal-clipboard-notice");
      await expect(notice).toHaveText(/Not part of this session/, { timeout: 20_000 });
      await expect(notice).toHaveAttribute("data-notice-kind", "link-not-in-session");
      await expect(page.getByTestId("ft-side-body-viewer")).toHaveCount(0); // right card stays on Info
      await expect(page.getByTestId("smart-viewer-outside-tag")).toHaveCount(0);
      await expect(notice).toBeHidden({ timeout: 15_000 }); // auto-dismisses
    });

    // @covers FR-01.28
    test("a project file link still opens while the app has mouse tracking on (Claude's TUI mode)", async ({ page }) => {
      // Claude's fullscreen TUI turns on any-motion + SGR mouse reporting; set the same xterm modes
      // locally (a client-side write; the pty and its shell are not involved).
      await page.evaluate(() =>
        (window as unknown as { __embeddedTerminal: import("@xterm/xterm").Terminal }).__embeddedTerminal.write("[?1003h[?1006h"),
      );
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __embeddedTerminal: import("@xterm/xterm").Terminal }).__embeddedTerminal.modes.mouseTrackingMode))
        .toBe("any");
      await clickPath(page, "src/hello.ts");
      await expect(page.getByTestId("ft-side-body-viewer")).toContainText(INSIDE_BODY, { timeout: 20_000 });
    });

    // @covers FR-01.28
    test("a right-click and a drag across a path do not open it", async ({ page }) => {
      await printLine(page, "src/hello.ts");
      const p = await pointOn(page, "src/hello.ts");
      await page.mouse.move(p.x, p.y);
      await page.mouse.click(p.x, p.y, { button: "right" });
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(p.x + 40, p.y, { steps: 4 });
      await page.mouse.up();
      await page.waitForTimeout(800);
      await expect(page.getByTestId("ft-side-body-viewer")).toHaveCount(0); // right card stays on Info
    });
  });

  test.describe("phone (Pixel-5 size, touch)", () => {
    test.use({ viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true });

    // @covers FR-01.28
    test("a swipe over linked text scrolls the terminal and opens nothing; a tap opens the file", async ({ page }) => {
      await openTaskTerminal(page, taskId);
      await page.getByTestId("embedded-terminal-canvas").click();
      const gen = WIN ? "1..140 | ForEach-Object { \"src/hello.ts row $_\" }" : "i=1; while [ $i -le 140 ]; do echo \"src/hello.ts row $i\"; i=$((i+1)); done";
      await page.keyboard.type(gen);
      await page.keyboard.press("Enter");
      await expect.poll(() => bufferHas(page, "src/hello.ts row 140"), { timeout: 30_000 }).toBeGreaterThanOrEqual(0);
      const viewportY = () => page.evaluate(() => (window as unknown as { __embeddedTerminal: import("@xterm/xterm").Terminal }).__embeddedTerminal.buffer.active.viewportY);
      const before = await viewportY();
      const box = (await page.locator(".xterm-screen").boundingBox())!;
      const x = box.x + 40;
      const cdp = await page.context().newCDPSession(page);
      const touch = (type: "touchStart" | "touchMove" | "touchEnd", y: number) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
      await touch("touchStart", box.y + box.height * 0.3);
      for (let i = 1; i <= 12; i++) await touch("touchMove", box.y + box.height * 0.3 + i * 30);
      await touch("touchEnd", 0);
      await expect.poll(viewportY).toBeLessThan(before);
      await expect(page.getByTestId("ft-side-body-viewer")).toHaveCount(0); // phone: right pane not shown
      expect(await page.evaluate(() => (window as unknown as { __opened: unknown[] }).__opened.length)).toBe(0);

      await page.evaluate(() => (window as unknown as { __embeddedTerminal: import("@xterm/xterm").Terminal }).__embeddedTerminal.scrollToBottom());
      const p = await pointOn(page, "src/hello.ts");
      await page.touchscreen.tap(p.x + 40, p.y);
      await expect(page.getByTestId("ft-side-body-viewer")).toContainText(INSIDE_BODY, { timeout: 20_000 });
    });
  });
});
