/*
 * FR-01.66 — the Mission tab as a LIVE view of the session from the JSONL.
 *
 * The regression this fences (AC1): before FR-01.66 the Mission tab read ONLY the
 * per-run join and showed a permanent "No run data yet — nothing to prove" for any
 * session without a `work_completed` row — including a live iterate and an ad-hoc
 * session. Now it narrates the raw JSONL.
 *
 * Seeded fixtures only (never operator UUIDs). WebUI is a READ-ONLY observer of the
 * JSONL (rule 1 / DO-NOT #1): the fixture writes the transcript, impersonating
 * *Claude*, and the server observes it through the production transcript endpoint —
 * so this runs on a CI runner with no `claude` binary. If the isolated stack is
 * unavailable this spec is skipped by the harness, not by a hard-coded UUID.
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { seedClaudeJsonlEvents } from "../helpers/claude-jsonl";

test.describe("FR-01.66 — Mission tab live from the JSONL", () => {
  test.describe.configure({ timeout: 120_000 });

  let project: SeededProject;
  let taskId: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Mission live" });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  /** Create a new-plain task through the REAL UI, returning its identity. */
  async function createTask(
    page: import("@playwright/test").Page,
    title: string,
  ): Promise<{ taskId: string; sessionUuid: string; cwd: string }> {
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("plain-claude-button").click();
    await expect(page.getByTestId("new-issue-modal-new-plain")).toBeVisible({ timeout: 5_000 });
    await page.getByTestId("new-issue-title-input").fill(title);
    const createResp = page.waitForResponse(
      (r) => r.url().endsWith("/api/external/tasks") && r.request().method() === "POST",
    );
    await page.getByTestId("new-issue-save-btn").click();
    const body = (await (await createResp).json()) as {
      task: { taskId: string; sessionUuid: string; cwd: string };
    };
    return body.task;
  }

  test("a session with a live JSONL narrates plain-language activity + an inferred stage (AC1/AC2)", async ({
    page,
  }) => {
    const title = `mission-live-${Date.now()}`;
    const task = await createTask(page, title);
    taskId = task.taskId;

    // The transcript Claude would have written: a user instruction + an edit turn,
    // so the narrator infers the `Build` stage and a plain-language activity line.
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        { type: "user", message: { role: "user", content: "Add a login page" } },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/repo/src/login.tsx" } },
            ],
          },
        },
      ],
    });

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();

    // The middle narrates the JSONL — NOT the old "No run data yet — nothing to prove".
    const narration = page.getByTestId("mission-narration");
    await expect(narration).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("mission-narration-summary")).toContainText("Editing login.tsx", {
      timeout: 15_000,
    });
    await expect(page.getByText("No run data yet")).toHaveCount(0);

    // The left panel shows the business summary + the inferred stage.
    await expect(page.getByTestId("mission-summary")).toContainText(title);
    await expect(page.getByTestId("mission-stage")).toHaveAttribute("data-stage", "Build");

    // The artifact links open the RIGHT panel.
    await page.getByTestId("record-node-spec").click();
    await expect(page.getByTestId("artifact-panel")).toBeVisible();

    // ROLLING (FR-01.66): as the JSONL grows, the SAME transcript poll updates the
    // narration + advances the stage — no reload (external code review, finding 4).
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        { type: "user", message: { role: "user", content: "Add a login page" } },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/repo/src/login.tsx" } },
            ],
          },
        },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "npm run test" } }],
          },
        },
      ],
    });
    await expect(page.getByTestId("mission-narration-summary")).toContainText("Running tests", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("mission-stage")).toHaveAttribute("data-stage", "Test", {
      timeout: 15_000,
    });
  });

  test("a campaign orchestrator session: windowed stage + progress line (FR-01.67 AC2/AC3)", async ({
    page,
  }) => {
    const slug = `wow-usability-${Date.now()}`;
    const task = await createTask(page, `campaign: ${slug}`);
    taskId = task.taskId;

    // Mock the pre-existing campaigns endpoint (NO new server surface): the
    // orchestrator's campaign, 21/22 done, sub-iterate A21 in_progress.
    await page.route("**/api/campaigns/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          campaigns: [
            {
              slug,
              intent: "polish",
              branchStrategy: null,
              expandsTriage: null,
              status: "active",
              steps: [
                { id: "A20", slug: "a20", title: "A20", status: "complete", specPath: null, commit: null, branch: null, planFirst: false },
                { id: "A21", slug: "a21", title: "A21", status: "in_progress", specPath: null, commit: null, branch: null, planFirst: false },
              ],
              done: 21,
              total: 22,
              nextPending: { id: "A22", specPath: null },
            },
          ],
        }),
      });
    });

    // TWO serial sub-iterates in ONE log: the first fully merged, the second
    // mid-Build. The stage must window to the SECOND (Build), not latch Merge.
    const cmd = (name: string) => ({
      type: "user",
      message: {
        role: "user",
        content: `<command-message>${name}</command-message><command-name>/${name}</command-name>`,
      },
    });
    const bash = (id: string, command: string) => ({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
    });
    const edit = (id: string, file_path: string) => ({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "tool_use", id, name: "Edit", input: { file_path } }] },
    });
    seedClaudeJsonlEvents({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      events: [
        cmd("shipwright-iterate"),
        edit("e1", "/repo/src/one.ts"),
        bash("b1", "npm run test"),
        bash("b2", 'git commit -m "feat: one"'),
        bash("b3", "git push origin HEAD"),
        { type: "pr-link", prNumber: 1, prUrl: "https://example.test/1", prRepository: "o/r" },
        bash("b4", "gh pr merge 1 --squash"),
        cmd("shipwright-iterate"),
        edit("e2", "/repo/src/two.ts"),
      ],
    });

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();

    // The progress line reads the mocked campaign payload.
    await expect(page.getByTestId("mission-campaign-progress")).toContainText("Sub-iterate 21 of 22", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("mission-campaign-progress")).toContainText("A21");
    // The stepper shows the ACTIVE sub-iterate's windowed stage — Build, NOT Merge.
    await expect(page.getByTestId("mission-stage")).toHaveAttribute("data-stage", "Build", {
      timeout: 15_000,
    });
    // The business summary is the readable slug, not the raw `campaign: <slug>`.
    await expect(page.getByTestId("mission-summary")).toContainText(slug);
  });

  test("no run AND no transcript → honest 'waiting', never fabricated activity (AC3)", async ({
    page,
  }) => {
    const task = await createTask(page, `mission-empty-${Date.now()}`);
    taskId = task.taskId;

    await page.goto(`/tasks/${taskId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByTestId("mission-tab-mission").click();

    const narration = page.getByTestId("mission-narration");
    await expect(narration).toBeVisible({ timeout: 15_000 });
    await expect(narration).toHaveAttribute("data-empty", "true");
    await expect(page.getByTestId("mission-narration-summary")).toContainText(/waiting/i);
    // The stage is an honest "—" when nothing can be derived (never guessed).
    await expect(page.getByTestId("mission-stage")).toHaveAttribute("data-stage", "none");
  });
});
