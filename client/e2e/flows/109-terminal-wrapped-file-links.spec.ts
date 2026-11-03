/*
 * Spec 109 - a file path that wraps onto a second terminal row is ONE link (FR-01.28,
 * iterate-2026-11-03-terminal-wrapped-path-links).
 *
 * Real browser + REAL server + REAL pty. Two ways a long path ends up on two rows:
 *   soft wrap - the terminal wraps it itself (isWrapped)
 *   hard wrap - an app (Claude's TUI) breaks it with a real newline at the last column (isWrapped = false);
 *               reproduced by the shell printing the path as two full-width lines.
 * In both, a click on EITHER row must open the FULL path in the Viewer (a partial path does not exist, so
 * the openable probe would have removed it: the Viewer showing the body proves the joined target).
 * Plus the Mission chat: a long file name stays ONE chip / hit target (never split across lines).
 * @covers FR-01.28
 * @covers FR-01.66
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { cleanupProject, cleanupTask, seedProject, seedTask, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { seedClaudeJsonlEvents } from "../helpers/claude-jsonl";
import { openTaskTerminal } from "../helpers/terminal-drive";

const WIN = process.platform === "win32";
type Term = import("@xterm/xterm").Terminal;

const cols = (page: Page) => page.evaluate(() => (window as unknown as { __embeddedTerminal: Term }).__embeddedTerminal.cols);

/** Print `lines` as separate output lines through the real pty (focus without a click). */
async function printLines(page: Page, lines: string[]) {
  await page.evaluate(() => (window as unknown as { __embeddedTerminal: Term }).__embeddedTerminal.focus());
  const cmd = WIN ? `Write-Output ${lines.map((l) => `'${l}'`).join(",")}` : `printf '%s\\n' ${lines.map((l) => `'${l}'`).join(" ")}`;
  await page.keyboard.type(cmd);
  await page.keyboard.press("Enter");
  const head = lines[0]!.slice(0, 24);
  await expect
    .poll(() =>
      page.evaluate((h) => {
        const t = (window as unknown as { __embeddedTerminal: Term }).__embeddedTerminal;
        const b = t.buffer.active;
        for (let i = b.viewportY; i < b.viewportY + t.rows; i++) if (b.getLine(i)?.translateToString(true).startsWith(h)) return i - b.viewportY;
        return -1;
      }, head),
    )
    .toBeGreaterThanOrEqual(0);
}

/** Click the centre of cell column 3 on the `rowOffset`-th row below the (last) row starting with `head`. */
async function clickRow(page: Page, head: string, rowOffset: number) {
  const p = await page.evaluate(
    ([h, off]) => {
      const t = (window as unknown as { __embeddedTerminal: Term }).__embeddedTerminal;
      const b = t.buffer.active;
      let row = -1;
      for (let i = b.viewportY; i < b.viewportY + t.rows; i++) if (b.getLine(i)?.translateToString(true).startsWith(h as string)) row = i - b.viewportY;
      const r = (document.querySelector(".xterm-screen") as HTMLElement).getBoundingClientRect();
      return { x: r.left + (3.5 * r.width) / t.cols, y: r.top + ((row + (off as number) + 0.5) * r.height) / t.rows, row };
    },
    [head, rowOffset] as const,
  );
  expect(p.row).toBeGreaterThanOrEqual(0);
  await page.mouse.move(p.x - 3, p.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}

test.describe("109 - wrapped file paths in the terminal are one link", () => {
  test.setTimeout(150_000);
  let project: SeededProject;
  let taskId = "";

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "T109", dirName: "sw-t109-wrap" });
    const task = await seedTask(request, { title: "T109 wrap", projectId: project.projectId, cwd: project.path });
    taskId = task.taskId;
    seedClaudeJsonlEvents({ sessionUuid: task.sessionUuid, cwd: task.cwd, events: [{ type: "user", message: { role: "user", content: "hi" } }] });
    await setActiveProject(page, project.projectId);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  /** A project file whose relative path is longer than the terminal is wide, broken mid-segment. */
  async function longFile(page: Page, tag: string) {
    const c = await cols(page);
    expect(c).toBeLessThan(240);
    const seg = `w${tag}`.padEnd(c, "w");
    const rel = `src/${seg}/deep.md`;
    await fs.mkdir(path.join(project.path, "src", seg), { recursive: true });
    await fs.writeFile(path.join(project.path, rel), `# BODY-${tag}\n`);
    return { rel, c };
  }

  for (const row of [0, 1]) {
    // @covers FR-01.28
    test(`soft wrap: a click on row ${row + 1} opens the FULL path`, async ({ page }) => {
      await openTaskTerminal(page, taskId);
      const { rel } = await longFile(page, `soft${row}`);
      await printLines(page, [rel]);
      // fail loudly if the platform pty turned the wrap into a real newline (that would test the hard path instead)
      expect(
        await page.evaluate((h) => {
          const t = (window as unknown as { __embeddedTerminal: Term }).__embeddedTerminal;
          const b = t.buffer.active;
          for (let i = b.viewportY + t.rows - 2; i >= b.viewportY; i--) if (b.getLine(i)?.translateToString(true).startsWith(h)) return b.getLine(i + 1)?.isWrapped === true;
          return false;
        }, rel.slice(0, 24)),
      ).toBe(true);
      await clickRow(page, rel.slice(0, 24), row);
      await expect(page.getByTestId("ft-side-body-viewer")).toContainText(`BODY-soft${row}`, { timeout: 20_000 });
    });

    // @covers FR-01.28
    test(`hard wrap (TUI newline at the last column): a click on row ${row + 1} opens the FULL path`, async ({ page }) => {
      await openTaskTerminal(page, taskId);
      const { rel, c } = await longFile(page, `hard${row}`);
      await printLines(page, [rel.slice(0, c), rel.slice(c)]);
      await clickRow(page, rel.slice(0, 24), row);
      await expect(page.getByTestId("ft-side-body-viewer")).toContainText(`BODY-hard${row}`, { timeout: 20_000 });
    });
  }

  // @covers FR-01.66
  test("Mission chat: a long file name stays ONE chip / hit target on one line and opens the file", async ({ page, request }) => {
    const name = `${"long-name-".repeat(14)}end.md`;
    await fs.mkdir(path.join(project.path, "docs"), { recursive: true });
    await fs.writeFile(path.join(project.path, "docs", name), "# CHIP-BODY-109\n");
    const t2 = await seedTask(request, { title: "T109 chip", projectId: project.projectId, cwd: project.path });
    try {
      seedClaudeJsonlEvents({
        sessionUuid: t2.sessionUuid,
        cwd: t2.cwd,
        events: [
          { type: "user", message: { role: "user", content: [{ type: "text", text: "show it" }] } },
          { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `See \`docs/${name}\` for details, then carry on with more words after it.` }] } },
        ],
      });
      await page.goto(`/tasks/${t2.taskId}`);
      await page.getByTestId("mission-tab-mission").click();
      const chip = page.getByTestId("mission-activity-feed").getByTestId("mc-file");
      await expect(chip).toHaveCount(1, { timeout: 20_000 });
      const box = (await chip.boundingBox())!;
      expect(box.height).toBeLessThan(40); // one line, not split over two
      await chip.click();
      await expect(page.getByTestId("mission-side-body-viewer")).toContainText("CHIP-BODY-109", { timeout: 20_000 });
    } finally {
      await cleanupTask(request, t2.taskId);
    }
  });
});
