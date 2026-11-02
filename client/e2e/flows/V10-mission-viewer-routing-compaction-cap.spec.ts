/*
 * Mission follow-up (iterate-2026-11-02-mission-viewer-routing-polish) - real browser, REAL server,
 * through the REAL JSONL -> parser -> reducer -> DOM chain (seeded transcript):
 *   (1) Viewer tabs have a fixed maximum width: a long file name is cut with an ellipsis, the full
 *       path rides in the tooltip, a short name keeps its natural width;
 *   (2) every file-opening entry point of the Mission tab (chat chip, Outputs row, Folders tree)
 *       lands in the Info sidebar's OWN Viewer segment, as a tab above the viewer, and no second
 *       viewer pane appears;
 *   (4) a context-compaction summary is ONE collapsed "Context compacted" row (Show / Hide summary),
 *       never a human bubble;
 *   (5) a long hand-back report is capped with Show more / Show less (aria-expanded).
 * Read-only: no composer, no chat-* surface.
 *
 * @covers FR-01.66
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { cleanupProject, cleanupTask, seedProject, seedTask, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { seedClaudeJsonlEvents } from "../helpers/claude-jsonl";

const AGENT = "b798d6e7922ba0bd9";
const LONG_NAME = "a-really-quite-long-file-name-for-the-viewer-tab-truncation-check.md";
const SUMMARY_BODY_MARK = "SUMMARY-BODY-MARK-4711";
const REPORT_LINES = Array.from({ length: 70 }, (_, i) => `  - report line ${i + 1}`).join("\n");

const dispatch = { type: "assistant", timestamp: "2026-11-02T10:00:00.000Z", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Agent", input: { description: "Run sub-iterate V2", subagent_type: "general-purpose" } }] } };
const ack = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: `Async agent launched successfully.\nagentId: ${AGENT}`, is_error: false }] } };
const notification = { type: "user", timestamp: "2026-11-02T10:44:00.000Z", message: { role: "user", content: `<task-notification>\n<task-id>${AGENT}</task-id>\n<status>completed</status>\n<summary>Done</summary>\n<result>Merged.</result>\n</task-notification>` }, origin: { kind: "task-notification" } };
const handback = {
  type: "user",
  timestamp: "2026-11-02T10:44:01.000Z",
  message: { role: "user", content: `Another Claude session sent a message:\n<agent-message from="${AGENT}">\n[Subagent hand-back] FRAMING-MARKER The report follows:\n${REPORT_LINES}\n</agent-message>\n\nThat "other Claude session" is an agent working inside this same session.` },
};

test.describe("V10 - Mission viewer routing, tab width, compaction row, hand-back cap", () => {
  test.describe.configure({ timeout: 120_000 });
  let project: SeededProject;
  let taskId = "";
  let sessionUuid = "";

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "V10Mission", dirName: "sw-v10-mission", adopted: true });
    await fs.mkdir(path.join(project.path, "docs"), { recursive: true });
    await fs.writeFile(path.join(project.path, "docs", LONG_NAME), "# LONG-NAME-BODY\n");
    await fs.writeFile(path.join(project.path, "docs", "short.md"), "# SHORT-BODY\n");
    await fs.writeFile(path.join(project.path, "docs", "tree-pick.md"), "# TREE-BODY\n");
    const task = await seedTask(request, { title: "V10", projectId: project.projectId, cwd: project.path });
    taskId = task.taskId;
    sessionUuid = task.sessionUuid;
    seedClaudeJsonlEvents({
      sessionUuid,
      cwd: task.cwd,
      events: [
        { type: "user", message: { role: "user", content: [{ type: "text", text: "Please delegate." }] } },
        { type: "system", subtype: "compact_boundary", content: "Context automatically compacted" },
        { type: "user", isCompactSummary: true, message: { role: "user", content: `<artifact-content-authored-by-others/> The summarized conversation below covers the earlier work.\n\nSummary:\n## Earlier goals\n\n${SUMMARY_BODY_MARK}` } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `Opened \`docs/${LONG_NAME}\` and \`docs/short.md\`.` }] } },
        dispatch, ack, notification, handback,
      ],
    });
    await page.route("**/api/external/tasks/*/session-info", async (route) => {
      await route.fulfill({
        json: {
          status: "ok",
          info: {
            sessionUuid,
            context: { tokens: 1234, model: "claude-opus-4-7", at: null, compactedSince: false, tokensAfterCompaction: null },
            compaction: { count: 1, last: null },
            outputs: [{ path: path.join(project.path, "docs", "short.md"), tool: "Write", firstAt: null, lastAt: "2026-01-02T00:00:00Z", agentId: null }],
            remoteControl: { active: false, onceEnabled: false, pid: null },
            subagents: [],
            scan: { truncated: false, scannedBytes: 1, sizeBytes: 1, outputsTruncated: 0, subagentsTruncated: 0 },
          },
        },
      });
    });
    await setActiveProject(page, project.projectId);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await expect(page.getByTestId("mission-activity-feed")).toBeVisible({ timeout: 15_000 });
  });

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  // @covers FR-01.66
  test("every Mission file entry point opens in the Info sidebar's own Viewer (tabs above it), never a second pane; tabs have a max width", async ({ page }) => {
    const side = page.getByTestId("mission-side");
    const chips = page.getByTestId("mission-activity-feed").getByTestId("mc-file");
    await expect(chips).toHaveCount(2);

    // chip -> Viewer segment, tab above the viewer
    await chips.nth(0).click();
    await expect(page.getByTestId("mission-side-body-viewer")).toContainText("LONG-NAME-BODY");
    await expect(page.getByTestId("mission-side-seg-viewer")).toHaveAttribute("aria-checked", "true");
    const longTab = side.getByTestId(`viewer-tab-docs/${LONG_NAME}`);
    await expect(longTab).toBeVisible();

    // (1) max width + ellipsis + tooltip
    const label = longTab.getByTestId("viewer-tab-label");
    const tabBox = await longTab.locator("xpath=..").boundingBox();
    expect(tabBox!.width).toBeLessThanOrEqual(201);
    expect(await label.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await label.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");
    await expect(longTab).toHaveAttribute("title", `docs/${LONG_NAME}`);
    // the close button stays reachable inside the capped tab
    const close = side.getByTestId(`viewer-tab-close-docs/${LONG_NAME}`);
    await close.focus();
    await expect(close).toBeVisible();
    const closeBox = await close.boundingBox();
    expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(tabBox!.x + tabBox!.width + 1);

    // second chip -> second tab in the SAME bar; the short name keeps its natural (narrower) width
    await chips.nth(1).click();
    await expect(page.getByTestId("mission-side-body-viewer")).toContainText("SHORT-BODY");
    await expect(side.getByTestId("viewer-tab-bar")).toHaveCount(1);
    const shortBox = await side.getByTestId("viewer-tab-docs/short.md").locator("xpath=..").boundingBox();
    expect(shortBox!.width).toBeLessThan(tabBox!.width);
    await side.getByTestId(`viewer-tab-docs/${LONG_NAME}`).click();
    await expect(page.getByTestId("mission-side-body-viewer")).toContainText("LONG-NAME-BODY");

    // Outputs row -> same Viewer (back to Info first)
    await page.getByTestId("mission-side-seg-info").click();
    await page.getByTestId("env-output").filter({ hasText: "short.md" }).click();
    await expect(page.getByTestId("mission-side-body-viewer")).toContainText("SHORT-BODY");

    // Folders tree pick -> same Viewer, a third tab
    await page.getByTestId("mission-side-seg-folders").click();
    await side.getByTestId("folder-tree-row-docs").click();
    await side.getByTestId("folder-tree-row-docs/tree-pick.md").click();
    await expect(page.getByTestId("mission-side-body-viewer")).toContainText("TREE-BODY");
    await expect(side.locator("[role='tab']")).toHaveCount(3);
    // the viewer body does not scroll itself (SmartViewer bounds its own height): a single scroller
    expect(await page.getByTestId("mission-side-body-viewer").evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);

    // no duplicate viewer: one sidebar, one tab bar, the Files & Terminal viewer card is not on screen,
    // and no extra pane appeared in the Mission body
    await expect(page.getByTestId("mission-side")).toHaveCount(1);
    await expect(page.getByTestId("viewer-tab-bar")).toHaveCount(1);
    await expect(page.locator("[data-testid='task-detail-viewer']:visible")).toHaveCount(0);
    await expect(page.locator("[data-testid='smart-viewer']:visible")).toHaveCount(1);
    await expect(page.getByTestId("mission-panel-detail").locator("*")).toHaveCount(0);
    await expect(page.locator("[data-testid^='chat-']")).toHaveCount(0);
  });

  // @covers FR-01.66
  test("a compaction summary is one collapsed 'Context compacted' row, never a human bubble", async ({ page }) => {
    const feed = page.getByTestId("mission-activity-feed");
    const row = feed.getByTestId("compaction-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Context compacted");
    await expect(feed).not.toContainText("summarized conversation");
    await expect(feed).not.toContainText("artifact-content-authored-by-others");
    await expect(feed).not.toContainText(SUMMARY_BODY_MARK);
    await expect(feed.getByTestId("compaction-summary")).toHaveCount(0);
    // only the typed prompt is a human bubble
    await expect(feed.locator('.mc-feed-entry[data-entry-kind="user"] .mc-feed-card')).toHaveCount(1);

    const toggle = feed.getByTestId("compaction-toggle");
    await expect(toggle).toHaveText("Show summary");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveText("Hide summary");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(feed.getByTestId("compaction-summary").locator("h2")).toHaveText("Earlier goals");
    await expect(feed.getByTestId("compaction-summary")).toContainText(SUMMARY_BODY_MARK);
    await toggle.click();
    await expect(feed.getByTestId("compaction-summary")).toHaveCount(0);
  });

  // @covers FR-01.66
  test("a long hand-back report is capped with Show more / Show less", async ({ page }) => {
    const card = page.getByTestId("mission-activity-feed").getByTestId("handback-card");
    await expect(card).toHaveCount(1);
    const clip = card.locator(".mc-cap");
    const toggle = card.getByTestId("capped-body-toggle");
    await expect(toggle).toHaveText("Show more");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const capped = await clip.boundingBox();
    expect(capped!.height).toBeLessThanOrEqual(330);
    await expect(clip).toHaveAttribute("data-fade", "on");
    await toggle.click();
    await expect(toggle).toHaveText("Show less");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const open = await clip.boundingBox();
    expect(open!.height).toBeGreaterThan(capped!.height + 100);
    await expect(card).toContainText("report line 70");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect((await clip.boundingBox())!.height).toBeLessThanOrEqual(330);
  });
});
