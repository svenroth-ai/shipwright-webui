/*
 * iterate-2026-11-02-mission-links-viewer-probe - real browser, REAL server, the whole consumer chain
 * (seeded JSONL + run pointer -> resolver/probe routes -> client hooks -> rail/Run-result/chip/Outputs -> Viewer):
 *   (1+2) every Mission document link - the LEFT rail (Spec, Requirement) and the Run-result card buttons -
 *         opens as a tab of the Info sidebar's OWN Viewer segment; there is no second panel
 *         (`mission-panel-detail` is gone) and exactly one tab strip exists;
 *   (3)   a path in the chat is a clickable chip only when the server says it can be opened, otherwise
 *         plain text; the probe is read-only and refuses traversal / unevidenced outside paths;
 *   (4)   an Outputs row whose file no longer exists is NOT clickable and carries a "missing" tag.
 * Read-only: no composer, no chat-* surface.
 *
 * @covers FR-01.66
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { cleanupProject, cleanupTask, makeTempDir, removeTempDir, seedProject, seedTask, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { writeFiles } from "../helpers/temp-dir";
import { seedClaudeJsonlEvents } from "../helpers/claude-jsonl";
import { apiUrl } from "../helpers/env";

const RUN_ID = "iterate-2026-11-02-v11-links-e2e";
const SPEC_DOC = "# V11 links fixture\n\nTouches FR-01.66 only.\n\n## Affected Boundaries\n\nReads the session JSONL.\n";
const AGENT = "a798d6e7922ba0bd9";

const dispatch = { type: "assistant", timestamp: "2026-11-02T10:00:00.000Z", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Agent", input: { description: "Review and merge M4 PR", subagent_type: "general-purpose" } }] } };
const ack = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: `Async agent launched successfully.\nagentId: ${AGENT}`, is_error: false }] } };
const notification = { type: "user", timestamp: "2026-11-02T10:44:00.000Z", message: { role: "user", content: `<task-notification>\n<task-id>${AGENT}</task-id>\n<status>completed</status>\n<summary>Done</summary>\n<result>Merged.</result>\n</task-notification>` }, origin: { kind: "task-notification" } };
const handback = { type: "user", timestamp: "2026-11-02T10:44:01.000Z", message: { role: "user", content: `Another Claude session sent a message:\n<agent-message from="${AGENT}">\n[Subagent hand-back] The report follows:\n  Merged it.\n</agent-message>\n\nThat "other Claude session" is an agent.` } };

test.describe("V11 - Mission links open in the Viewer, dead paths are not links", () => {
  test.describe.configure({ timeout: 120_000 });
  let project: SeededProject;
  let taskId = "";
  let outsideDir = "";
  let outsideFile = "";

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "V11Links", dirName: "sw-v11-links", adopted: true });
    outsideDir = await makeTempDir("sw-v11-outside-");
    outsideFile = path.join(outsideDir, "evidenced-notes.md");
    await fs.writeFile(outsideFile, "# OUTSIDE-V11\n");
    await fs.writeFile(path.join(outsideDir, "never-mentioned.md"), "# secret\n");
    await fs.mkdir(path.join(project.path, "docs"), { recursive: true });
    await fs.writeFile(path.join(project.path, "docs", "real.md"), "# REAL-DOC-V11\n");
    const task = await seedTask(request, { title: "V11", projectId: project.projectId, cwd: project.path });
    taskId = task.taskId;
    await writeFiles(project.path, {
      [`.shipwright/iterate_active/${task.sessionUuid}.json`]: JSON.stringify({ run_id: RUN_ID, slug: "v11-links-e2e", branch: "iterate/v11-links-e2e", main_root: project.path, session_id: task.sessionUuid, created_at: "2026-11-02T09:00:00Z" }),
      [`.shipwright/planning/iterate/${RUN_ID}/mini-plan.md`]: SPEC_DOC,
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        { type: "user", message: { role: "user", content: [{ type: "text", text: "Please delegate the merge." }] } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `Read \`docs/real.md\`, the hand-off \`session_handoff.md\` and \`${outsideFile}\`.` }] } },
        dispatch, ack, notification, handback,
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
              { path: path.join(project.path, "docs", "real.md"), tool: "Write", firstAt: null, lastAt: "2026-11-02T00:00:00Z", agentId: null },
              // written inside an iterate worktree that was removed after its merge: inside the root, gone from disk
              { path: path.join(project.path, ".worktrees", "gone-iterate", "src", "gone.ts"), tool: "Write", firstAt: null, lastAt: "2026-11-01T00:00:00Z", agentId: null },
            ],
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
    if (outsideDir) await removeTempDir(outsideDir);
  });

  // @covers FR-01.66
  test("a left-rail document link opens as a tab of the Info sidebar's Viewer; no second panel", async ({ page }) => {
    const side = page.getByTestId("mission-side");
    await page.getByTestId("artifact-link-spec").click();
    await expect(page.getByTestId("mission-side-seg-viewer")).toHaveAttribute("aria-checked", "true");
    const body = page.getByTestId("mission-side-body-viewer");
    await expect(body.getByTestId("mission-artifact-panel")).toBeVisible();
    await expect(body).toContainText("V11 links fixture");
    await expect(side.getByTestId("viewer-tab-doc:spec")).toBeVisible();
    await expect(page.getByTestId("artifact-link-spec")).toHaveClass(/active/);
    // one viewer surface: nothing in the middle, one tab strip, one sidebar
    await expect(page.getByTestId("mission-panel-detail")).toHaveCount(0);
    await expect(page.getByTestId("mission-artifact-panel")).toHaveCount(1);
    await expect(page.getByTestId("viewer-tab-bar")).toHaveCount(1);
    await expect(page.getByTestId("mission-side")).toHaveCount(1);
    // the document fills the viewer pane (not a 400px floating slide-over) and the sidebar stays on screen
    const sideBox = await side.boundingBox();
    const panelBox = await page.getByTestId("mission-artifact-panel").boundingBox();
    expect(panelBox!.width).toBeGreaterThan(sideBox!.width - 40);
    expect(sideBox!.x + sideBox!.width).toBeLessThanOrEqual(1441);
    // a second document and a file share the SAME strip
    await page.getByTestId("artifact-link-requirement").click();
    await expect(side.getByTestId("viewer-tab-doc:requirement")).toBeVisible();
    await expect(page.getByTestId("viewer-tab-bar")).toHaveCount(1);
    await page.getByTestId("artifact-close").click();
    await expect(side.getByTestId("viewer-tab-doc:requirement")).toHaveCount(0);
    await expect(side.getByTestId("viewer-tab-doc:spec")).toBeVisible();
  });

  // @covers FR-01.66
  test("the Run-result card buttons open in the same Viewer", async ({ page }) => {
    const feed = page.getByTestId("mission-activity-feed");
    const row = feed.getByTestId("run-result-card").locator('[data-testid="run-result-row"][data-artifact="requirement"]');
    await expect(row).toBeVisible();
    await row.getByRole("button").click();
    await expect(page.getByTestId("mission-side-seg-viewer")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("mission-side-body-viewer").getByTestId("mission-artifact-panel")).toBeVisible();
    await expect(page.getByTestId("mission-side").getByTestId("viewer-tab-doc:requirement")).toBeVisible();
    await expect(page.getByTestId("mission-panel-detail")).toHaveCount(0);
  });

  // @covers FR-01.66
  test("a chat path is a chip only when openable; a name-only hand-off mention is plain text", async ({ page }) => {
    const feed = page.getByTestId("mission-activity-feed");
    const chips = feed.getByTestId("mc-file");
    await expect(chips).toHaveCount(2); // docs/real.md + the session-evidenced outside file
    const plain = feed.getByTestId("mc-file-plain");
    await expect(plain).toHaveCount(1);
    await expect(plain).toHaveText("session_handoff.md");
    expect(await plain.evaluate((el) => el.tagName)).not.toBe("BUTTON");
    await chips.filter({ hasText: "real.md" }).click();
    await expect(page.getByTestId("mission-side-body-viewer")).toContainText("REAL-DOC-V11");
  });

  // @covers FR-01.66
  test("an Outputs row for a file that no longer exists is not clickable and says 'missing'", async ({ page }) => {
    await page.getByTestId("mission-side-seg-info").click();
    const rows = page.getByTestId("env-output");
    await expect(rows).toHaveCount(2);
    const gone = rows.filter({ hasText: "gone.ts" });
    await expect(gone.getByTestId("env-output-missing")).toHaveText("missing");
    await expect(gone).toBeDisabled();
    const live = rows.filter({ hasText: "real.md" });
    await expect(live).toBeEnabled();
    await live.click();
    await expect(page.getByTestId("mission-side-body-viewer")).toContainText("REAL-DOC-V11");
  });

  // @covers FR-01.66
  test("the probe route answers yes/no only and refuses traversal and unevidenced outside paths", async ({ request }) => {
    const r = await request.post(apiUrl(`/api/external/tasks/${taskId}/session-file/probe`), {
      data: { paths: ["docs/real.md", "docs/nope.md", "../outside.md", outsideFile, path.join(outsideDir, "never-mentioned.md")] },
    });
    expect(r.status()).toBe(200);
    const { results } = (await r.json()) as { results: Array<{ openable: boolean; reason?: string }> };
    expect(results[0]).toEqual({ openable: true });
    expect(results[1]).toEqual({ openable: false, reason: "not_found" });
    expect(results[2]!.openable).toBe(false);
    expect(results[3]).toEqual({ openable: true }); // the session names it in a chat message
    expect(results[4]).toEqual({ openable: false, reason: "unavailable" }); // exists, never mentioned: no oracle
    expect(JSON.stringify(results)).not.toContain("never-mentioned");
  });

  // @covers FR-01.66
  test("on the phone a link jumps to the Info tab (Viewer) - there is no Detail tab", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await expect(page.getByTestId("mission-compact-tabs").getByRole("tab")).toHaveText(["Overview", "Activity", "Info"]);
    await page.getByTestId("artifact-link-spec").click();
    await expect(page.getByTestId("mission-compact-tab-info")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("mission-artifact-panel")).toBeVisible();
    await expect(page.getByTestId("mission-panel-detail")).toHaveCount(0);
  });
});
