/*
 * V12 — the Info sidebar never overflows horizontally, and Outputs hides files that are gone.
 *
 * Root cause pinned here: the info panel was a grid with an implicit `auto` track, so one nowrap row (a very
 * long Outputs file name, a long project path) widened the WHOLE pane past its edge: Environment values
 * clipped, the Remote Control / Agents values pushed out of sight, a horizontal scrollbar. Real browser +
 * real server + REAL files (session JSONL + subagent files in the isolated Claude home; nothing mocked).
 * @covers FR-01.66
 */

import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { seedClaudeJsonlEvents } from "../helpers/claude-jsonl";

const LONG = "iterate-2026-11-02-smartviewer-html-images-html-preview-with-an-extremely-long-name-that-cannot-fit.md";
const GONE = "deleted-after-write-scratch.md";

const write = (id: string, file: string) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", id, name: "Write", input: { file_path: file, content: "x" } }] },
});

test.describe("V12 — info sidebar: no horizontal overflow, missing outputs hidden", () => {
  test.describe.configure({ timeout: 120_000 });
  let project: SeededProject;
  let taskId = "";

  test.beforeEach(async ({ page, request }) => {
    // A long directory name = a long "Project folder" value (the mono path the row must truncate).
    project = await seedProject(request, { name: "V12", dirName: `sw-v12-${"long-project-folder-".repeat(3)}x` });
    fs.writeFileSync(path.join(project.path, LONG), "# long\n");
    fs.writeFileSync(path.join(project.path, "short.md"), "# short\n");
    const task = await seedTask(request, { title: "V12 overflow", projectId: project.projectId, cwd: project.path });
    taskId = task.taskId;
    const file = seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        write("w1", path.join(project.path, LONG)),
        write("w2", path.join(project.path, "short.md")),
        write("w3", path.join(project.path, GONE)), // never exists on disk
        {
          type: "assistant",
          message: { role: "assistant", content: [{ type: "tool_use", id: "a1", name: "Agent", input: { description: "Build", prompt: "P", run_in_background: true } }] },
        },
        { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "a1", content: "Async agent launched successfully. agentId: run1" }] } },
      ],
    });
    const dir = path.join(path.dirname(file), task.sessionUuid, "subagents");
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(dir, "agent-run1.jsonl"), JSON.stringify({ isSidechain: true, agentId: "run1", timestamp: now, type: "user", message: { role: "user", content: "P" } }) + "\n");
    fs.writeFileSync(path.join(dir, "agent-run1.meta.json"), JSON.stringify({ agentType: "sub-iterate-runner", description: "Build", toolUseId: "a1", spawnDepth: 1 }));
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  /** No element of the card may poke out of it, and the pane itself must not scroll sideways. */
  async function assertContained(page: Page, pane: string) {
    const p = page.getByTestId(pane);
    const body = await p.evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth }));
    expect(body.s, "pane scrolls horizontally").toBeLessThanOrEqual(body.c + 1);
    const offenders = await page.evaluate((paneId) => {
      const out: string[] = [];
      const root = document.querySelector(`[data-testid="${paneId}"]`)!;
      const paneRight = root.getBoundingClientRect().right;
      for (const card of Array.from(root.querySelectorAll(".env-sec"))) {
        const edge = card.getBoundingClientRect().right;
        if (edge > paneRight + 1) out.push(`card past pane: ${edge} > ${paneRight}`);
        for (const el of Array.from(card.querySelectorAll("*"))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          // text that an ancestor clips (ellipsis) is contained: judge it by the clipping box instead
          let right = r.right;
          for (let a = el.parentElement; a && a !== card; a = a.parentElement) {
            if (getComputedStyle(a).overflowX !== "visible") right = Math.min(right, a.getBoundingClientRect().right);
          }
          if (right > edge + 1) out.push(`${el.className || el.tagName} right ${right} > card ${edge}`);
        }
      }
      return out;
    }, pane);
    expect(offenders).toEqual([]);
    // The values that used to vanish stay fully visible inside the pane.
    for (const id of ["env-remote-pill", "agents-bar-button"]) {
      const b = (await page.getByTestId(id).boundingBox())!;
      const pr = (await p.boundingBox())!;
      expect(b.width).toBeGreaterThan(20);
      expect(b.x + b.width).toBeLessThanOrEqual(pr.x + pr.width + 1);
    }
  }

  async function outputsReady(page: Page) {
    await expect(page.getByTestId("env-output").first()).toBeVisible({ timeout: 20_000 });
    // the missing file is hidden once the probe answers; the two real ones remain
    await expect(page.getByTestId("env-output")).toHaveCount(2);
    await expect(page.getByTestId("env-outputs-count")).toHaveText("2 files");
    await expect(page.getByTestId("env-outputs")).not.toContainText(GONE);
    const long = page.getByTestId("env-output").filter({ hasText: "iterate-2026-11-02" });
    await expect(long).toHaveAttribute("title", new RegExp(`${LONG}$`));
    const name = long.locator(".env-output-name");
    const ell = await name.evaluate((el) => ({ over: el.scrollWidth > el.clientWidth, ts: getComputedStyle(el).textOverflow }));
    expect(ell).toEqual({ over: true, ts: "ellipsis" });
  }

  for (const width of [1440, 1920]) {
    // @covers FR-01.66
    test(`Files & Terminal Info at ${width}px: nothing overflows`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByTestId("ft-side-body-info")).toBeVisible();
      await outputsReady(page);
      await assertContained(page, "ft-side-body-info");
    });

    // @covers FR-01.66
    test(`Mission Info at ${width}px, default and minimum width: nothing overflows`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/tasks/${taskId}`);
      await page.getByTestId("mission-tab-mission").click();
      await expect(page.getByTestId("mission-side")).toBeVisible();
      await outputsReady(page);
      await assertContained(page, "mission-side-body-info");
      await page.getByTestId("mission-side-splitter").focus();
      await page.keyboard.press("Home");
      await expect.poll(async () => (await page.getByTestId("mission-side").boundingBox())!.width).toBeLessThan(260);
      await assertContained(page, "mission-side-body-info");
    });
  }
});
