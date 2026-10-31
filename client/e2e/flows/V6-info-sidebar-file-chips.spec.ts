/*
 * V6 — Mission info sidebar cards, clickable Outputs (also OUTSIDE the project),
 * chat file chips, and the Smart Viewer "Outside project" header.
 *
 * Real browser + REAL server for the whole consumer chain
 * (GET /tasks/:id/session-file -> client viewer -> .mc-file chip / Outputs row ->
 * Smart Viewer). Only GET .../session-info is fulfilled with a deterministic
 * payload (the real endpoint reads Claude's JSONL under the operator's home); the
 * session JSONL the route uses as EVIDENCE is seeded into the isolated HOME.
 * @covers FR-01.66
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
import { apiUrl } from "../helpers/env";

const OUTSIDE_BODY = "OUTSIDE-CONTENT-V6";
const INSIDE_BODY = "INSIDE-CONTENT-V6";

test.describe("V6 — info sidebar, Outputs and chat file chips", () => {
  let project: SeededProject;
  let taskId: string;
  let outsideDir: string;
  let outsideFile: string;
  let secretFile: string;
  let imageFile: string;
  let codeFile: string;
  let textFile: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "V6", dirName: "sw-v6-chips" });
    outsideDir = await makeTempDir("sw-v6-outside-");
    outsideFile = path.join(outsideDir, "scratch-notes.md");
    secretFile = path.join(outsideDir, "never-mentioned.md");
    await fs.writeFile(outsideFile, `# ${OUTSIDE_BODY}\n`);
    await fs.writeFile(secretFile, "# not evidenced\n");
    imageFile = path.join(outsideDir, "pixel.png");
    await fs.writeFile(
      imageFile,
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"),
    );
    // Line-addressed targets: a code file whose line 59 is long enough to WRAP (a row-index guess
    // would land on the wrong logical line) and a plain-text file.
    codeFile = path.join(outsideDir, "long-module.ts");
    textFile = path.join(outsideDir, "notes.txt");
    const pad = (n: number) => String(n).padStart(3, "0");
    await fs.writeFile(
      codeFile,
      Array.from({ length: 140 }, (_, i) => (i + 1 === 59 ? `const WIDE_059 = "${"w".repeat(900)}";` : `const LINE_${pad(i + 1)} = ${i + 1};`)).join("\n"),
    );
    await fs.writeFile(textFile, Array.from({ length: 90 }, (_, i) => `NOTE_${pad(i + 1)} text`).join("\n"));
    await fs.mkdir(path.join(project.path, "docs"), { recursive: true });
    await fs.writeFile(path.join(project.path, "docs", "inside.md"), `# ${INSIDE_BODY}\n`);
    const task = await seedTask(request, { title: "V6 chips", projectId: project.projectId, cwd: project.path });
    taskId = task.taskId;
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        { type: "user", message: { role: "user", content: "Where are the notes?" } },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", id: "w1", name: "Write", input: { file_path: imageFile, content: "x" } }],
          },
        },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: `The notes are in \`${outsideFile}\` and the spec is [inside](docs/inside.md). Also \`docs/inside.md:1\`, \`${codeFile}:60\` and \`${textFile}:40\`.`,
              },
            ],
          },
        },
      ],
    });
    await page.route("**/api/external/tasks/*/session-info", async (route) => {
      await route.fulfill({
        json: {
          status: "ok",
          info: {
            sessionUuid: task.sessionUuid,
            context: { tokens: 1234, model: "claude-opus-4-7", at: null, compactedSince: false, tokensAfterCompaction: null },
            compaction: { count: 0, last: null },
            outputs: [
              { path: path.join(project.path, "docs", "inside.md"), tool: "Write", firstAt: null, lastAt: "2026-01-02T00:00:00Z", agentId: null },
              { path: outsideFile, tool: "Write", firstAt: null, lastAt: "2026-01-03T00:00:00Z", agentId: null },
            ],
            remoteControl: { active: false, onceEnabled: false, pid: null },
            subagents: [],
            scan: { truncated: false, scannedBytes: 1, sizeBytes: 1, outputsTruncated: 0, subagentsTruncated: 0 },
          },
        },
      });
    });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
    await removeTempDir(outsideDir);
  });

  async function open(page: Page) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await expect(page.getByTestId("mission-side")).toBeVisible();
  }

  // @covers FR-01.66
  test("info sidebar is three cards with the shared heading step and tab trough", async ({ page }) => {
    await open(page);
    await expect(page.locator(".env-sec")).toHaveCount(3);
    const heads = page.locator(".env-h");
    await expect(heads).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const st = await heads.nth(i).evaluate((el) => {
        const c = getComputedStyle(el);
        return { size: c.fontSize, weight: c.fontWeight, tt: c.textTransform };
      });
      expect(st).toEqual({ size: "12px", weight: "600", tt: "uppercase" });
    }
    // Refresh sits in the FIRST heading; tabs use the same .mc-tabs trough as Mission | Files & Terminal.
    await expect(heads.first().getByTestId("env-refresh")).toBeVisible();
    await expect(page.getByTestId("mission-side").locator(".mc-tabs")).toBeVisible();
    await expect(page.getByTestId("mission-side").locator(".mc-tabs.ft-seg")).toHaveCount(0);
    const row = await page.getByTestId("env-computer").boundingBox();
    expect(row!.height).toBeGreaterThanOrEqual(38);
    const out = await page.getByTestId("env-output").first().boundingBox();
    expect(out!.height).toBeGreaterThanOrEqual(40);
  });

  // @covers FR-01.66
  test("Outputs: every row opens in the viewer, an outside file shows the tag and the Outside project header", async ({ page }) => {
    await open(page);
    const rows = page.getByTestId("env-output");
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId("env-output-outside")).toHaveCount(1);
    await expect(page.getByTestId("env-output-outside")).toHaveText("outside project");

    await rows.filter({ hasText: "scratch-notes.md" }).click();
    await expect(page.getByTestId("mission-side-body-viewer")).toBeVisible();
    await expect(page.getByTestId("smart-viewer-outside-tag")).toHaveText("Outside project");
    await expect(page.getByTestId("smart-viewer-outside-path")).toContainText("scratch-notes.md");
    await expect(page.getByTestId("mission-side-body-viewer")).toContainText(OUTSIDE_BODY);

    await page.getByTestId("mission-side-seg-info").click();
    await page.getByTestId("env-output").filter({ hasText: "inside.md" }).click();
    await expect(page.getByTestId("mission-side-body-viewer")).toContainText(INSIDE_BODY);
    await expect(page.getByTestId("smart-viewer-outside-head")).toHaveCount(0);
  });

  // @covers FR-01.66
  test("chat chips (backtick absolute outside, markdown link, backtick relative:line) open the same viewer", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    await open(page);
    const chips = page.getByTestId("mission-activity-feed").getByTestId("mc-file");
    await expect(chips).toHaveCount(5);
    await expect(chips.first()).toHaveClass(/mc-file/);
    await expect(chips.first()).toHaveAttribute("title", outsideFile);
    // an inside chip's tooltip is the FULL path (project root + relative), not the raw source text
    const insideTitle = (await chips.nth(1).getAttribute("title")) ?? "";
    expect(insideTitle).toContain(path.basename(project.path));
    expect(insideTitle).toMatch(/inside\.md$/);
    expect((await chips.nth(2).getAttribute("title")) ?? "").toBe(insideTitle);

    await chips.first().click();
    await expect(page.getByTestId("mission-side-body-viewer")).toContainText(OUTSIDE_BODY);
    await expect(page.getByTestId("smart-viewer-outside-tag")).toBeVisible();
    await page.screenshot({ path: path.join(process.env.V6_SHOTS ?? outsideDir, "v6-chip-outside.png") });
    await page.getByTestId("smart-viewer-copy-path").click();
    await expect(page.getByTestId("smart-viewer-copy-path")).toContainText("Copied");

    await chips.nth(1).click();
    await expect(page.getByTestId("mission-side-body-viewer")).toContainText(INSIDE_BODY);
    await expect(page.getByTestId("smart-viewer-outside-head")).toHaveCount(0);
    await chips.nth(2).click();
    await expect(page.getByTestId("mission-side-body-viewer")).toContainText(INSIDE_BODY);
    // spec 35 hygiene
    await expect(page.locator("[data-testid^='chat-']")).toHaveCount(0);
  });

  // @covers FR-01.66
  test("a chip re-opens the viewer from a collapsed sidebar and from another segment; an outside image is served by the session route", async ({ page }) => {
    await open(page);
    const chip = page.getByTestId("mission-activity-feed").getByTestId("mc-file").nth(1);
    await page.getByTestId("mission-side-collapse").click();
    await expect(page.getByTestId("mission-side")).toHaveCount(0);
    await chip.click();
    await expect(page.getByTestId("mission-side-body-viewer")).toContainText(INSIDE_BODY);
    // same chip again after switching away: the viewer comes back (not swallowed)
    await page.getByTestId("mission-side-seg-info").click();
    await expect(page.getByTestId("mission-side-body-info")).toBeVisible();
    await chip.click();
    await expect(page.getByTestId("mission-side-body-viewer")).toContainText(INSIDE_BODY);

    // outside image through the session route: correct MIME and a really decodable <img>
    const url = `/api/external/tasks/${taskId}/session-file?path=${encodeURIComponent(imageFile)}`;
    const res = await page.request.get(apiUrl(url));
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    const width = await page.evaluate(
      (u) =>
        new Promise<number>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img.naturalWidth);
          img.onerror = () => reject(new Error("image failed"));
          img.src = u;
        }),
      url,
    );
    expect(width).toBe(1);
  });

  // The marked band must sit on the SAME box as the text of the requested logical line and be
  // inside the scroll host's visible area (wrapped long line above it must not shift the target).
  async function expectMarkOnLine(page: Page, hostSel: string, needle: string, line: number) {
    const mark = page.getByTestId("sv-line-mark");
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute("data-line", String(line));
    await expect
      .poll(async () =>
        page.evaluate(
          ({ hostSel, needle }) => {
            const host = document.querySelector(hostSel) as HTMLElement;
            const m = document.querySelector("[data-testid='sv-line-mark']") as HTMLElement;
            const w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
            for (let n = w.nextNode(); n; n = w.nextNode()) {
              const i = (n.nodeValue ?? "").indexOf(needle);
              if (i < 0) continue;
              const r = document.createRange();
              r.setStart(n, i);
              r.setEnd(n, i + needle.length);
              const t = r.getBoundingClientRect();
              const mr = m.getBoundingClientRect();
              const hr = host.getBoundingClientRect();
              const aligned = Math.abs(mr.top - t.top) <= 4 && mr.top <= t.bottom && mr.bottom >= t.top;
              const visible = t.top >= hr.top && t.bottom <= hr.bottom;
              return { aligned, visible, scrolled: host.scrollTop > 0 };
            }
            return null;
          },
          { hostSel, needle },
        ),
      )
      .toEqual({ aligned: true, visible: true, scrolled: true });
  }

  // @covers FR-01.66
  test("a chip with :line opens the viewer scrolled to and marking that logical line (code, wrap on and off, plain text)", async ({ page }) => {
    await open(page);
    const chips = page.getByTestId("mission-activity-feed").getByTestId("mc-file");
    await expect(chips.nth(3)).toContainText("long-module.ts:60");
    await chips.nth(3).click();
    await expect(page.getByTestId("smart-viewer-outside-tag")).toBeVisible();
    await expectMarkOnLine(page, "[data-testid='smart-viewer-code']", "LINE_060", 60);
    // wrap OFF re-measures: the band follows the line (the 900-char line above is one row now)
    await page.getByTestId("smart-viewer-wrap-toggle").click();
    await expectMarkOnLine(page, "[data-testid='smart-viewer-code']", "LINE_060", 60);
    await page.getByTestId("smart-viewer-wrap-toggle").click();

    await page.getByTestId("mission-side-seg-info").click();
    await chips.nth(4).click();
    await expectMarkOnLine(page, ".smart-viewer-text-host", "NOTE_040", 40);

    // opening a file without a :line from Outputs drops the mark
    await page.getByTestId("mission-side-seg-info").click();
    await page.getByTestId("env-output").filter({ hasText: "inside.md" }).click();
    await expect(page.getByTestId("sv-line-mark")).toHaveCount(0);
  });

  // @covers FR-01.66
  test("the server still refuses an outside file this session never evidenced (403)", async ({ request }) => {
    const res = await request.get(apiUrl(`/api/external/tasks/${taskId}/session-file?path=${encodeURIComponent(secretFile)}`));
    expect(res.status()).toBe(403);
    const ok = await request.get(apiUrl(`/api/external/tasks/${taskId}/session-file?path=${encodeURIComponent(outsideFile)}`));
    expect(ok.status()).toBe(200);
    expect(await ok.text()).toContain(OUTSIDE_BODY);
  });
});
